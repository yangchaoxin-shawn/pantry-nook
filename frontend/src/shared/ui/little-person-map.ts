export const LITTLE_PERSON_IDS = [
  "wave",
  "stretch",
  "read",
  "sit",
  "flower",
  "balloon",
  "dance",
  "walk",
  "nap",
  "umbrella",
  "highfive",
  "balance",
  "kite",
  "skate",
  "music",
  "hug",
  "star",
  "water",
  "steps",
  "swing",
  "roll",
  "float",
  "carry",
  "paint",
] as const;

export type LittlePersonId = (typeof LITTLE_PERSON_IDS)[number];
export type LittlePersonNamespace = "dish" | "plan";

const namespaceOffset: Record<LittlePersonNamespace, number> = {
  dish: 0,
  plan: 11,
};

/**
 * 视觉分配只依赖稳定业务 ID。17 与 24 互质，让连续 24 个 ID 恰好用遍
 * 全部姿态；命名空间偏移则避免菜品与搭配共用一套分配序列。
 */
export function littlePersonId(
  namespace: LittlePersonNamespace,
  businessId: number,
): LittlePersonId {
  const safeId = Number.isFinite(businessId) ? Math.trunc(businessId) : 0;
  const normalizedId = ((safeId % LITTLE_PERSON_IDS.length) + LITTLE_PERSON_IDS.length)
    % LITTLE_PERSON_IDS.length;
  const index = (normalizedId * 17 + namespaceOffset[namespace])
    % LITTLE_PERSON_IDS.length;
  return LITTLE_PERSON_IDS[index];
}
