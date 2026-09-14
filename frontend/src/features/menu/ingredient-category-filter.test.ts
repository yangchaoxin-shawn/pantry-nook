import { describe, expect, it } from 'vitest';
import { ALL_INGREDIENT_CATEGORIES, ingredientCandidates } from './ingredient-category-filter';

const ingredients = [
  { id: 1, category: '碳水' as const, name: '大米' },
  { id: 2, category: '蔬菜' as const, name: '胡萝卜' },
  { id: 3, category: '蛋白质' as const, name: '鸡蛋' },
  { id: 4, category: '蔬菜' as const, name: '西兰花' },
];

describe('餐安排库存食材大类筛选', () => {
  it('全部分类保持库存顺序，并排除这道菜已经绑定的食材', () => {
    expect(ingredientCandidates(ingredients, [2], ALL_INGREDIENT_CATEGORIES).map(item => item.id)).toEqual([1, 3, 4]);
    expect(ingredients.map(item => item.id)).toEqual([1, 2, 3, 4]);
  });

  it('分类只缩小仍可添加的候选，不把其他分类或已绑定项混入', () => {
    expect(ingredientCandidates(ingredients, [2], '蔬菜').map(item => item.name)).toEqual(['西兰花']);
    expect(ingredientCandidates(ingredients, [4], '蛋白质').map(item => item.name)).toEqual(['鸡蛋']);
  });

  it('每道菜可用各自的已绑定集合独立计算候选', () => {
    expect(ingredientCandidates(ingredients, [1], '碳水')).toEqual([]);
    expect(ingredientCandidates(ingredients, [], '碳水').map(item => item.name)).toEqual(['大米']);
  });
});
