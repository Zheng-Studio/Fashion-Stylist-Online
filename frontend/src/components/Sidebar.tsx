import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface SidebarItem<K extends string> {
  key: K;
  label: string;
  Icon: LucideIcon;
}

// 左侧导航栏：桌面用它取代顶栏 tab —— 品牌在顶、导航在中、退出钉底。
//
// **只在桌面渲染出来**（≤640px 由 CSS 隐藏）：移动端走底部 tabbar，
// 那边的键盘收起 / 安全区 / visualViewport 适配都调好了，不动它最稳。
// 所以顶栏（.topbar）并没有从 DOM 里删掉，只是桌面隐藏、移动端照常显示。
export default function Sidebar<K extends string>({
  brand,
  items,
  active,
  onSelect,
  footer,
}: {
  brand: ReactNode;
  items: SidebarItem<K>[];
  active: K;
  onSelect: (key: K) => void;
  footer?: ReactNode; // 钉在底部，一般放「退出」
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">{brand}</div>
      <nav className="sidebar-nav">
        {items.map((it) => {
          const on = active === it.key;
          return (
            <button
              key={it.key}
              type="button"
              className={"sidebar-item" + (on ? " active" : "")}
              aria-current={on ? "page" : undefined}
              onClick={() => onSelect(it.key)}
            >
              <it.Icon size={20} />
              <span>{it.label}</span>
            </button>
          );
        })}
      </nav>
      {footer && <div className="sidebar-foot">{footer}</div>}
    </aside>
  );
}
