import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// 把全屏覆盖层渲染到 document.body 下，脱离 .content（移动端是 -webkit-overflow-scrolling
// 惯性滚动容器）。iOS Safari 会裁剪/错位惯性滚动容器内的 position:fixed 子元素——
// 弹层/灯箱挂在 body 上即可绕过此 bug（见 docs/pitfalls.md）。
export default function Portal({ children }: { children: ReactNode }) {
  const [el] = useState(() => document.createElement("div"));
  useEffect(() => {
    document.body.appendChild(el);
    return () => {
      document.body.removeChild(el);
    };
  }, [el]);
  return createPortal(children, el);
}
