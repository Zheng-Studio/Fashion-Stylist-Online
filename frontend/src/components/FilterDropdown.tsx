import { useEffect, useRef, useState } from "react";

export interface FilterOption {
  value: string;
  label: string;
}

interface Props {
  label: string; // "衣橱" / "类目"
  options: FilterOption[];
  selected: string[]; // 空数组 = 全部（不过滤）；single 时长度 0 或 1
  onChange: (selected: string[]) => void;
  single?: boolean; // true = 单选（radio，选完即收起）
}

// 下拉过滤：默认全部（selected 为空），勾选哪些就只看哪些。
// 「全部」一项点了即清空选择回到不过滤。点组件外部自动收起。
// single=true 时为单选：选某项替换选择并收起面板。
export default function FilterDropdown({ label, options, selected, onChange, single }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function toggle(v: string) {
    if (single) {
      onChange([v]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }

  function selectAll() {
    onChange([]);
    if (single) setOpen(false);
  }

  // 触发按钮上的摘要：全部 / 单个标签 / N 项
  const summary =
    selected.length === 0
      ? "全部"
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} 项`;

  return (
    <div className="filter-dd" ref={ref}>
      <button
        type="button"
        className={"filter-dd-trigger" + (selected.length ? " active" : "")}
        onClick={() => setOpen((v) => !v)}
      >
        {label}：{summary} <span className="caret">▾</span>
      </button>
      {open && (
        <div className="filter-dd-panel">
          <label className="filter-dd-opt">
            <input
              type={single ? "radio" : "checkbox"}
              name={single ? `fdd-${label}` : undefined}
              checked={selected.length === 0}
              onChange={selectAll}
            />
            全部
          </label>
          <div className="filter-dd-sep" />
          {options.map((o) => (
            <label key={o.value} className="filter-dd-opt">
              <input
                type={single ? "radio" : "checkbox"}
                name={single ? `fdd-${label}` : undefined}
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
