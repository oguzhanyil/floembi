import type { Visual } from "@floem/client";
import type { CSSProperties } from "react";

const clamp = (value: number | undefined, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

/** Aynı biçim Desktop ve web görüntüleyicide uygulanır. */
export function visualStyle(visual: Visual): CSSProperties {
  const f = visual.format;
  const radius = f.shapeStyle === "pill" ? 999 : clamp(f.radius, 0, 40, 8);
  return {
    backgroundColor: f.backgroundColor || undefined,
    borderColor: f.borderColor || undefined,
    borderWidth: clamp(f.borderWidth, 0, 8, 1),
    borderRadius: radius,
    boxShadow: f.shadow ? "0 10px 28px rgba(9, 32, 68, .18)" : undefined,
    opacity: clamp(f.opacity, 0, 1, 1),
    "--visual-opacity": clamp(f.opacity, 0, 1, 1),
    "--visual-padding": `${clamp(f.padding, 0, 32, 8)}px`,
    "--visual-title-color": f.titleColor || undefined,
    "--visual-title-size": `${clamp(f.titleSize, 10, 28, 12)}px`,
    "--motion-duration": `${clamp(f.animationDuration, 150, 3000, 500)}ms`,
    "--shape-color": f.backgroundColor || "#2a78d6",
  } as CSSProperties;
}

export function visualMotion(visual: Visual): string {
  const motion = visual.format.animation;
  return motion === "fade" || motion === "rise" || motion === "pulse" ? `motion-${motion}` : "";
}
