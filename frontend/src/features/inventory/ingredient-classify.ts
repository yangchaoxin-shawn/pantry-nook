import { CATEGORIES } from "../../shared/api/client";

export type IngredientCategory = (typeof CATEGORIES)[number];

/**
 * 内置常见食材分类词表：票面名称命中即建议分类。
 * 只做初始兜底，用户在草稿里改过的分类随食材入库，
 * 之后由在库食材精确匹配优先命中，词表随之可以少管后者。
 */
export const CATEGORY_KEYWORDS: Record<IngredientCategory, string[]> = {
  蔬菜: [
    "白菜", "青菜", "菠菜", "生菜", "芹菜", "韭菜", "茼蒿", "空心菜", "油麦菜", "苋菜",
    "娃娃菜", "上海青", "西兰花", "花菜", "豆芽", "萝卜", "胡萝卜", "白萝卜", "红萝卜",
    "土豆", "洋葱", "蒜", "蒜苗", "蒜苔", "葱", "姜", "山药", "芋头", "莲藕", "藕",
    "竹笋", "笋", "芦笋", "茭白", "莴笋", "莴苣", "黄瓜", "丝瓜", "苦瓜", "冬瓜",
    "南瓜", "西葫芦", "茄子", "辣椒", "青椒", "彩椒", "番茄", "西红柿", "豆角", "四季豆",
    "豌豆", "毛豆", "荷兰豆", "秋葵", "香菜", "荠菜", "菜心", "芥菜", "木耳", "香菇",
    "蘑菇", "金针菇", "平菇", "杏鲍菇", "口蘑", "海带", "紫菜", "魔芋", "榨菜", "酸菜",
  ],
  蛋白质: [
    "猪肉", "牛肉", "羊肉", "鸡肉", "鸡胸", "鸡翅", "鸡腿", "鸡爪", "鸡架", "鸭肉",
    "鸭翅", "鸭腿", "鹅", "排骨", "肋排", "五花肉", "肉糜", "肉末", "肉馅", "猪脚",
    "猪蹄", "猪肝", "牛腩", "牛腱", "牛排", "腊肉", "香肠", "火腿", "培根", "午餐肉",
    "鸡蛋", "鸭蛋", "鹌鹑蛋", "土鸡蛋", "蛋", "豆腐", "豆干", "豆皮", "腐竹", "千张",
    "虾", "虾仁", "基围虾", "蟹", "螃蟹", "鱼", "带鱼", "鲈鱼", "鲫鱼", "草鱼",
    "黄花鱼", "龙利鱼", "巴沙鱼", "三文鱼", "金枪鱼", "鱿鱼", "墨鱼", "章鱼", "扇贝",
    "蛤蜊", "花甲", "生蚝", "海蛎", "泥鳅", "黄鳝", "甲鱼", "牛奶", "酸奶", "奶酪",
    "芝士", "黄油", "淡奶油",
  ],
  水果: [
    "苹果", "香蕉", "梨", "桃", "油桃", "橙子", "橘子", "桔子", "柚子", "柠檬",
    "葡萄", "提子", "西瓜", "哈密瓜", "香瓜", "木瓜", "芒果", "荔枝", "龙眼", "桂圆",
    "枇杷", "樱桃", "车厘子", "草莓", "蓝莓", "猕猴桃", "奇异果", "火龙果", "榴莲",
    "山竹", "柿子", "石榴", "甘蔗", "菠萝", "凤梨", "椰子", "枣", "冬枣", "山楂",
    "杏", "李子", "杨梅", "无花果", "百香果", "牛油果",
  ],
  碳水: [
    "大米", "小米", "糯米", "黑米", "糙米", "胚芽米", "面条", "挂面", "拉面", "面粉",
    "全麦粉", "面包", "吐司", "馒头", "花卷", "包子", "饺子", "馄饨", "云吞", "烧麦",
    "春卷", "油条", "年糕", "米粉", "米线", "河粉", "粉丝", "粉条", "粉皮", "意面",
    "意大利面", "通心粉", "蛋糕", "燕麦", "麦片", "藜麦", "荞麦", "高粱", "玉米", "玉米粒",
    "红薯", "紫薯", "绿豆", "红豆", "黄豆", "黑豆", "薏米", "芡实", "莲子",
  ],
  汤料: [
    "汤骨", "筒骨", "大骨", "扇骨", "炖料", "卤料", "八角", "桂皮", "香叶", "花椒",
    "干辣椒", "枸杞", "红枣", "蜜枣", "陈皮", "干贝", "瑶柱", "虾皮", "虾米", "虫草花",
    "党参", "黄芪", "当归", "玉竹", "沙参", "百合", "银耳", "笋干", "梅干菜", "菜干",
    "菇干", "香菇干", "火锅底料", "浓汤宝", "高汤", "五指毛桃", "鸡骨草", "土茯苓",
  ],
  其他: [
    "盐", "糖", "白糖", "冰糖", "红糖", "酱油", "生抽", "老抽", "醋", "料酒",
    "蚝油", "味精", "鸡精", "油", "花生油", "菜籽油", "橄榄油", "玉米油", "香油",
    "麻油", "豆瓣酱", "甜面酱", "番茄酱", "沙拉酱", "胡椒粉", "胡椒", "孜然",
    "五香粉", "咖喱", "淀粉", "生粉", "面包糠", "酵母", "泡打粉", "小苏打", "蜂蜜",
    "果酱", "花生酱", "巧克力", "零食", "薯片", "糖果", "坚果", "核桃", "开心果",
    "瓜子", "纸巾", "抽纸", "卷纸", "洗洁精", "保鲜袋", "保鲜膜", "牙膏", "洗衣液",
    "电池", "纸杯", "垃圾袋",
  ],
};

// 按词条长度降序展开：最长匹配优先，"土鸡蛋"先于"蛋"命中。
const KEYWORD_ENTRIES: { keyword: string; category: IngredientCategory }[] = Object.entries(
  CATEGORY_KEYWORDS,
).flatMap(([category, keywords]) =>
  keywords.map((keyword) => ({ keyword, category: category as IngredientCategory })),
).sort((a, b) => b.keyword.length - a.keyword.length);

/** 剥掉票面名称里的规格与计量残留，得到可匹配的短名称。 */
export function normalizeIngredientName(rawName: string): string {
  return rawName
    .replace(/[（(【[].*?[）)】\]]/g, "") // 括号补充说明
    .replace(/\d+(?:\.\d+)?\s*(?:kg|Kg|KG|克|g|G|毫升|ml|ML|mL|升|L|斤|两|盒|袋|瓶|罐|杯|份|包|条|支|只|个)/g, "")
    .replace(/(?:\/?\s*(?:kg|KG|Kg|盒|袋|瓶|罐|杯|份|桶|支|条|块|颗|枚|把|卷|只|个|听)\s*){1,2}$/i, "")
    .replace(/[×xX*]\s*\d+(\.\d+)?$/g, "") // 尾部乘数
    .replace(/\s+/g, "")
    .trim();
}

/**
 * 从在库食材与内置词表推断分类；匹配不到返回 null（待分类）。
 * known 为当前在库食材的（归一化后）名称与分类；同名优先于词表。
 */
export function classifyIngredientName(
  rawName: string,
  known: { name: string; category: string }[],
): IngredientCategory | null {
  const normalized = normalizeIngredientName(rawName);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  for (const item of known) {
    const knownName = normalizeIngredientName(item.name).toLowerCase();
    if (!knownName) continue;
    // 同名，或较短一方至少两字且被另一方包含（"土豆" ↔ "黄心土豆"）。
    if (knownName === lowered || (Math.min(knownName.length, lowered.length) >= 2 && (knownName.includes(lowered) || lowered.includes(knownName)))) {
      return (CATEGORIES as readonly string[]).includes(item.category)
        ? (item.category as IngredientCategory)
        : null;
    }
  }
  for (const { keyword, category } of KEYWORD_ENTRIES) {
    if (lowered.includes(keyword)) return category;
  }
  return null;
}
