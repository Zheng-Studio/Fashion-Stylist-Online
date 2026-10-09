import type { ReactNode } from "react";
import Portal from "./Portal";
import { useEscape } from "../useEscape";

// 全站弹窗外壳：Portal + backdrop + head/body/foot。
// 点遮罩关闭靠 target === currentTarget 判定，等价于原先「backdrop onClick + 内容 stopPropagation」。
//
// 刻意保留的差异（各调用点行为不同，不要借机统一）：
// - closeOnEscape 默认关：原先只有 Inspector / PromptsModal 支持 Esc，别的弹窗没有。
// - bodyClassName：推理过程类弹窗用 .inspector-body 而非 .modal-body。
export default function Modal({
  title,
  children,
  footer,
  className = "",
  bodyClassName = "modal-body",
  onClose,
  closeOnEscape = false,
}: {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string; // 追加在 .modal 上，如 modal-narrow / item-form-modal
  bodyClassName?: string;
  onClose: () => void;
  closeOnEscape?: boolean;
}) {
  useEscape(onClose, closeOnEscape);
  return (
    <Portal>
      <div
        className="modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className={"modal" + (className ? ` ${className}` : "")}>
          <div className="modal-head">
            {title}
            <button className="icon-btn" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          </div>
          <div className={bodyClassName}>{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}
