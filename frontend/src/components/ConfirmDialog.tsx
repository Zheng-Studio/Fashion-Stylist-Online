import Modal from "./Modal";

// 应用内二次确认弹窗，取代 window.confirm。
// 浏览器原生 confirm 的问题：样式完全不受控、和全站设计割裂，
// 且在 iOS 独立 PWA 里会弹出带域名的系统级弹层，观感很出戏。
// 走 Modal 外壳，所以点遮罩 / Esc / ✕ 都等于取消。
export default function ConfirmDialog({
  title,
  message,
  confirmText = "确定",
  cancelText = "取消",
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean; // 删除类操作：确认按钮转红，和普通确认区分开
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      className="modal-narrow"
      title={<span>{title}</span>}
      onClose={onCancel}
      closeOnEscape
      footer={
        <>
          <button className="btn-ghost" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className={"btn-primary" + (danger ? " danger" : "")}
            onClick={onConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </>
      }
    >
      <p className="confirm-text">{message}</p>
    </Modal>
  );
}
