import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface TableMenuItem { label: string; action: () => void; disabled?: boolean; separator?: boolean }
export interface TableMenuPosition { x: number; y: number; origin: HTMLElement }

/** Portal: tuval ölçeği ve görselin overflow sınırı menüyü etkilemez. */
export function TableMenu({ position, items, onClose }: {
  position: TableMenuPosition; items: TableMenuItem[]; onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState({ x: position.x, y: position.y });
  useLayoutEffect(() => {
    const el = menu.current!;
    const rect = el.getBoundingClientRect();
    setPoint({ x: Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8)) });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: Event) => { if (!el.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", onClose);
    };
  }, [position, onClose]);
  const close = () => { onClose(); if (position.origin.isConnected) position.origin.focus({ preventScroll: true }); };
  return createPortal(<div ref={menu} className="v-table-menu" role="menu" aria-label="Tablo işlemleri"
    style={{ left: point.x, top: point.y }} onPointerDown={(e) => e.stopPropagation()}
    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === "Escape" || e.key === "Tab") { if (e.key === "Escape") e.preventDefault(); close(); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (index + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    {items.map((item) => <button key={item.label} role="menuitem" type="button" disabled={item.disabled}
      className={item.separator ? "v-table-menu-separator" : undefined}
      onClick={(e) => { e.stopPropagation(); close(); item.action(); }}>{item.label}</button>)}
  </div>, document.body);
}
