import type { ActionIcon } from "@floem/client";

export function ActionGlyph({ icon }: { icon: ActionIcon }) {
  if (icon === "none") return null;
  const path = icon === "back" ? <path d="m14 5-7 7 7 7M7 12h13" /> :
    icon === "refresh" ? <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 18 7l2 5M4 12l2 5A7 7 0 0 0 18.5 15" /></> :
    icon === "eye" ? <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></> :
    icon === "link" ? <><path d="M10 13a5 5 0 0 0 7 .1l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7-.1l-2 2a5 5 0 0 0 7 7l1.2-1.2" /></> :
    icon === "play" ? <path d="m7 4 13 8L7 20V4Z" /> :
    icon === "file" ? <><path d="M6 2h8l5 5v15H6V2Z" /><path d="M14 2v5h5M9 12h7M9 16h7" /></> :
    icon === "menu" ? <><path d="M4 7h16M4 12h16M4 17h16" /></> :
    <path d="M4 12h16m-7-7 7 7-7 7" />;
  return <svg className="action-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{path}</svg>;
}
