const SCALE = 1_000_000;

function scaled(value: number): number {
  return Math.round(value * SCALE);
}

function render(value: number): string {
  const whole = Math.trunc(value / SCALE);
  const fraction = String(value % SCALE).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function casualUseAll(stockValue: number): string {
  return render(scaled(stockValue));
}

export function casualUseHalf(stockValue: number): string | null {
  const total = scaled(stockValue);
  const half = Math.round(total / 2);
  return half > 0 && half < total ? render(half) : null;
}

export function casualUseRemaining(stockValue: number, quantity: string): string | null {
  const amount = Number(quantity);
  if (!quantity.trim() || !Number.isFinite(amount) || amount <= 0 || amount > stockValue) return null;
  return render(Math.max(0, scaled(stockValue) - scaled(amount)));
}
