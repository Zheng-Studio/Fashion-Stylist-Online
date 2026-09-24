import { useEffect } from "react";

// Esc 关闭：挂在 document 上，卸载时摘掉。
// 只给「本来就支持 Esc 关闭」的覆盖层用——不要顺手给所有弹窗加，会改变既有行为。
export function useEscape(onEscape: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onEscape, enabled]);
}
