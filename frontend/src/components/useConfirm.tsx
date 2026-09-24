import { useCallback, useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

// Promise 化的应用内二次确认，用来替掉 window.confirm。
// 调用点写法和原来几乎一样，只是多一个 await：
//     if (!(await confirm({ title, message }))) return;
// 调用方只需：1) 解构出 confirm / dialog；2) 把 dialog 渲染进自己的树。
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function settle(ok: boolean) {
    setOpts(null);
    resolveRef.current?.(ok);
    resolveRef.current = null;
  }

  const dialog = opts ? (
    <ConfirmDialog {...opts} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
  ) : null;

  return { confirm, dialog };
}
