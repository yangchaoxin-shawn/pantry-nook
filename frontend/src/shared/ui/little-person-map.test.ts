import { describe, expect, it } from "vitest";
import { LITTLE_PERSON_IDS, littlePersonId } from "./little-person-map";

describe("业务对象的小人映射", () => {
  it("同一菜品 ID 在刷新、改名和跨页面时保持同一姿态", () => {
    const beforeRename = littlePersonId("dish", 37);
    const afterRename = littlePersonId("dish", 37);
    const inMealTimeline = littlePersonId("dish", 37);

    expect(afterRename).toBe(beforeRename);
    expect(inMealTimeline).toBe(beforeRename);
  });

  it("连续 24 个业务 ID 会用遍 24 种原创姿态", () => {
    const assigned = new Set(
      Array.from({ length: LITTLE_PERSON_IDS.length }, (_, index) =>
        littlePersonId("dish", index + 1),
      ),
    );

    expect(assigned).toEqual(new Set(LITTLE_PERSON_IDS));
  });

  it("搭配、相册里的每一顿各用独立命名空间，同号不撞姿态", () => {
    for (let id = 1; id <= LITTLE_PERSON_IDS.length; id += 1) {
      const dish = littlePersonId("dish", id);
      expect(littlePersonId("plan", id)).not.toBe(dish);
      expect(littlePersonId("meal", id)).not.toBe(dish);
      expect(littlePersonId("meal", id)).not.toBe(littlePersonId("plan", id));
    }
    expect(new Set(Array.from({ length: LITTLE_PERSON_IDS.length }, (_, i) => littlePersonId("meal", i + 1)))).toEqual(new Set(LITTLE_PERSON_IDS));
  });
});
