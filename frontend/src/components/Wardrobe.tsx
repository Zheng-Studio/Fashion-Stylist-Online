import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { batchDeleteItems, deleteItem, fetchItems, reorderItems } from "../api";
import { CATEGORIES } from "../constants";
import { reorderWithin } from "../reorder";
import { assetUrl, errMsg } from "../utils";
import type { Item } from "../types";
import ItemPage from "./ItemPage";
import CompleteItemSheet from "./CompleteItemSheet";
import PhotoMenu from "./PhotoMenu";
import { usePendingUploads, type PendingStatus, type PendingUpload } from "./usePendingUploads";
import { useConfirm } from "./useConfirm";

type ViewMode = "card" | "list";

const VIEW_KEY = "fs.wardrobeView";

// 按住多久才开始拖：短按仍是「打开详情」，手机上滑动仍是滚动
const DRAG_HOLD_MS = 250;

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 存不了就算了 */
  }
}

// 衣橱：只有当前用户自己的单品
export default function Wardrobe() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [items, setItems] = useState<Item[]>([]);
  // 两种错误分开：loadErr = 列表拉不到（整页兜底）；opErr = 单次操作失败（只在工具条下提示）
  const [loadErr, setLoadErr] = useState("");
  const [opErr, setOpErr] = useState("");
  const imgSrc = (it: Item) => assetUrl(it.primary_path);
  // 打开的单品页（存 id，内容永远取 items 里最新的那件）
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = openId ? items.find((it) => it.id === openId) : undefined;
  // 单品页里每次操作返回的整件单品：直接替换进列表
  const updateItem = useCallback((next: Item) => {
    setItems((list) => list.map((it) => (it.id === next.id ? next : it)));
  }, []);
  const [catSel, setCatSel] = useState<string[]>([]); // 空 = 全部
  const [view, setView] = useState<ViewMode>(() => readPref(VIEW_KEY, "card"));
  // 多选模式：点卡片 = 勾选，不开详情、不能拖、不显示 ⋯ 菜单
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  useEffect(() => writePref(VIEW_KEY, view), [view]);

  function exitSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }
  // Esc 退出多选（弹窗开着时不抢）
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop")) exitSelecting();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting]);

  const load = useCallback(() => {
    fetchItems()
      .then((list) => {
        setItems(list);
        setLoadErr("");
      })
      .catch((e) => setLoadErr(errMsg(e, "加载单品失败")));
  }, []);
  useEffect(() => load(), [load]);

  // 「添加单品」：直接弹系统选图（可多选），选完每张在列表里出一张占位卡，后台自己跑完。
  const uploads = usePendingUploads(load);
  const newItemInput = useRef<HTMLInputElement>(null);
  const pickNewItemImage = () => newItemInput.current?.click();
  function onNewItemImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) uploads.add(files);
  }
  // 「待补充」的占位卡：点开选品类 / 性别就加入衣橱
  const [completingId, setCompletingId] = useState<string | null>(null);
  const completing = uploads.pending.find((p) => p.id === completingId && p.status === "needs_info");
  function openPending(p: PendingUpload) {
    if (p.status === "done" && p.item) return setOpenId(p.item.id);
    if (p.status === "failed") return uploads.retry(p.id);
    if (p.status === "needs_info") return setCompletingId(p.id);
    // 上传中 / 识别中 / 保存中：马上就好，点了不做事
  }

  async function onDelete(it: Item) {
    const ok = await confirm({
      title: "删除单品",
      message: `确定删除「${it.name || it.category}」？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    setOpErr("");
    try {
      await deleteItem(it.id);
      load();
    } catch (e) {
      setOpErr(errMsg(e, "删除单品失败")); // 只提示，不拆页面
    }
  }

  // 衣橱里有单品在后台生成时，隔一会儿刷新一次列表（卡片角标跟着变；单品页开着时由它自己轮询）
  const anyActive = items.some((it) => (it.jobs ?? []).some((j) => j.status === "pending" || j.status === "running"));
  useEffect(() => {
    if (!anyActive || openId) return;
    const t = window.setInterval(load, 4000);
    return () => window.clearInterval(t);
  }, [anyActive, openId, load]);

  // 拖拽排序：按住 DRAG_HOLD_MS 才开始（鼠标、触屏一样），键盘用空格拿起 / 方向键移动 / 空格放下
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: DRAG_HOLD_MS, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );
  async function onDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const allIds = items.map((it) => it.id);
    const next = reorderWithin(allIds, shown.map((it) => it.id), String(e.active.id), String(e.over.id));
    if (!next) return;
    const byId = new Map(items.map((it) => [it.id, it]));
    const before = items;
    setItems(next.map((id) => byId.get(id)!)); // 先在界面上换好，再存
    setOpErr("");
    try {
      await reorderItems(next);
    } catch (err) {
      setItems(before);
      setOpErr(errMsg(err, "保存排序失败"));
    }
  }

  // 整页兜底只在「一件都没有」时给：已经拉到过列表就别把它换掉
  if (loadErr && items.length === 0) return <div className="error">{loadErr}</div>;

  // 顺序就是后端给的（用户手动排的），这里只做筛选
  const shown = (catSel.length > 0 ? items.filter((it) => catSel.includes(it.category)) : items)
    // 刚建好、还在显示「完成」的占位卡，先不重复出正式卡片
    .filter((it) => !uploads.pending.some((p) => p.item?.id === it.id));
  const menuItems = (it: Item) => [
    { label: "打开", onSelect: () => setOpenId(it.id) },
    { label: "删除", danger: true, onSelect: () => void onDelete(it) },
  ];

  // 选择只对「当前看得见的」单品生效：切了筛选，被藏起来的不会被批量删掉
  const shownIds = shown.map((it) => it.id);
  const picked = shownIds.filter((id) => selected.has(id));
  const allPicked = shownIds.length > 0 && picked.length === shownIds.length;
  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const selectAll = () => setSelected(new Set(shownIds));
  const invert = () => setSelected(new Set(shownIds.filter((id) => !selected.has(id))));
  const clearPicked = () => setSelected(new Set());

  async function onBatchDelete() {
    if (!picked.length) return;
    const ok = await confirm({
      title: `删除 ${picked.length} 件单品？`,
      message: "选中的单品和它们的图片都会被删除，此操作不可撤销。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    setBatchBusy(true);
    setOpErr("");
    try {
      await batchDeleteItems(picked);
      exitSelecting();
      load();
    } catch (e) {
      setOpErr(errMsg(e, "批量删除失败"));
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <div>
      {selecting ? (
        // 多选工具条：替换掉平时的头部，退出多选后恢复
        <div className="wardrobe-head select-head" role="toolbar" aria-label="多选操作">
          <div className="filters">
            <button type="button" className="icon-btn select-exit" aria-label="退出多选" onClick={exitSelecting}>
              <X size={18} aria-hidden="true" />
            </button>
            <span className="select-count" aria-live="polite">
              已选 <strong>{picked.length}</strong> 件
            </span>
          </div>
          <div className="view-tools">
            <div className="select-actions">
              <button type="button" className="filter-btn" onClick={selectAll} disabled={allPicked}>
                全选
              </button>
              <button type="button" className="filter-btn" onClick={invert} disabled={!shownIds.length}>
                反选
              </button>
              <button type="button" className="filter-btn" onClick={clearPicked} disabled={!picked.length}>
                取消选择
              </button>
            </div>
            <button
              type="button"
              className="btn-primary danger select-delete"
              onClick={() => void onBatchDelete()}
              disabled={!picked.length || batchBusy}
            >
              <Trash2 size={16} aria-hidden="true" />
              {batchBusy ? "删除中…" : picked.length ? `删除 ${picked.length} 件` : "删除"}
            </button>
          </div>
        </div>
      ) : (
      <div className="wardrobe-head">
        <div className="filters">
          <span className="count">共 {shown.length} 件</span>
        </div>

        <div className="view-tools">
          <button
            type="button"
            className="btn-ghost select-enter"
            onClick={() => setSelecting(true)}
            disabled={!shown.length}
          >
            选择
          </button>
          <div className="view-toggle">
            {(
              [
                ["card", "卡片"],
                ["list", "列表"],
              ] as [ViewMode, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={"filter-btn" + (view === key ? " active" : "")}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={pickNewItemImage}>
            + 添加单品
          </button>
        </div>
      </div>
      )}

      {/* 类目筛选：多选胶囊，「全部」= 清空选择；手机放不下时本行横向滚动 */}
      <div className="cat-filter" role="group" aria-label="按类目筛选">
        <button
          type="button"
          className={"chip" + (catSel.length === 0 ? " on" : "")}
          aria-pressed={catSel.length === 0}
          onClick={() => setCatSel([])}
        >
          全部
        </button>
        {CATEGORIES.map((c) => {
          const on = catSel.includes(c);
          return (
            <button
              key={c}
              type="button"
              className={"chip" + (on ? " on" : "")}
              aria-pressed={on}
              onClick={() => setCatSel(on ? catSel.filter((x) => x !== c) : [...catSel, c])}
            >
              {c}
            </button>
          );
        })}
      </div>

      <input
        ref={newItemInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="选择单品图片"
        onChange={onNewItemImages}
      />

      {(opErr || loadErr) && <div className="form-err">{opErr || loadErr}</div>}

      <DndContext sensors={selecting ? noSensors : sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
        <SortableContext items={shown.map((it) => it.id)} strategy={rectSortingStrategy}>
          {view === "card" ? (
            <div className="grid wardrobe-grid">
              {/* 添加格：始终是网格第一格，和单品卡一样大；不参与拖拽。多选时隐藏 */}
              {!selecting && (
                <button type="button" className="card wardrobe-add-cell" onClick={pickNewItemImage}>
                  <Plus size={32} strokeWidth={1.4} aria-hidden="true" />
                  <span>添加单品</span>
                </button>
              )}
              {uploads.pending.map((p) => (
                <PendingCard key={p.id} p={p} onOpen={() => openPending(p)} />
              ))}
              {shown.map((it) =>
                selecting ? (
                  <SelectableItem
                    key={it.id}
                    className="card"
                    label={it.name || it.category}
                    checked={selected.has(it.id)}
                    onToggle={() => toggle(it.id)}
                  >
                    <div className="card-img">
                      <img src={imgSrc(it)} alt={it.name || it.category} loading="lazy" draggable={false} />
                    </div>
                  </SelectableItem>
                ) : (
                  <SortableItem key={it.id} id={it.id} className="card" onOpen={() => setOpenId(it.id)}>
                    <div className="card-img">
                      <img src={imgSrc(it)} alt={it.name || it.category} loading="lazy" draggable={false} />
                    </div>
                    <JobBadge item={it} />
                    <PhotoMenu label={`${it.name || it.category} 的更多操作`} items={menuItems(it)} />
                  </SortableItem>
                ),
              )}
            </div>
          ) : (
            <div className="item-rows">
              {uploads.pending.map((p) => (
                <div key={p.id} className={`item-row pending-row is-${p.status}`} onClick={() => openPending(p)} role="button" tabIndex={0}>
                  <div className="row-img">
                    <img src={p.url} alt="新添加的单品" />
                  </div>
                  <div className="row-main">
                    <div className="row-title">{p.item ? p.item.name || p.item.category : "新单品"}</div>
                    <div className="row-desc" role="status">
                      {PENDING_LABEL[p.status]}
                    </div>
                  </div>
                </div>
              ))}
              {shown.map((it) =>
                selecting ? (
                  <SelectableItem
                    key={it.id}
                    className="item-row"
                    label={it.name || it.category}
                    checked={selected.has(it.id)}
                    onToggle={() => toggle(it.id)}
                  >
                    <RowContent it={it} src={imgSrc(it)} />
                  </SelectableItem>
                ) : (
                  <SortableItem key={it.id} id={it.id} className="item-row" onOpen={() => setOpenId(it.id)}>
                    <RowContent it={it} src={imgSrc(it)} />
                  </SortableItem>
                ),
              )}
            </div>
          )}
        </SortableContext>
      </DndContext>

      {completing && (
        <CompleteItemSheet
          key={completing.id}
          imageUrl={completing.url}
          tags={completing.tags}
          onSubmit={async (fields) => {
            const err = await uploads.complete(completing.id, fields);
            if (!err) setCompletingId(null);
            return err;
          }}
          onClose={() => setCompletingId(null)}
        />
      )}

      {confirmDialog}

      {/* 单品页：打开就是详情，所有东西直接在这里改、即时生效 */}
      {openItem && (
        <ItemPage
          key={openItem.id}
          item={openItem}
          onChange={updateItem}
          onDeleted={(id) => {
            setOpenId(null);
            setItems((list) => list.filter((it) => it.id !== id));
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

// 占位卡上依次出现的状态
const PENDING_LABEL: Record<PendingStatus, string> = {
  uploading: "上传中…",
  tagging: "智能识别中…",
  saving: "保存中…",
  done: "已添加",
  needs_info: "待补充，点击完善",
  failed: "上传失败，点击重试",
};

// 多选模式下不挂任何传感器：不能拖，点击只负责勾选
const noSensors: ReturnType<typeof useSensors> = [];

function RowContent({ it, src }: { it: Item; src: string }) {
  return (
    <>
      <div className="row-img">
        <img src={src} alt={it.name || it.category} loading="lazy" draggable={false} />
      </div>
      <div className="row-main">
        <div className="row-title">{it.name || it.category}</div>
        <div className="row-desc">{it.description}</div>
        {/* 品类、颜色、季节统一放在一行标签里 */}
        <div className="tags row-tags">
          <span className="tag tag-cat">{it.category}</span>
          {it.color.map((c) => (
            <span key={`c-${c}`} className="tag tag-color">
              {c}
            </span>
          ))}
          {it.season.map((s) => (
            <span key={`s-${s}`} className="tag tag-season">
              {s}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

// 多选模式下的单品（卡片 / 列表行通用）：整张可点，左上角圆形勾选框。
function SelectableItem({
  className,
  label,
  checked,
  onToggle,
  children,
}: {
  className: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${className} selectable${checked ? " is-checked" : ""}`}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {children}
      <span className="select-check" aria-hidden="true">
        {checked && <Check size={14} strokeWidth={3} />}
      </span>
    </div>
  );
}

// 可拖拽的单品（卡片 / 列表行通用）。短按 = 打开详情；按住 DRAG_HOLD_MS 后拖动 = 排序。
// Enter 打开详情，空格拿起拖动（键盘排序）。
function SortableItem({
  id,
  className,
  onOpen,
  children,
}: {
  id: string;
  className: string;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={className + " sortable-item" + (isDragging ? " is-dragging" : "")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription="可拖动排序的单品"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isDragging) {
          e.preventDefault();
          onOpen();
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
    >
      {children}
    </div>
  );
}

// 卡片左下角：这件单品在后台生成图时转圈，失败了显示一个提示点（点开单品页能看到原因）
function JobBadge({ item }: { item: Item }) {
  const jobs = item.jobs ?? [];
  if (jobs.some((j) => j.status === "pending" || j.status === "running"))
    return (
      <span className="card-job-badge" role="img" aria-label="正在生成" title="正在后台生成图片">
        <span className="gen-spinner" aria-hidden="true" />
      </span>
    );
  if (jobs.some((j) => j.status === "failed"))
    return (
      <span className="card-job-badge is-failed" role="img" aria-label="生成失败" title="有图片生成失败，点开查看">
        !
      </span>
    );
  return null;
}

function PendingCard({ p, onOpen }: { p: PendingUpload; onOpen: () => void }) {
  const busy = p.status === "uploading" || p.status === "tagging" || p.status === "saving";
  return (
    <div
      className={`card pending-card is-${p.status}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`新单品：${PENDING_LABEL[p.status]}`}
      title={p.error}
    >
      <div className="card-img">
        <img src={p.url} alt="" />
      </div>
      <div className="pending-badge" role="status">
        {busy && <span className="pending-spinner" aria-hidden="true" />}
        {p.status === "done" && <Check size={14} aria-hidden="true" />}
        <span>{PENDING_LABEL[p.status]}</span>
      </div>
    </div>
  );
}
