import { useEffect, useRef, useState } from "react";
import { uploadAvatar } from "../api";
import type { Me } from "../types";
import { assetUrl, errMsg } from "../utils";
import Modal from "./Modal";
import { CropStage, SourcePicker } from "./AvatarCropUI";

// 头像裁切：选来源 → 圆形取景框拖拽定位+缩放 → Canvas 裁切 → 上传替换 avatar。
// 调用方只管：1) 渲染 dialog；2) 放触发按钮调 openCrop(src?)。
// 传 src 则跳过来源选择直接进裁切；不传则先选来源（从 photos 里选或上传新图）。
// onUploaded：上传成功后回调（拿到更新后的 Me），调用方据此刷新。
export function useAvatarCropper(photos: string[], onUploaded: (m: Me) => void) {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState<"source" | "crop">("source");
  const [sourceUrl, setSourceUrlState] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 拖拽状态（ref 避免闭包陈旧）
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; baseScale: number } | null>(null);
  // 图片原始尺寸（裁剪时约束边界用）
  const imgSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  // 最小缩放（图片刚好覆盖圆圈时的 scale）。渲染时要读（滑杆 min），故用 state 不用 ref。
  const [minScale, setMinScale] = useState(1);
  // 对象 URL 需要清理
  const objectUrlRef = useRef<string | null>(null);

  // 换来源后自动居中：加载图片 → 按短边填满圆形 → 居中
  useEffect(() => {
    if (!sourceUrl) return;
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      imgSizeRef.current = { w: iw, h: ih };
      const v = CROP_SIZE;
      const fit = Math.max(v / iw, v / ih);
      setMinScale(fit);
      setScale(fit);
      setOffset({
        x: (v - iw * fit) / 2,
        y: (v - ih * fit) / 2,
      });
    };
    img.src = sourceUrl;
    return () => { cancelled = true; };
  }, [sourceUrl]);

  function setSourceUrl(url: string | null) {
    setSourceUrlState((prev) => {
      if (prev && prev === objectUrlRef.current) {
        URL.revokeObjectURL(prev);
        objectUrlRef.current = null;
      }
      return url;
    });
  }

  function openCrop(sourcePath?: string) {
    setShow(true);
    setErr("");
    setBusy(false);
    if (sourcePath) {
      setSourceUrl(assetUrl(sourcePath));
      setStep("crop");
    } else {
      setSourceUrl(null);
      setStep("source");
    }
  }

  function closeCrop() {
    setShow(false);
    setSourceUrl(null);
    setErr("");
    setBusy(false);
    dragRef.current = null;
  }

  
// ---- 来源选择 ----
  function pickExisting(src: string) {
    setSourceUrl(assetUrl(src));
    setStep("crop");
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setSourceUrl(url);
    setStep("crop");
  }

  // ---- 拖拽 ----
  function onPointerDown(e: React.PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
      baseScale: scale,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const d = dragRef.current;
    const rawX = d.baseX + (e.clientX - d.startX);
    const rawY = d.baseY + (e.clientY - d.startY);
    const s = d.baseScale;
    const { w, h } = imgSizeRef.current;
    const R = CROP_SIZE;
    // 图片必须完全覆盖圆形裁切区：边缘不能拖进圆圈内
    setOffset({
      x: Math.min(0, Math.max(rawX, R - w * s)),
      y: Math.min(0, Math.max(rawY, R - h * s)),
    });
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;  // 光标在 viewport 内的 x
    const cy = e.clientY - rect.top;   // 光标在 viewport 内的 y
    // 光标指向的图片坐标
    const imgX = (cx - offset.x) / scale;
    const imgY = (cy - offset.y) / scale;
    // 缩放步长
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.min(3, Math.max(minScale, scale * factor));
    // 新偏移：保持光标下的图片点不动
    let newX = cx - imgX * newScale;
    let newY = cy - imgY * newScale;
    // 边界约束
    const { w, h } = imgSizeRef.current;
    const R = CROP_SIZE;
    newX = Math.min(0, Math.max(newX, R - w * newScale));
    newY = Math.min(0, Math.max(newY, R - h * newScale));
    setScale(newScale);
    setOffset({ x: newX, y: newY });
  }

  function onReset() {
    const { w, h } = imgSizeRef.current;
    if (!w || !h) return;
    const s = minScale;
    setScale(s);
    setOffset({ x: (CROP_SIZE - w * s) / 2, y: (CROP_SIZE - h * s) / 2 });
  }

  // ---- Canvas 裁切 ----
  async function confirmCrop() {
    if (!sourceUrl) return;
    setBusy(true);
    setErr("");
    try {
      const blob = await cropToBlob(sourceUrl, offset.x, offset.y, scale, CROP_SIZE);
      const file = new File([blob], "avatar_cropped.jpg", { type: "image/jpeg" });
      onUploaded(await uploadAvatar(file));
      closeCrop();
    } catch (e) {
      setErr(errMsg(e, "上传头像失败"));
      setBusy(false);
    }
  }

  // ---- dialog ----
  const dialog = show ? (
    <Modal
      className="modal-narrow"
      title={<span>{step === "source" ? "选择头像来源" : "裁切头像"}</span>}
      onClose={closeCrop}
      footer={
        step === "source" ? (
          <button className="btn-ghost" onClick={closeCrop}>
            取消
          </button>
        ) : (
          <>
            <button
              className="btn-ghost"
              onClick={() => {
                setStep("source");
                setSourceUrl(null);
              }}
              disabled={busy}
            >
              ← 换来源
            </button>
            <button className="btn-ghost" onClick={closeCrop} disabled={busy}>
              取消
            </button>
            <button className="btn-primary" onClick={confirmCrop} disabled={busy}>
              {busy ? "处理中…" : "确认裁切"}
            </button>
          </>
        )
      }
    >
      {step === "source" && (
        <SourcePicker images={photos} onPick={pickExisting} onFile={onFilePicked} />
      )}
      {step === "crop" && sourceUrl && (
        <CropStage
          sourceUrl={sourceUrl}
          offset={offset}
          scale={scale}
          minScale={minScale}
          onScale={setScale}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          onReset={onReset}
        />
      )}
      {err && <div className="form-err">{err}</div>}
    </Modal>
  ) : null;

  return { openCrop, closeCrop, dialog };
}

// ---- 裁切参数 ----
const CROP_SIZE = 300; // viewport / 输出边长（正方形）

function cropToBlob(
  url: string,
  ox: number,
  oy: number,
  scale: number,
  size: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      // viewport (0,0) 对应图片上 (-ox/scale, -oy/scale)
      // viewport 在图片上覆盖宽高 = size/scale
      const sx = -ox / scale;
      const sy = -oy / scale;
      const sw = size / scale;
      const sh = size / scale;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas 导出失败"));
        },
        "image/jpeg",
        0.9,
      );
    };
    img.onerror = () => reject(new Error("图片加载失败"));
  });
}
