import { useEffect, useRef, useState } from "react";
import { useEscape } from "../useEscape";
import Portal from "./Portal";

// 灯箱：点图放大查看。支持滚轮 / ＋－按钮 / 键盘 +- 缩放，放大后可拖动平移。
// 点背景 / Esc / ✕ 关闭。
const MIN = 1;
const MAX = 8;
const STEP = 0.4;

const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s));

export default function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  // 缩放与平移合成一份状态：缩回原尺寸时平移必须同时归零，
  // 分成两份就得靠 useEffect 追 scale 再 setOffset（级联渲染 + 不纯）。
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false); // 仅用于光标样式，故进 state 而非 ref
  const drag = useRef<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const zoomBy = (d: number) =>
    setView((v) => {
      const scale = clamp(v.scale + d);
      return scale === MIN ? { scale, x: 0, y: 0 } : { ...v, scale };
    });

  useEscape(onClose);

  // 键盘缩放（Esc 由 useEscape 管）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") zoomBy(STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(-STEP);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 滚轮缩放：非 passive 才能 preventDefault（阻止页面一起滚）
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? STEP : -STEP);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    if (view.scale === MIN) return; // 未放大不平移
    drag.current = { x: e.clientX - view.x, y: e.clientY - view.y };
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, x: e.clientX - d.x, y: e.clientY - d.y }));
  }
  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <Portal>
      <div
        className="lightbox"
        ref={boxRef}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose(); // 仅点背景关闭
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          onClick={stop}
          onPointerDown={onPointerDown}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            cursor: view.scale > MIN ? (dragging ? "grabbing" : "grab") : "default",
          }}
        />

        <button className="lightbox-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>

        <div className="lightbox-controls" onClick={stop}>
          <button onClick={() => zoomBy(-STEP)} disabled={view.scale <= MIN} aria-label="缩小">
            －
          </button>
          <span className="lightbox-pct">{Math.round(view.scale * 100)}%</span>
          <button onClick={() => zoomBy(STEP)} disabled={view.scale >= MAX} aria-label="放大">
            ＋
          </button>
        </div>
      </div>
    </Portal>
  );
}
