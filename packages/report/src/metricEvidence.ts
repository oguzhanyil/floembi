import type { MetricEvidence } from "@floem/client";
/** Yalnız makbuz alanları; eski Analytics kartının sayısı sürümsüz kanıt sayılmaz. */
export function readMetricEvidence(text: string): MetricEvidence {
  if (text.length > 65536) throw new Error("Ölçü kanıtı 64 KB sınırını aşıyor.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Ölçü kanıtı geçerli JSON olmalı."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Ölçü makbuzu bekleniyor.");
  const r = value as Record<string, unknown>;
  if (r.protocol !== "floem-metric/v1" || !["metricId", "metricVersion", "snapshot", "contextHash"].every((k) => typeof r[k] === "string" && !!r[k]) || !(r.dataTime === null || typeof r.dataTime === "string") || !(r.value === null || typeof r.value === "number" && Number.isFinite(r.value)))
    throw new Error("Bu sonuç ölçü/firma/filtre/veri sürümü makbuzu taşımıyor. Analytics'in eski kart JSON'u karşılaştırma için yeterli değil.");
  if (String(r.metricId).length > 100 || ["metricVersion", "snapshot", "contextHash"].some((k) => !/^[a-f0-9]{64}$/.test(String(r[k]))) || typeof r.dataTime === "string" && (r.dataTime.length > 40 || !/(Z|[+-]\d\d:\d\d)$/.test(r.dataTime) || !Number.isFinite(Date.parse(r.dataTime))))
    throw new Error("Ölçü makbuzunun sürüm alanları geçersiz.");
  return { protocol: r.protocol, metricId: String(r.metricId), metricVersion: String(r.metricVersion), snapshot: String(r.snapshot), contextHash: String(r.contextHash), dataTime: r.dataTime as string | null, value: r.value as number | null };
}
