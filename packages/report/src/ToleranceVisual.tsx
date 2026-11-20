import type { VisualFormat, VisualResult } from "@floem/client";
import { formatValue as formatScalar } from "./reportUtils";
import { toleranceState } from "./processValues";
import "./processVisuals.css";
const formatValue = (value: unknown) => formatScalar(value, undefined);
export function ToleranceVisual({ result, format }: { result: VisualResult; format: VisualFormat }) {
  const groups = result.columns.filter((c) => c.kind === "group").length;
  return <div className="v-tolerances">
    <p className="v-process-note">Her satır bir ölçüm kaydıdır. Kabul sınırları dahildir; farklı birimler toplanmaz.</p>
    {result.truncated && <p className="v-process-warning">Ölçüm sorgusu sınırda kesildi; tüm sonuçlar gösterilmiyor.</p>}
    {result.rows.map((row, i) => { const [value, low, high, target] = row.slice(groups), state = toleranceState(value, low, high);
      const label = row.slice(0, groups).filter((x) => x != null).join(" · ") || `Ölçüm ${i + 1}`;
      const nums = [value, low, high, target].filter((n): n is number => typeof n === "number" && Number.isFinite(n));
      const min = Math.min(...nums), max = Math.max(...nums), pad = Math.max((max - min) * .15, Math.abs(max) * .01, .01);
      const x = (n: number) => 12 + (n - min + pad) / (max - min + 2 * pad) * 376;
      return <section key={JSON.stringify(row.slice(0, groups)) + i} className={`v-tolerance v-tolerance-${state}`} aria-label={label}>
        <div><strong>{label}</strong><span>{state === "pass" ? "✓ Uygun" : state === "fail" ? "! Sınır dışı" : "? Doğrulanamadı"}</span></div>
        <p>Ölçüm: <b>{formatValue(value) || "Yok"}</b> · Alt: {formatValue(low) || "Yok"} · Üst: {formatValue(high) || "Yok"}{target != null ? ` · Hedef: ${formatValue(target)}` : ""}</p>
        {state !== "unknown" && <svg viewBox="0 0 400 44" role="img" aria-label={`${label}: ${formatValue(value)}; kabul ${low} ile ${high}`}>
          <line x1="12" x2="388" y1="22" y2="22" stroke="currentColor" opacity=".2" strokeWidth="5" />
          <rect x={x(Number(low))} y="14" width={Math.max(2, x(Number(high)) - x(Number(low)))} height="16" rx="3" fill={format.color || "#22a385"} opacity=".3" />
          {typeof target === "number" && Number.isFinite(target) && <path d={`M${x(target)} 7v30`} stroke="currentColor" strokeDasharray="3 2" />}
          <circle cx={x(Number(value))} cy="22" r="6" fill={state === "fail" ? "#be123c" : format.color || "#0f766e"} />
        </svg>}
        {state === "unknown" && <small>Eksik/sayısal olmayan ölçüm veya ters alt–üst sınır. Ortalama ile otomatik karar verilmez.</small>}
      </section>;
    })}
    {!result.rows.length && <p role="status">Bu seçim için kalite ölçümü yok.</p>}
  </div>;
}
