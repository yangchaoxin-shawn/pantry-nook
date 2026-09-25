import type { LOCATIONS } from "../../shared/api/client";
import { findHabitMatch, normalizeIngredientName, type IngredientCategory } from "./ingredient-classify";

export type IngredientLocation = (typeof LOCATIONS)[number];
/** habit：来自你的记录；guess：内置推测，界面上淡色显示提示重点核对。 */
export type LocationSource = "habit" | "guess";

/**
 * 内置存放位置关键词：只收录判断有把握、且与所在分类的默认位置不同的食材。
 * 冷藏、冷冻类词说明存放方式，在名称任何位置都生效（速冻水饺、芒果冰淇淋）；
 * 室温类多是食材名，只认名称结尾的主体（黄心土豆），不认口味或配料（紫薯馒头、香蕉牛奶）。
 * 这只是冷启动起点——你改过一次位置就会存进习惯库，之后同名食材按你的来。
 */
export const LOCATION_KEYWORDS: Record<IngredientLocation, string[]> = {
  冰箱冷冻: [
    "速冻", "冷冻", "冻品", "冰淇淋", "冰激凌", "雪糕", "冰棍", "汤圆", "水饺", "馄饨",
    "云吞", "冻豆腐", "虾仁", "筒骨", "大骨", "扇骨", "汤骨",
  ],
  冰箱冷藏: ["年糕"],
  室温: [
    "土豆", "洋葱", "红薯", "紫薯", "南瓜", "大蒜", "蒜头", "生姜", "老姜", "山药",
    "芋头", "香蕉", "菠萝", "椰子", "榴莲", "腐竹",
  ],
  其他: [],
};

/** 内置分类默认位置：没有任何更具体的依据时使用。 */
export const CATEGORY_DEFAULT_LOCATION: Record<IngredientCategory, IngredientLocation> = {
  蔬菜: "冰箱冷藏",
  水果: "冰箱冷藏",
  蛋白质: "冰箱冷藏",
  碳水: "室温",
  汤料: "室温",
  其他: "室温",
};

/** 同类多数要成为习惯：至少这么多条有位置的同类记录，且最常用位置过半。 */
export const HABIT_MIN_SAMPLES = 3;

const COLD_LOCATIONS = new Set<string>(["冰箱冷冻", "冰箱冷藏"]);

const KEYWORD_ENTRIES = Object.entries(LOCATION_KEYWORDS)
  .flatMap(([location, keywords]) => keywords.map((keyword) => ({
    keyword,
    location: location as IngredientLocation,
    cold: COLD_LOCATIONS.has(location),
  })))
  .sort((a, b) => b.keyword.length - a.keyword.length);
const COLD_ENTRIES = KEYWORD_ENTRIES.filter((entry) => entry.cold);
/** 名称结尾的规格与称重说明（/斤、1把、约、散装），比对室温主体前剥掉。 */
const TRAILING_RESIDUE = /(?:[^\u4e00-\u9fff]|[一二两三四五六七八九十半斤克根串箱捆扎约装]|千克|公斤|散装|散称|称重|特价)+$/;

type HabitEntry = { name: string; category: string; location?: string | null };

function categoryMajority(category: IngredientCategory, habits: HabitEntry[]): IngredientLocation | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const entry of habits) {
    if (entry.category !== category || !entry.location) continue;
    counts.set(entry.location, (counts.get(entry.location) ?? 0) + 1);
    total += 1;
  }
  if (total < HABIT_MIN_SAMPLES) return null;
  let top: [string, number] | null = null;
  for (const pair of counts) if (!top || pair[1] > top[1]) top = pair;
  return top && top[1] * 2 > total ? (top[0] as IngredientLocation) : null;
}

const onlyIn = (name: string, other: string, keyword: string) => name.includes(keyword) && !other.includes(keyword);

/**
 * 推断一行食材的存放位置，依次：
 * 1. 同一种食材的记录（见 findHabitMatch，原名完全相同的就是入库合并目标）——你的习惯；
 * 2. 内置关键词（土豆放室温、速冻水饺放冷冻）——具体食材的推测；
 * 3. 你同类食材最常放的位置——你的习惯；
 * 4. 内置分类默认位置——推测。
 * 具体食材的判断先于"同类大多放哪"；同一粒度下你的记录先于内置。
 * 例外：包含匹配的两个名称只差一个冷藏、冷冻类关键词时，说明存放方式不同——
 * 票名多出的词指向别的位置（"冷冻鸡翅"对放冷藏的"鸡翅"），改用这个词并标为推测；
 * 习惯名多出的词正是它位置的来由（"鸡翅"对放冷冻的"冷冻鸡翅"），不照搬，往下一层找。
 * category 为空（待分类）时跳过分类层；全都没有返回 null。
 */
export function suggestLocation(
  rawName: string,
  category: IngredientCategory | null,
  habits: HabitEntry[],
): { location: IngredientLocation; source: LocationSource } | null {
  const lowered = normalizeIngredientName(rawName).toLowerCase();
  const same = findHabitMatch(rawName, habits.filter((entry) => entry.location));
  if (same?.location) {
    const habitName = normalizeIngredientName(same.name).toLowerCase();
    const extra = COLD_ENTRIES.find((entry) => entry.location !== same.location && onlyIn(lowered, habitName, entry.keyword));
    if (extra) return { location: extra.location, source: "guess" };
    const explained = COLD_ENTRIES.some((entry) => entry.location === same.location && onlyIn(habitName, lowered, entry.keyword));
    if (!explained) return { location: same.location as IngredientLocation, source: "habit" };
  }
  const subject = lowered.replace(TRAILING_RESIDUE, "");
  const keyword = lowered
    ? KEYWORD_ENTRIES.find((entry) => entry.cold
      ? lowered.includes(entry.keyword)
      : lowered.endsWith(entry.keyword) || subject.endsWith(entry.keyword))
    : undefined;
  if (keyword) return { location: keyword.location, source: "guess" };
  if (!category) return null;
  const majority = categoryMajority(category, habits);
  if (majority) return { location: majority, source: "habit" };
  return { location: CATEGORY_DEFAULT_LOCATION[category], source: "guess" };
}
