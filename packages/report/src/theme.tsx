import type { ThemeSnapshot, Visual } from "@floem/client";
import { createContext, useContext, type CSSProperties, type HTMLAttributes } from "react";

export const THEME_FAMILIES = [
  { id: "electric", name: "Electric Blue", primary: "#0866E8", darkAccent: "#76ACFF", secondary: "#0755C8", accent: "#00C8F0", bg: "#0B1628", surface: "#12233B" },
  { id: "indigo", name: "Midnight Indigo", primary: "#5146E5", darkAccent: "#ADA5FF", secondary: "#3730A3", accent: "#8B7CFF", bg: "#111326", surface: "#1B1D38" },
  { id: "emerald", name: "Emerald Intelligence", primary: "#047857", darkAccent: "#56DCB0", secondary: "#065F46", accent: "#2DD4BF", bg: "#0B1918", surface: "#142B28" },
  { id: "arctic", name: "Arctic Cyan", primary: "#0E7490", darkAccent: "#67D9F0", secondary: "#155E75", accent: "#22D3EE", bg: "#0B1720", surface: "#132733" },
  { id: "graphite", name: "Graphite & Orange", primary: "#C2410C", darkAccent: "#FFAB70", secondary: "#9A3412", accent: "#FBBF24", bg: "#111318", surface: "#20242C" },
] as const;

export function createTheme(id = "electric", mode: ThemeSnapshot["mode"] = "light"): ThemeSnapshot {
  const family = THEME_FAMILIES.find((f) => f.id === id) ?? THEME_FAMILIES[0];
  const dark = mode === "dark";
  return { id: family.id, version: 1, mode, density: "compact", reducedMotion: false,
    colors: {
      bg: dark ? family.bg : "#F5F7FA", surface: dark ? family.surface : "#FFFFFF",
      surface2: dark ? family.bg : "#F0F4F8", text: dark ? "#F5F8FF" : "#172033",
      muted: dark ? "#B0BED0" : "#526277", border: dark ? "#40546B" : "#D5DEE9",
      strong: dark ? "#637A94" : "#8090A4", primary: dark ? family.darkAccent : family.primary,
      secondary: family.secondary, accent: family.accent, onPrimary: dark ? family.bg : "#FFFFFF",
      selected: dark ? "#283E56" : "#E5EEFA", success: dark ? "#6EE7A0" : "#166534",
      warning: dark ? "#FCD34D" : "#854D0E", danger: dark ? "#FDA4AF" : "#9F1239",
      info: dark ? "#93C5FD" : "#1D4ED8",
    },
    series: [dark ? family.darkAccent : family.primary, dark ? "#5EEAD4" : "#0F766E", dark ? "#C4B5FD" : "#7C3AED",
      dark ? "#FDBA74" : "#C2410C", dark ? "#F9A8D4" : "#BE185D", dark ? "#A3E635" : "#4D7C0F", dark ? "#FDE047" : "#A16207", dark ? "#CBD5E1" : "#475569"],
  };
}

export const DEFAULT_THEME = createTheme();
export function resolveTheme(theme: ThemeSnapshot): ThemeSnapshot {
  const base = createTheme(theme.id, theme.mode);
  const colors = Object.fromEntries(Object.entries(theme.colors).filter(([, value]) => /^#[0-9a-f]{6}$/i.test(value)));
  return { ...base, ...theme, colors: { ...base.colors, ...colors } };
}
const ThemeContext = createContext<ThemeSnapshot | null>(null);
export const useReportTheme = () => useContext(ThemeContext);
const roles: Record<string, string> = { bg: "bg", surface: "surface", "surface-2": "surface2", text: "text", muted: "muted",
  border: "border", "border-strong": "strong", accent: "primary", "accent-text": "onPrimary", "accent-soft": "selected",
  danger: "danger", success: "success", warning: "warning", info: "info", focus: "primary" };

export function themeStyle(theme: ThemeSnapshot = DEFAULT_THEME): CSSProperties {
  const safe = resolveTheme(theme);
  return { ...Object.fromEntries(Object.entries(roles).map(([css, role]) => [`--${css}`, safe.colors[role]])),
    colorScheme: safe.mode, color: safe.colors.text, fontFamily: '"Segoe UI", system-ui, sans-serif',
    "--font": '"Segoe UI", system-ui, sans-serif', "--radius": "8px", "--space-1": "4px", "--space-2": "8px",
    "--space-3": "12px", "--space-4": "16px", "--space-6": "24px", "--space-8": "32px", "--space-12": "48px", "--space-16": "64px",
    "--type-heading": "24px", "--type-body": "13px", "--type-label": "12px", "--type-caption": "11px",
    "--row-height": safe.density === "comfortable" ? "38px" : "30px", "--theme-motion": safe.reducedMotion ? "0ms" : "160ms",
  } as CSSProperties;
}

export function ReportThemeScope({ theme, style, children, rootRef, ...props }: HTMLAttributes<HTMLDivElement> & { theme?: ThemeSnapshot | null; rootRef?: import("react").Ref<HTMLDivElement> }) {
  return <ThemeContext.Provider value={theme ? resolveTheme(theme) : null}><div {...props} ref={rootRef} data-report-theme={theme?.id ?? "legacy"}
    data-theme-mode={theme?.mode ?? "light"} data-reduced-motion={theme?.reducedMotion || undefined}
    style={{ ...themeStyle(theme ?? DEFAULT_THEME), ...style }}>{children}</div></ThemeContext.Provider>;
}

/** Yalnız görüntüleme sırasında çözülür; kullanıcının kayıtlı nesne ayarlarını değiştirmez. */
export function themedVisual(v: Visual, theme?: ThemeSnapshot | null): Visual {
  if (!theme) return v;
  theme = resolveTheme(theme);
  return { ...v, format: { colors: theme.series, backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
    titleColor: theme.colors.text, color: theme.colors.text, fontFamily: '"Segoe UI", system-ui, sans-serif',
    buttonColor: theme.colors.primary, buttonTextColor: theme.colors.onPrimary,
    animationDuration: 500, ...v.format, ...(theme.reducedMotion ? { animation: "none" } : {}) } };
}
