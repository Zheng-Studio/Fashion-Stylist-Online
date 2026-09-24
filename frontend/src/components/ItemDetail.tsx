import { useState } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import type { Item } from "../types";
import { useEscape } from "../useEscape";
import Portal from "./Portal";
import Lightbox from "./Lightbox";

// 全屏单品详情页：卡片点开进这里。顶部返回 + 编辑/删除，
// 下方大图 + 名称/品类/颜色/描述/标记。走 Portal 到 body（避开惯性滚动容器裁切 fixed 弹层）。
export default function ItemDetail({
  item,
  imgSrc,
  onEdit,
  onDelete,
  onClose,
}: {
  item: Item;
  imgSrc: string;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  useEscape(onClose);

  return (
    <Portal>
      <div
        className="item-detail-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose(); // PC：点遮罩关闭
        }}
      >
        <div className="item-detail">
          <header className="detail-bar">
          <button className="detail-back" onClick={onClose} aria-label="返回">
            <ArrowLeft size={22} />
          </button>
          <div className="detail-bar-actions">
            <button className="detail-action" onClick={onEdit} aria-label="编辑">
              <Pencil size={18} />
              <span>编辑</span>
            </button>
            <button
              className="detail-action detail-action-danger"
              onClick={onDelete}
              aria-label="删除"
            >
              <Trash2 size={18} />
              <span>删除</span>
            </button>
          </div>
        </header>

        <div className="detail-scroll">
          <div className="detail-img-wrap">
            <img
              className="detail-img zoomable"
              src={imgSrc}
              alt={item.name || item.category}
              onClick={() => setZoomed(true)}
            />
          </div>

          <div className="detail-meta">
            <h2 className="detail-name">{item.name || item.category}</h2>
            <div className="detail-sub">
              {[item.category, item.color.join(" / ")].filter(Boolean).join(" · ")}
            </div>
            {item.description && <p className="detail-desc">{item.description}</p>}
            <div className="detail-tags">
              {item.is_in_wishlist && <span className="wish-tag">心愿</span>}
              {item.season.map((s) => (
                <span key={s} className="tag">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>

          {zoomed && <Lightbox src={imgSrc} onClose={() => setZoomed(false)} />}
        </div>
      </div>
    </Portal>
  );
}
