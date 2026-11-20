import { useRef, useState } from "react";
import { rememberJourney } from "./reportJourney";

/** Geçmiş yalnız oturumda yaşar; rapor tanımına yazılmaz. */
export function useReportJourney<T>(restore: (snapshot: T) => void) {
  const stack = useRef<T[]>([]), latest = useRef(restore); latest.current = restore;
  const [count, setCount] = useState(0);
  return {
    count,
    push(snapshot: T) { stack.current = rememberJourney(stack.current, snapshot); setCount(stack.current.length); },
    back() {
      const snapshot = stack.current.pop();
      if (!snapshot) return false;
      setCount(stack.current.length); latest.current(snapshot); return true;
    },
    clear() { stack.current = []; setCount(0); },
  };
}
