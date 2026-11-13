import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Plus, RotateCcw, RotateCw, Sparkles, X } from "lucide-react";
import {
  addItemImage,
  autoTagImage,
  deleteItem,
  deleteItemImage,
  dismissItemJob,
  fetchItem,
  patchItem,
  rotateItemImage,
  setItemPrimary,
  startItemJob,
} from "../api";
import { CATEGORIES, EDIT_PRESETS, GENDERS, GENDER_LABEL, MAX_EDIT_INSTRUCTION, SEASONS } from "../constants";
import type { Item, ItemImage, ItemJob, ItemPatch } from "../types";
import { useEscape } from "../useEscape";
import { assetUrl, errMsg } from "../utils";
import InlineText from "./InlineText";
import Lightbox from "./Lightbox";
import Modal from "./Modal";
import PhotoMenu from "./PhotoMenu";
import PropRow from "./PropRow";
import Portal from "./Portal";
import { useConfirm } from "./useConfirm";

// 单品页：打开就是详情，所有东西直接在这里改，没有「编辑模式」也没有「保存 / 取消」。
// 每个操作调一个接口、即时生效，返回的整件单品交给 onChange（衣橱列表据此更新）。
// - 字段：乐观更新，失败回滚并提示；名称 / 描述行内编辑，回车或点外面保存。
// - 图：加 / 转 / 设主图 / 删，点了就生效（删除先确认）。
// - 生成标准照 / 自定义编辑：后台任务，关掉这页也照样跑，完成后自动加进图库；大图会自动切到它。
// - AI 重新识别：一次改好几项，给几秒「撤销」。

const POLL_MS = 2500;
const MAX_IMAGES = 5; // 和后端 MAX_IMAGES_PER_ITEM 一致：每件单品最多 5 张（含生成中的）
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1000;
const MAX_COLORS = 3;
const TOAST_MS = 6000;
const SAVED_MS = 2000;

const JOB_LABEL: Record<ItemJob["kind"], string> = { item_normalize: "标准照", item_edit: "自定义编辑" };
const isActive = (j: ItemJob) => j.status === "pending" || j.status === "running";
const FIELDS = ["name", "gender", "category", "color", "season", "description"] as const;

type SaveState = { state: "idle" | "saving" | "saved" | "error"; msg?: string };
type Toast = { text: string; undo?: () => void };

/** 大图显示哪一格：图片 id，或 "job:<任务 id>"（生成中的展位）。任务结束后成功的新图 id 就是任务 id。 */
function resolveSlot(slot: string, item: Item): string {
  const images = item.images;
  const has = (id: string) => images.some((im) => im.id === id);
  if (slot.startsWith("job:")) {
    const id = slot.slice(4);
    if ((item.jobs ?? []).some((j) => j.id === id)) return slot;
    if (has(id)) return id;
  } else if (has(slot)) {
    return slot;
  }
  return item.primary_image_id && has(item.primary_image_id) ? item.primary_image_id : images[0]?.id ?? "";
}

export default function ItemPage({
  item,
  onChange,
  onDeleted,
  onClose,
}: {
  item: Item;
  onChange: (next: Item) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [slot, setSlot] = useState(item.primary_image_id ?? "");
  const [optimistic, setOptimistic] = useState<ItemPatch>({});
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const [toast, setToast] = useState<Toast | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<string | null>(null); // 自定义编辑：对哪张图
  const [editPrompt, setEditPrompt] = useState("");
  const [rotating, setRotating] = useState(false);
  const [tagging, setTagging] = useState(false);
  const inflight = useRef(0);

  const view = { ...item, ...optimistic };
  const jobs = item.jobs ?? [];
  const current = resolveSlot(slot, item);
  const stageJob = current.startsWith("job:") ? jobs.find((j) => j.id === current.slice(4)) : undefined;
  const stageImage: ItemImage | undefined = stageJob ? undefined : item.images.find((im) => im.id === current);
  const isPrimary = (id: string) => id === item.primary_image_id;
  // 每件最多 5 张：生成中的也算一个位置，满了就不能再加 / 再生成（生成完会多出一张）
  const full = item.images.length + jobs.filter(isActive).length >= MAX_IMAGES;
  const fullHint = full ? `每件单品最多 ${MAX_IMAGES} 张图，先删掉一张` : undefined;

  // ---------------------------------------------------------------- 保存状态
  const run = useCallback(
    async (op: () => Promise<Item>, failMsg: string): Promise<Item | null> => {
      inflight.current += 1;
      setSave({ state: "saving" });
      try {
        const next = await op();
        onChange(next);
        inflight.current -= 1;
        if (!inflight.current) setSave({ state: "saved" });
        return next;
      } catch (e) {
        inflight.current -= 1;
        setSave({ state: "error", msg: errMsg(e, failMsg) });
        return null;
      }
    },
    [onChange],
  );
  useEffect(() => {
    if (save.state !== "saved") return;
    const t = window.setTimeout(() => setSave({ state: "idle" }), SAVED_MS);
    return () => window.clearTimeout(t);
  }, [save]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  /** 改字段：先在界面上换好（乐观），失败就回滚到服务器的值。 */
  async function patch(p: ItemPatch, failMsg = "保存失败") {
    setOptimistic((o) => ({ ...o, ...p }));
    const next = await run(() => patchItem(item.id, p), failMsg);
    // 只清掉自己设的那几项：期间又改了同一项（引用不同），留给后一次请求来清
    setOptimistic((o) => {
      const c = { ...o } as Record<string, unknown>;
      for (const k of Object.keys(p)) if (c[k] === (p as Record<string, unknown>)[k]) delete c[k];
      return c as ItemPatch;
    });
    return next;
  }

  // ---------------------------------------------------------------- 后台任务：进行中就轮询
  const hasActive = jobs.some(isActive);
  useEffect(() => {
    if (!hasActive) return;
    let cancelled = false;
    const t = window.setInterval(async () => {
      try {
        const next = await fetchItem(item.id);
        if (!cancelled) onChange(next);
      } catch {
        /* 网络抖一下，下一轮再查 */
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [hasActive, item.id, onChange]);

  // Esc 关页面；灯箱、弹窗、菜单开着时让它们先处理
  useEscape(() => {
    if (zoom || editFor || document.querySelector(".modal-backdrop, .photo-menu")) return;
    onClose();
  });

  // ---------------------------------------------------------------- 图的操作
  async function onRotate(direction: "cw" | "ccw") {
    if (!stageImage || rotating) return;
    setRotating(true);
    await run(() => rotateItemImage(item.id, stageImage.id, direction), "旋转失败");
    setRotating(false);
  }

  async function onDeleteImage(im: ItemImage) {
    const ok = await confirm({
      title: "删除这张图片？",
      message: isPrimary(im.id) ? "这是主图，删除后会换成剩下的一张当主图。删除后无法恢复。" : "删除后无法恢复。",
      confirmText: "删除",
      danger: true,
    });
    if (ok) await run(() => deleteItemImage(item.id, im.id), "删除图片失败");
  }

  async function onAddImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const next = await run(() => addItemImage(item.id, file), "添加图片失败");
    if (next) setSlot(next.images[next.images.length - 1].id);
  }

  async function startJob(kind: ItemJob["kind"], sourceId: string, prompt?: string) {
    setSave({ state: "saving" });
    try {
      const res = await startItemJob(item.id, { kind, source_image_id: sourceId, prompt });
      onChange(res.item);
      setSave({ state: "idle" });
      setSlot(`job:${res.job_id}`); // 大图切到生成中的展位，完成后自动换成新图
      setToast({ text: `已开始生成${JOB_LABEL[kind]}，可以先关掉，完成后会自动加进来` });
    } catch (e) {
      setSave({ state: "error", msg: errMsg(e, "开始生成失败") });
    }
  }

  async function retryJob(job: ItemJob) {
    const source = item.images.some((im) => im.id === job.source_image_id) ? job.source_image_id : current;
    await run(() => dismissItemJob(item.id, job.id), "操作失败");
    await startJob(job.kind, source, job.prompt || undefined);
  }

  function openEdit(imageId: string) {
    setEditPrompt("");
    setEditFor(imageId);
  }

  function submitEdit() {
    const prompt = editPrompt.trim();
    if (!prompt || !editFor) return;
    const source = editFor;
    setEditFor(null);
    void startJob("item_edit", source, prompt);
  }

  // ---------------------------------------------------------------- AI 重新识别（先确认，改完可撤销）
  async function confirmRetag() {
    if (tagging) return;
    const ok = await confirm({
      title: "重新识别这件单品？",
      message: "会用大图这张重新识别名称、品类、颜色、季节和描述，覆盖现在的内容。改完几秒内可以撤销。",
      confirmText: "重新识别",
    });
    if (ok) await onRetag();
  }

  async function onRetag() {
    const src = stageImage ?? item.images.find((im) => isPrimary(im.id)) ?? item.images[0];
    if (!src || tagging) return;
    setTagging(true);
    try {
      const blob = await fetch(assetUrl(src.path)).then((r) => r.blob());
      const tags = await autoTagImage(new File([blob], "current.jpg", { type: blob.type || "image/jpeg" }));
      const before: ItemPatch = {};
      const after: ItemPatch = {};
      for (const k of FIELDS) {
        if (JSON.stringify(tags[k]) !== JSON.stringify(item[k])) {
          (before as Record<string, unknown>)[k] = item[k];
          (after as Record<string, unknown>)[k] = tags[k];
        }
      }
      const changed = Object.keys(after).length;
      if (!changed) {
        setToast({ text: "识别结果和现在一样，没有改动" });
        return;
      }
      if (await patch(after, "识别结果保存失败")) {
        setToast({
          text: `已按这张图更新 ${changed} 项信息`,
          undo: () => {
            setToast(null);
            void patch(before, "撤销失败");
          },
        });
      }
    } catch (e) {
      setSave({ state: "error", msg: errMsg(e, "识别失败") });
    } finally {
      setTagging(false);
    }
  }

  async function onDeleteItem() {
    const ok = await confirm({
      title: "删除单品",
      message: `确定删除「${item.name || item.category}」？图片会一起删除，此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteItem(item.id);
      onDeleted(item.id);
    } catch (e) {
      setSave({ state: "error", msg: errMsg(e, "删除单品失败") });
    }
  }

  // ---------------------------------------------------------------- 渲染
  const imageMenu = (im: ItemImage) => [
    ...(isPrimary(im.id) ? [] : [{ label: "设为主图", onSelect: () => void run(() => setItemPrimary(item.id, im.id), "设置主图失败") }]),
    { label: "生成标准照", disabled: full, hint: fullHint, onSelect: () => void startJob("item_normalize", im.id) },
    { label: "自定义编辑", disabled: full, hint: fullHint, onSelect: () => openEdit(im.id) },
    {
      label: "删除",
      danger: true,
      disabled: item.images.length <= 1,
      hint: item.images.length <= 1 ? "至少保留一张图片" : undefined,
      onSelect: () => void onDeleteImage(im),
    },
  ];

  return (
    <Portal>
      <div
        className="item-detail-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="item-detail item-page" role="dialog" aria-label="单品详情">
          <header className="detail-bar">
            {/* 手机是全屏页：左上角返回；PC 是居中弹窗：右上角 × */}
            <button className="detail-back" onClick={onClose} aria-label="返回">
              <ArrowLeft size={22} />
            </button>
            <SaveStatus save={save} />
            <div className="detail-bar-actions">
              <PhotoMenu
                label="单品的更多操作"
                triggerClassName="plain"
                items={[{ label: "删除单品", danger: true, onSelect: () => void onDeleteItem() }]}
              />
              <button className="detail-close" onClick={onClose} aria-label="关闭">
                <X size={20} />
              </button>
            </div>
          </header>

          <div className="ip-body">
            {/* 左：大图 + 缩略图条 */}
            <div className="form-col-img ip-gallery">
              {stageJob ? (
                <JobStage job={stageJob} onRetry={() => void retryJob(stageJob)} onDismiss={() => void run(() => dismissItemJob(item.id, stageJob.id), "操作失败")} />
              ) : stageImage ? (
                <div className="form-img has-img">
                  <img
                    className="zoomable"
                    src={assetUrl(stageImage.path)}
                    alt="主图预览"
                    onClick={() => setZoom(assetUrl(stageImage.path))}
                  />
                  {isPrimary(stageImage.id) && <span className="gmain-badge">★ 主图</span>}
                  {rotating && (
                    <div className="ip-stage-busy" role="status" aria-label="正在旋转">
                      <span className="gen-spinner" aria-hidden="true" />
                    </div>
                  )}
                  <div className="form-img-rotate" role="group" aria-label="旋转">
                    <button type="button" className="form-img-rotate-btn" aria-label="向左旋转 90°" title="向左旋转 90°" onClick={() => void onRotate("ccw")} disabled={rotating}>
                      <RotateCcw size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="form-img-rotate-btn" aria-label="向右旋转 90°" title="向右旋转 90°" onClick={() => void onRotate("cw")} disabled={rotating}>
                      <RotateCw size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="form-img-overlay">
                    {!isPrimary(stageImage.id) && (
                      <button type="button" className="file-btn-overlay" onClick={() => void run(() => setItemPrimary(item.id, stageImage.id), "设置主图失败")}>
                        设为主图
                      </button>
                    )}
                    <button type="button" className="file-btn-overlay" onClick={() => void startJob("item_normalize", stageImage.id)} disabled={full} title={fullHint}>
                      生成标准照
                    </button>
                    <button type="button" className="file-btn-overlay" onClick={() => openEdit(stageImage.id)} disabled={full} title={fullHint}>
                      自定义编辑
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="gstrip">
                {item.images.map((im, index) => (
                  <div
                    key={im.id}
                    className={"gthumb" + (im.id === current ? " sel" : "")}
                    aria-current={im.id === current ? "true" : undefined}
                    onClick={() => setSlot(im.id)}
                    title={im.prompt || ""}
                  >
                    <img src={assetUrl(im.path)} alt={`图片 ${index + 1}`} />
                    {isPrimary(im.id) && (
                      <span className="gthumb-badge" role="img" aria-label="主图" title="主图">
                        主图
                      </span>
                    )}
                    <PhotoMenu label={`图片 ${index + 1} 的更多操作`} items={imageMenu(im)} />
                  </div>
                ))}
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    className={`gthumb ip-job-thumb is-${job.status}` + (current === `job:${job.id}` ? " sel" : "")}
                    onClick={() => setSlot(`job:${job.id}`)}
                    aria-label={isActive(job) ? `正在生成${JOB_LABEL[job.kind]}` : `${JOB_LABEL[job.kind]}生成失败`}
                  >
                    {isActive(job) ? <span className="gen-spinner" aria-hidden="true" /> : <span className="ip-job-x">!</span>}
                    <span className="gthumb-progress">{isActive(job) ? JOB_LABEL[job.kind] : "失败"}</span>
                  </button>
                ))}
                {!full && (
                  <label className="gthumb gadd" title="添加图片">
                    <Plus size={20} strokeWidth={1.6} aria-hidden="true" />
                    <input type="file" accept="image/*" hidden aria-label="添加图片" onChange={(e) => void onAddImage(e)} />
                  </label>
                )}
              </div>
            </div>

            {/* 右：信息。每一行平时只显示值，悬停出现「更改」，点开原地改 */}
            <div className="ip-info">
              <div className="ip-title">
                <InlineText
                  className="ip-name"
                  value={view.name}
                  label="名称"
                  placeholder={`给这件${view.category}起个名字`}
                  maxLength={MAX_NAME}
                  onCommit={(name) => void patch({ name })}
                />
                <button
                  type="button"
                  className="ip-retag-btn"
                  onClick={() => void confirmRetag()}
                  disabled={tagging}
                  title="用大图这张重新识别名称、品类、颜色、季节和描述"
                >
                  <Sparkles size={15} aria-hidden="true" />
                  {tagging ? "识别中…" : "重新识别"}
                </button>
              </div>

              <div className="ip-props">
                <PropRow
                  label="品类"
                  value={[view.category]}
                  options={CATEGORIES}
                  onChange={([category]) => void patch({ category })}
                />
                <PropRow
                  label="性别"
                  value={view.gender ? [view.gender as (typeof GENDERS)[number]] : []}
                  options={GENDERS}
                  optionLabel={(g) => GENDER_LABEL[g]}
                  onChange={([gender]) => void patch({ gender })}
                />
                <div className="prop-row">
                  <div className="prop-label">颜色</div>
                  <ColorTags value={view.color} onChange={(color) => void patch({ color })} />
                </div>
                <PropRow
                  label="季节"
                  multiple
                  value={view.season as (typeof SEASONS)[number][]}
                  options={SEASONS}
                  emptyText="四季通用"
                  onChange={(season) => void patch({ season })}
                />
                <div className="prop-row is-block">
                  <div className="prop-label">描述</div>
                  <InlineText
                    className="ip-desc"
                    multiline
                    trigger="hover-button"
                    value={view.description}
                    label="描述"
                    placeholder="还没有描述"
                    maxLength={MAX_DESCRIPTION}
                    onCommit={(description) => void patch({ description })}
                  />
                </div>
              </div>
            </div>
          </div>

          {toast && (
            <div className="ip-toast" role="status">
              <span>{toast.text}</span>
              {toast.undo && (
                <button type="button" onClick={toast.undo}>
                  撤销
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {editFor && (
        <Modal
          className="modal-narrow ip-edit-modal"
          title={<span>自定义编辑</span>}
          onClose={() => setEditFor(null)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setEditFor(null)}>
                取消
              </button>
              <button className="btn-primary" onClick={submitEdit} disabled={!editPrompt.trim()}>
                开始生成
              </button>
            </>
          }
        >
          <label className="field-label" htmlFor="ip-edit-prompt">
            想怎么改这张图
          </label>
          <textarea
            id="ip-edit-prompt"
            value={editPrompt}
            rows={3}
            autoFocus
            maxLength={MAX_EDIT_INSTRUCTION}
            placeholder="如：把衣服平铺展开、去除文字"
            onChange={(e) => setEditPrompt(e.target.value)}
          />
          <div className="edit-presets">
            {EDIT_PRESETS.item_edit.map((p) => (
              <button key={p} type="button" className="preset" onClick={() => setEditPrompt(p)}>
                {p}
              </button>
            ))}
          </div>
          <p className="ip-edit-note">在后台生成，完成后作为新图加进这件单品，不会替换原图。</p>
        </Modal>
      )}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
      {confirmDialog}
    </Portal>
  );
}

function SaveStatus({ save }: { save: SaveState }) {
  if (save.state === "saving")
    return (
      <span className="ip-save is-saving" role="status">
        <span className="gen-spinner" aria-hidden="true" />
        保存中…
      </span>
    );
  if (save.state === "saved")
    return (
      <span className="ip-save is-saved" role="status">
        <Check size={14} aria-hidden="true" />
        已保存
      </span>
    );
  if (save.state === "error")
    return (
      <span className="ip-save is-error" role="alert">
        {save.msg}
      </span>
    );
  return <span className="ip-save" />; // 平时不显示任何字，只有保存中 / 已保存 / 出错时才出现
}

function JobStage({ job, onRetry, onDismiss }: { job: ItemJob; onRetry: () => void; onDismiss: () => void }) {
  if (isActive(job))
    return (
      <div className="form-img form-img-generating" role="status">
        <span className="gen-spinner" aria-hidden="true" />
        <span>正在生成{JOB_LABEL[job.kind]}…</span>
        <small>在后台生成，可以先关掉这页，完成后会自动加进图库</small>
      </div>
    );
  return (
    <div className="form-img ip-job-failed" role="alert">
      <strong>{JOB_LABEL[job.kind]}生成失败</strong>
      <small>{job.error || "生成失败，请重试"}</small>
      <div className="ip-job-actions">
        <button type="button" className="btn-ghost" onClick={onDismiss}>
          关闭提示
        </button>
        <button type="button" className="btn-primary" onClick={onRetry}>
          重试
        </button>
      </div>
    </div>
  );
}

/** 颜色：标签，× 去掉，「添加」原地变成小输入框。最多 3 个，主色在前。 */
function ColorTags({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const cancelled = useRef(false); // Esc 之后输入框卸载还会触发 blur：别把没确认的颜色加进去

  function add() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const c = text.trim();
    setAdding(false);
    setText("");
    if (c && !value.includes(c)) onChange([...value, c].slice(0, MAX_COLORS));
  }

  return (
    <div className="ip-tags">
      {value.map((c) => (
        <span key={c} className="ip-tag">
          {c}
          <button type="button" aria-label={`去掉颜色 ${c}`} onClick={() => onChange(value.filter((x) => x !== c))}>
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      {value.length < MAX_COLORS &&
        (adding ? (
          <input
            className="ip-tag-input"
            aria-label="添加颜色"
            autoFocus
            value={text}
            maxLength={16}
            placeholder="颜色"
            onChange={(e) => setText(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                add();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelled.current = true;
                setText("");
                setAdding(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="ip-tag-add"
            onClick={() => {
              cancelled.current = false; // 浏览器卸载时没发 blur 的话，上次 Esc 的标记还在
              setAdding(true);
            }}
          >
            <Plus size={12} aria-hidden="true" />
            添加
          </button>
        ))}
    </div>
  );
}
