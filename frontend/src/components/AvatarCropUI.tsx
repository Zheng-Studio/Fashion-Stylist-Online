import { assetUrl } from "../utils";

// 头像裁切弹窗的两块纯展示 UI（从 useAvatarCropper 拆出：
// 组件与 hook 混在一个文件里会破坏 Fast Refresh，且那个文件已近 400 行）。
// 无自有状态，全部靠 props —— 交互逻辑仍在 useAvatarCropper。

// ---- 来源选择 ----
export function SourcePicker({
  images,
  onPick,
  onFile,
}: {
  images: string[];
  onPick: (src: string) => void;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <label className="avatar-crop-upload-btn">
        上传新照片
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={onFile}
        />
      </label>

      <div className="field-label" style={{ marginTop: 18 }}>
        或从现有照片选择
      </div>
      <div className="avatar-crop-source-grid">
        {images.length === 0 ? (
          <div className="avatar-crop-empty">暂无照片，请先上传</div>
        ) : (
          images.map((src) => (
            <img
              key={src}
              src={assetUrl(src)}
              alt=""
              loading="lazy"
              onClick={() => onPick(src)}
            />
          ))
        )}
      </div>
    </>
  );
}

// ---- 裁切交互区 ----
export function CropStage({
  sourceUrl,
  offset,
  scale,
  minScale,
  onScale,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onReset,
}: {
  sourceUrl: string;
  offset: { x: number; y: number };
  scale: number;
  minScale: number;
  onScale: (s: number) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onWheel: (e: React.WheelEvent) => void;
  onReset: () => void;
}) {
  return (
    <>
      <div
        className="avatar-crop-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <img
          className="avatar-crop-image"
          src={sourceUrl}
          alt=""
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "0 0",
          }}
        />
        <div className="avatar-crop-ring" />
      </div>

      <div className="avatar-crop-zoom">
        <span className="avatar-crop-zoom-label">−</span>
        <input
          type="range"
          min={minScale}
          max={3}
          step={0.05}
          value={scale}
          onChange={(e) => onScale(Math.max(parseFloat(e.target.value), minScale))}
        />
        <span className="avatar-crop-zoom-label">+</span>
        <button
          type="button"
          className="avatar-crop-reset"
          onClick={onReset}
        >
          重置
        </button>
      </div>
    </>
  );
}
