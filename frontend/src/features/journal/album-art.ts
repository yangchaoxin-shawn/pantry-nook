import kitchenTeam from '../../assets/journal/kitchen-team.webp';
import recipeTime from '../../assets/journal/recipe-time.webp';
import pantryHome from '../../assets/journal/pantry-home.webp';
import tableMemories from '../../assets/journal/table-memories.png';

/** 已确认的四张厨房插画；首页固定用饭桌，月份章节轮换其余三张。 */
export const SCENES = {
  table: { src: tableMemories, width: 1862, height: 845, caption: '这一顿，值得留一张' },
  team: { src: kitchenTeam, width: 960, height: 335, caption: '今天，合伙做顿饭' },
  recipe: { src: recipeTime, width: 960, height: 481, caption: '翻到喜欢的那页' },
  pantry: { src: pantryHome, width: 960, height: 707, caption: '把好东西，带回家' },
} as const;
export type SceneKey = keyof typeof SCENES;

const CHAPTER_ROTATION: SceneKey[] = ['team', 'recipe', 'pantry'];
const CHAPTER_LINES = ['把日常，慢慢收藏', '一顿一顿，攒成日子', '吃好每一顿，就是好好过', '烟火气，都在这里', '这个月，也好好吃饭了'];

/** 章节插画和短句只由年月决定：刷新、翻页都不变。 */
export function chapterArt(month: string) {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  return { scene: CHAPTER_ROTATION[index % CHAPTER_ROTATION.length], line: CHAPTER_LINES[index % CHAPTER_LINES.length] };
}

/** 每张照片下的手写短句，按位置轮换；首张固定。 */
const PRINT_LINES = ['日常一瞬', '刚出锅', '热乎的', '这一口', '慢慢吃'];
export function printLine(index: number) {
  return index === 0 ? '这一顿，记住了。' : PRINT_LINES[(index - 1) % PRINT_LINES.length];
}

export function pageIndex(n: number) {
  return String(n).padStart(2, '0');
}
