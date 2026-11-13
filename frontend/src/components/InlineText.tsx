import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";

// 行内编辑：平时就是一段文字，悬停出现浅底色和小铅笔；点一下原地变成同样字号的输入框。
// 回车（多行是 Ctrl/⌘ + 回车）或点外面保存，Esc 放弃。只在值真的变了才提交。
// 中文输入法用回车确认候选词时（isComposing）不能当成保存。
// 显示的值由父组件给（父组件负责乐观更新和失败回滚），这里只管编辑态。
export default function InlineText({
  value,
  label,
  placeholder,
  maxLength,
  multiline = false,
  trigger = "click",
  className = "",
  onCommit,
}: {
  value: string;
  label: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  // click：点文字本身进入编辑（名称）；hover-button：文字只读，悬停出现「更改」按钮（描述，和其他属性行一致）
  trigger?: "click" | "hover-button";
  className?: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // 回车保存后输入框卸载，部分浏览器还会补发一次 blur：用 ref 挡掉第二次提交；Esc 同理
  const done = useRef(false);

  function start() {
    done.current = false;
    setDraft(value);
    setEditing(true);
  }

  // 进入编辑：聚焦、光标放到末尾；多行时高度跟着内容长
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!editing || !el) return;
    if (multiline) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing, draft, multiline]);
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (!save) return;
    const next = multiline ? draft.trim() : draft.replace(/\s+/g, " ").trim();
    if (next !== value.trim()) onCommit(next);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // 别把外层单品页也关了
      finish(false);
      return;
    }
    if (e.key === "Enter" && !e.nativeEvent.isComposing && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish(true);
    }
  }

  if (editing) {
    const common = {
      value: draft,
      maxLength,
      "aria-label": label,
      placeholder,
      className: "inline-text-field",
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onKeyDown,
      onBlur: () => finish(true),
    };
    return (
      <div className={`inline-text is-editing${multiline ? " is-multiline" : ""} ${className}`}>
        {multiline ? <textarea ref={fieldRef} rows={3} {...common} /> : <input ref={fieldRef} type="text" {...common} />}
        <div className="inline-text-hint" aria-hidden="true">
          <span>{multiline ? "Ctrl / ⌘ + 回车 或点外面保存 · Esc 取消" : "回车保存 · Esc 取消"}</span>
          <span>
            {draft.length}/{maxLength}
          </span>
        </div>
      </div>
    );
  }

  if (trigger === "hover-button") {
    return (
      <div className={`inline-text-static${value ? "" : " is-empty"} ${className}`}>
        <span className="inline-text-value">{value || placeholder}</span>
        <button type="button" className="prop-change" aria-label={`更改${label}`} onClick={start}>
          更改
        </button>
      </div>
    );
  }

  return (
    <div
      className={`inline-text${multiline ? " is-multiline" : ""}${value ? "" : " is-empty"} ${className}`}
      role="button"
      tabIndex={0}
      aria-label={`编辑${label}`}
      onClick={start}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          start();
        }
      }}
    >
      <span className="inline-text-value">{value || placeholder}</span>
      <Pencil className="inline-text-icon" size={14} aria-hidden="true" />
    </div>
  );
}
