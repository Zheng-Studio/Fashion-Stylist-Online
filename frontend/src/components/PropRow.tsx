import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

// 单品页里的一行属性：平时只显示当前值；悬停这一行出现「更改」，点开原地展开选项。
// 单选（品类 / 性别）：点一个就保存并收起。多选（季节）：点选项即时切换保存，「完成」或点外面收起。
// Esc 收起（不关整个单品页）。值的保存和回滚由父组件负责，这里只管展示和编辑态。
export default function PropRow<T extends string>({
  label,
  value,
  options,
  optionLabel = (o) => o,
  multiple = false,
  emptyText = "未设置",
  onChange,
}: {
  label: string;
  value: T[];
  options: readonly T[];
  optionLabel?: (o: T) => string;
  multiple?: boolean;
  emptyText?: string;
  onChange: (next: T[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close(focusBack: boolean) {
    setEditing(false);
    if (focusBack) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  // 点外面收起
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setEditing(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [editing]);

  // 展开后把焦点放到当前选中的那个（没有就第一个），键盘可以直接接着选
  useEffect(() => {
    if (!editing) return;
    const el = rowRef.current?.querySelector<HTMLButtonElement>(".chip.on") ?? rowRef.current?.querySelector<HTMLButtonElement>(".chip");
    el?.focus();
  }, [editing]);

  function pick(o: T) {
    if (multiple) {
      const next = value.includes(o) ? value.filter((x) => x !== o) : [...value, o];
      onChange(options.filter((x) => next.includes(x))); // 保持选项原本的顺序
      return;
    }
    if (!value.includes(o)) onChange([o]);
    close(true);
  }

  const shown: ReactNode = value.length ? value.map(optionLabel).join(" · ") : <span className="prop-empty">{emptyText}</span>;

  return (
    <div
      ref={rowRef}
      className={"prop-row" + (editing ? " is-editing" : "")}
      onKeyDown={(e) => {
        if (editing && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation(); // 只收起这一行，别把单品页也关了
          close(true);
        }
      }}
    >
      <div className="prop-label">{label}</div>
      {editing ? (
        <div className="prop-edit">
          <div className="prop-options" role={multiple ? "group" : "radiogroup"} aria-label={label}>
            {options.map((o) => {
              const on = value.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  role={multiple ? undefined : "radio"}
                  aria-checked={multiple ? undefined : on}
                  aria-pressed={multiple ? on : undefined}
                  className={"chip" + (on ? " on" : "")}
                  onClick={() => pick(o)}
                >
                  {optionLabel(o)}
                </button>
              );
            })}
          </div>
          {multiple && (
            <button type="button" className="prop-done" onClick={() => close(true)}>
              <Check size={14} aria-hidden="true" />
              完成
            </button>
          )}
        </div>
      ) : (
        <div className="prop-value">
          <span className="prop-text">{shown}</span>
          <button ref={triggerRef} type="button" className="prop-change" aria-label={`更改${label}`} onClick={() => setEditing(true)}>
            更改
          </button>
        </div>
      )}
    </div>
  );
}
