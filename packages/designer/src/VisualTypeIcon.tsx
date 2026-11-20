import type { VisualType } from "@floem/client";

/** Görsel seçiminde türün gerçek biçimini gösteren küçük önizleme. */
export function VisualTypeIcon({ type }: { type: VisualType }) {
  const frame = <path d="M3 3.5h26v25H3z" fill="none" stroke="currentColor" strokeOpacity=".28" strokeWidth="1" />;
  const bar = (x: number, y: number, h: number, light = false) =>
    <rect key={`${x}-${y}`} x={x} y={y} width="4" height={h} rx=".7" fill="currentColor" opacity={light ? ".48" : "1"} />;
  let content;
  switch (type) {
    case "lineage": content = <><path d="M8 16h8m0 0 8-8m-8 8 8 8" fill="none" stroke="currentColor" strokeWidth="2" />{[[6,16],[17,16],[25,7],[25,25]].map(([cx,cy]) => <circle key={cx+cy} cx={cx} cy={cy} r="3" fill="currentColor" />)}</>; break;
    case "tolerance": content = <><path d="M4 16h24" stroke="currentColor" strokeWidth="2" opacity=".4" /><rect x="10" y="11" width="12" height="10" fill="currentColor" opacity=".25" /><path d="M17 7v18" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2" /><circle cx="13" cy="16" r="3" fill="currentColor" /></>; break;
    case "icon": content = <><circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m10 16 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.5" /></>; break;
    case "repeater": content = <>{[5,13,21].map(y=><g key={y}><rect x="5" y={y} width="22" height="6" rx="1.5" fill="none" stroke="currentColor"/><circle cx="9" cy={y+3} r="1.4" fill="currentColor"/><path d={`M13 ${y+3}h10`} stroke="currentColor"/></g>)}</>; break;
    case "column":
    case "stackedcolumn":
      content = <>{[5, 11, 17, 23].map((x, i) => <g key={x}>{bar(x, [15, 9, 13, 6][i], [11, 17, 13, 20][i])}{type === "stackedcolumn" && <rect x={x} y={[10, 5, 8, 3][i]} width="4" height="4" fill="currentColor" opacity=".45" />}</g>)}</>;
      break;
    case "bar":
    case "stackedbar":
      content = <>{[8, 15, 22].map((y, i) => <g key={y}><rect x="6" y={y} width={[17, 11, 20][i]} height="4" rx=".7" fill="currentColor" />{type === "stackedbar" && <rect x={[19, 13, 22][i]} y={y} width="5" height="4" fill="currentColor" opacity=".45" />}</g>)}</>;
      break;
    case "line":
    case "area":
      content = <>{type === "area" && <path d="M5 25 10 19 15 21 21 10 27 13V26H5Z" fill="currentColor" opacity=".18" />}<path d="m5 25 5-6 5 2 6-11 6 3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />{[5, 10, 15, 21, 27].map((x, i) => <circle key={x} cx={x} cy={[25, 19, 21, 10, 13][i]} r="1.6" fill="currentColor" />)}</>;
      break;
    case "pie":
    case "donut":
      content = <><circle cx="16" cy="16" r="10" fill="currentColor" opacity=".18" /><path d="M16 16V6a10 10 0 0 1 9.5 13z" fill="currentColor" /><path d="M16 16 25.5 19A10 10 0 0 1 9 23z" fill="currentColor" opacity=".6" />{type === "donut" && <circle cx="16" cy="16" r="4.7" fill="var(--surface, #fff)" />}</>;
      break;
    case "table":
    case "matrix":
    case "treegrid":
      content = <><rect x="5" y="6" width="22" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5 11h22M5 16h22M5 21h22M12 6v20M19 6v20" stroke="currentColor" strokeWidth="1" opacity=".8" />{type === "matrix" && <><rect x="5" y="6" width="22" height="5" fill="currentColor" opacity=".22" /><rect x="5" y="11" width="7" height="15" fill="currentColor" opacity=".22" /></>}{type === "treegrid" && <path d="M7 13h4m-2-2v4m2 5h6m-3-3v6m3-6h8" stroke="currentColor" strokeWidth="1.3" />}</>;
      break;
    case "scatter":
      content = <><path d="M5 6v20h23" fill="none" stroke="currentColor" strokeWidth="1" opacity=".45" />{[[9, 22, 2], [13, 14, 3], [18, 19, 2], [22, 10, 3.5], [26, 14, 2]].map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} fill="currentColor" opacity={x === 22 ? "1" : ".65"} />)}</>;
      break;
    case "treemap":
      content = <><rect x="5" y="6" width="12" height="20" fill="currentColor" /><rect x="18" y="6" width="9" height="8" fill="currentColor" opacity=".7" /><rect x="18" y="15" width="9" height="11" fill="currentColor" opacity=".4" /></>;
      break;
    case "heatmap":
      content = <>{[0, 1, 2, 3].flatMap((row) => [0, 1, 2, 3].map((col) => <rect key={`${row}-${col}`} x={5 + col * 6} y={5 + row * 6} width="5" height="5" fill="currentColor" opacity={String(.2 + ((row * 3 + col * 5) % 7) / 9)} />))}</>;
      break;
    case "waterfall":
      content = <><path d="M5 24h6m0-9h6m0 4h6" stroke="currentColor" strokeOpacity=".4" />{bar(6, 17, 9)}{bar(12, 10, 7, true)}{bar(18, 16, 5)}{bar(24, 7, 19)}</>;
      break;
    case "gauge":
      content = <><path d="M6 23a11 11 0 0 1 20 0" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="4" /><path d="M6 23a11 11 0 0 1 14-10" fill="none" stroke="currentColor" strokeWidth="4" /><path d="m16 23 5-8" stroke="currentColor" strokeWidth="1.7" /><circle cx="16" cy="23" r="2" fill="currentColor" /></>;
      break;
    case "progress":
      content = <><rect x="5" y="12" width="22" height="8" rx="4" fill="currentColor" opacity=".22" /><rect x="5" y="12" width="15" height="8" rx="4" fill="currentColor" /></>;
      break;
    case "card":
    case "multicard":
    case "kpi":
    case "ticker":
      content = <><path d="M7 10h11M7 15h17" stroke="currentColor" strokeOpacity=".38" strokeWidth="1.5" />{type === "multicard" ? <path d="M7 20h16M7 25h12" stroke="currentColor" strokeWidth="2.4" /> : <><path d="M7 23h12" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />{(type === "kpi" || type === "ticker") && <path d="m22 24 3-4 3 2" fill="none" stroke="currentColor" strokeWidth="2" />}</>}</>;
      break;
    case "slicer":
      content = <>{[9, 16, 23].map((y, i) => <g key={y}><rect x="6" y={y - 3} width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />{i === 0 && <path d="m7 8 1.5 1.5L11 6" fill="none" stroke="currentColor" strokeWidth="1.4" />}<path d={`M14 ${y}h12`} stroke="currentColor" strokeWidth="1.5" opacity=".6" /></g>)}</>;
      break;
    case "text":
      content = <><path d="M7 10h18M11 10v15m10-15v15" stroke="currentColor" strokeWidth="2" /><path d="M7 25h8m2 0h8" stroke="currentColor" strokeWidth="1.5" /></>;
      break;
    case "container":
      content = <><rect x="4" y="5" width="24" height="22" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" /><rect x="8" y="10" width="6" height="12" rx="1" fill="currentColor" opacity=".65" /><rect x="17" y="10" width="7" height="5" rx="1" fill="currentColor" /><rect x="17" y="18" width="7" height="4" rx="1" fill="currentColor" opacity=".35" /></>;
      break;
    case "shape":
      content = <><rect x="6" y="9" width="20" height="14" rx="4" fill="currentColor" opacity=".7" /><path d="M8 19h16" stroke="var(--surface, #fff)" strokeWidth="1.5" opacity=".75" /></>;
      break;
    case "image":
      content = <><rect x="5" y="6" width="22" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="11" cy="12" r="2" fill="currentColor" /><path d="m7 23 7-7 4 4 3-3 4 6" fill="none" stroke="currentColor" strokeWidth="1.7" /></>;
      break;
    case "button":
      content = <><rect x="5" y="10" width="22" height="13" rx="4" fill="currentColor" opacity=".85" /><path d="M10 16.5h12m-4-3 4 3-4 3" fill="none" stroke="var(--surface, #fff)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></>;
      break;
    default:
      content = <circle cx="16" cy="16" r="9" fill="currentColor" />;
  }
  return <svg className="viz-type-icon" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false">{frame}{content}</svg>;
}
