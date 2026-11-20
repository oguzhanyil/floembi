/** Sınırda kalan ölçüm uygundur; boş/sayısal olmayan sonuç karar üretmez. */
export function toleranceState(value: unknown, low: unknown, high: unknown): "pass" | "fail" | "unknown" {
  if (![value, low, high].every((n) => typeof n === "number" && Number.isFinite(n)) || Number(low) > Number(high)) return "unknown";
  return Number(value) >= Number(low) && Number(value) <= Number(high) ? "pass" : "fail";
}
