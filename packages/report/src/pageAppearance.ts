import type { ReportPage, ThemeSnapshot } from "@floem/client";
import type { CSSProperties } from "react";
import { DEFAULT_THEME, resolveTheme } from "./theme";

/** Yüzde yalnız zemin renginin alfasını değiştirir; nesnelere opacity uygulanmaz. */
export function transparentColor(color: string, transparency = 0): string {
  const opacity = 1 - Math.max(0, Math.min(100, transparency)) / 100;
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) {
    const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    const alpha = (color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1) * opacity;
    return `rgba(${rgb.join(", ")}, ${Number(alpha.toFixed(6))})`;
  }
  return opacity === 1 ? color : `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`;
}
export const pageBaseColor = (theme?: ThemeSnapshot | null) => resolveTheme(theme ?? DEFAULT_THEME).colors.bg;
export const pageBackground = (page: ReportPage, theme?: ThemeSnapshot | null) => transparentColor(page.backgroundColor || pageBaseColor(theme), page.backgroundTransparency);
/** Resmin alfası ayrı katmanda; rapor nesnelerini saydamlaştırmaz. */
export function pageImageStyle(page: ReportPage): CSSProperties {
  const data = page.backgroundImageData;
  const valid = data && data.length <= 2800000 && /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(data);
  return { "--page-background-image": valid ? `url("${data}")` : "none",
    "--page-background-size": page.backgroundImageFit === "cover" ? "cover" : "contain",
    "--page-background-opacity": 1 - Math.max(0, Math.min(100, page.backgroundTransparency ?? 0)) / 100 } as CSSProperties;
}
export const initialZoom = (option?: ReportPage["displayOption"]): "fit" | "width" | number => option === "FitToWidth" ? "width" : option === "ActualSize" ? 1 : "fit";
