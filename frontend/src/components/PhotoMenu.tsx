import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { MoreHorizontal } from "lucide-react";
import Portal from "./Portal";

export type PhotoMenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string; // 悬停提示，通常用来说明为什么不可用
};

const MENU_WIDTH = 168;

// 照片右上角的「⋯」菜单。照片格子 overflow:hidden，菜单必须 Portal 到 body 才不会被裁，
// 位置按触发按钮的 getBoundingClientRect 算（position: fixed）。
// 关闭时机：选中一项 / Esc / 点外面 / 页面滚动或改尺寸（fixed 定位会和按钮错开）。
export default function PhotoMenu({
  label,
  items,
  triggerClassName = "",
}: {
  label: string;
  items: PhotoMenuItem[];
  // 追加在触发按钮上：默认是盖在图片上的深色圆钮；放在白底工具栏里用 "plain"
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPos({ top: r.bottom + 4, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    const onViewportChange = () => close(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open]);

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      close(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={"photo-menu-trigger" + (triggerClassName ? ` ${triggerClassName}` : "") + (open ? " is-open" : "")}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          // 菜单常放在可点击的卡片里：别让点击冒泡到卡片（会打开详情）
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <Portal>
          <div
            ref={menuRef}
            className="photo-menu"
            role="menu"
            aria-label={label}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: MENU_WIDTH, visibility: pos ? "visible" : "hidden" }}
            // Portal 只改 DOM 位置，React 事件仍按组件树冒泡到外层卡片，这里截住
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              onMenuKeyDown(e);
            }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={"photo-menu-item" + (item.danger ? " danger" : "")}
                disabled={item.disabled}
                title={item.hint}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Portal>
      )}
    </>
  );
}
