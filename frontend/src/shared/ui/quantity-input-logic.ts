const SCALE = 1_000_000n;
const MAX_SCALED = 999_999_999_999_999n;

// 快捷增减使用整数运算；手填的小数不会因步长而被舍入。
function scaledQuantity(value: string): bigint | null {
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$|^\.\d+$/.test(text)) return null;
  const [whole = "0", rawFraction = ""] = text.split(".");
  const fraction = rawFraction.replace(/0+$/, "");
  if (whole.length > 9 || fraction.length > 6) return null;
  return BigInt(whole || "0") * SCALE + BigInt(fraction.padEnd(6, "0"));
}

function renderQuantity(value: bigint): string {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function quantityInputError(value: string, { required = false, allowZero = false, max }: {
  required?: boolean; allowZero?: boolean; max?: number;
} = {}): string {
  if (!value.trim()) return required ? "请填写数量。" : "";
  const scaled = scaledQuantity(value);
  if (scaled === null) return "请填写数字，最多支持 9 位整数和 6 位小数。";
  if (scaled === 0n && !allowZero) return "数量应大于 0。";
  if (scaled > MAX_SCALED) return "数量超出可填写范围。";
  if (max !== undefined && Number(value) > max) return `数量不能超过 ${max}。`;
  return "";
}

export function stepQuantity(value: string, direction: 1 | -1, { allowZero = false, max }: {
  allowZero?: boolean; max?: number;
} = {}): string {
  if (!value.trim()) return direction === 1 && (max === undefined || max >= 1) ? "1" : value;
  const scaled = scaledQuantity(value);
  if (scaled === null) return value;
  const next = scaled + BigInt(direction) * SCALE;
  // 不在边界处偷偷改成最小值或整数量，用户仍可直接填半份等数量。
  if (next < (allowZero ? 0n : 1n) || next > MAX_SCALED || (max !== undefined && Number(renderQuantity(next)) > max)) return value;
  return renderQuantity(next);
}
