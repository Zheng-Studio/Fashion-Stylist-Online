import { useEffect, useRef, useState } from "react";
import { autoTagImage, createItem, updateItem } from "../api";
import { CATEGORIES, EDIT_PRESETS, SEASONS } from "../constants";
import type { Item, TagResult } from "../types";
import { errMsg } from "../utils";
import GenderChips from "./GenderChips";
import Modal from "./Modal";
import { useItemGallery } from "./useItemGallery";

interface Props {
  // 传入则为编辑态，预填已有值；不传为新建
  item?: Item;
  defaultWishlist?: boolean; // 从心愿单视图新建时默认进心愿单
  onClose: () => void;
  onSaved: () => void;
}

// 颜色文本 ↔ 数组：输入框里用顿号分隔，保存时拆开（主色在前，≤3）
function parseColors(text: string): string[] {
  return text
    .split(/[、,，/\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export default function ItemForm({ item, defaultWishlist, onClose, onSaved }: Props) {
  const editing = !!item;

  // 图库（上传/生成/旋转/主图/落盘）整体在 useItemGallery 里，表单只管字段与保存
  const g = useItemGallery(
    item?.images ?? [],
    item?.primary_image_id ?? item?.images?.[0]?.id ?? "",
  );

  const [name, setName] = useState(item?.name ?? "");
  const [gender, setGender] = useState(item?.gender ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [colorText, setColorText] = useState((item?.color ?? []).join("、"));
  const [season, setSeason] = useState<string[]>(item?.season ?? []);
  const [description, setDescription] = useState(item?.description ?? "");
  const [isWishlist, setIsWishlist] = useState<boolean>(
    editing ? item!.is_in_wishlist : !!defaultWishlist,
  );

  // AI 编辑指令 + 弹窗开关
  const [editPrompt, setEditPrompt] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  const [tagging, setTagging] = useState(false);
  const [tagHint, setTagHint] = useState("");
  const [tagSecs, setTagSecs] = useState(0);
  const tagSeq = useRef(0);

  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState("");
  const [err, setErr] = useState("");

  // 识别耗时秒表：归零在 runAutoTag 里做（effect 内同步 setState 会引发级联渲染）
  useEffect(() => {
    if (!tagging) return;
    const id = setInterval(() => setTagSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [tagging]);

  const infoDisabled = saving || tagging || !g.hasImage;
  // 生成/编辑：只要有选中图即可（已落库 / 未落库 / 新建态都行），生成中或保存中禁用
  const canGen = !!g.selected && !g.genBusy && !saving;

  function toggle(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function applyTags(t: TagResult) {
    setName(t.name);
    setGender(t.gender);
    setCategory(t.category);
    setColorText(t.color.join("、"));
    setSeason(t.season);
    setDescription(t.description);
  }

  async function runAutoTag(file: File) {
    const seq = ++tagSeq.current;
    setTagSecs(0);
    setTagging(true);
    setTagHint("AI 识别中…");
    try {
      const t = await autoTagImage(file);
      if (seq !== tagSeq.current) return;
      applyTags(t);
      setTagHint("已自动识别，请核对修改");
    } catch (e) {
      if (seq !== tagSeq.current) return;
      setTagHint(`识别失败（${errMsg(e)}），请手动填写`);
    } finally {
      if (seq === tagSeq.current) setTagging(false);
    }
  }

  // 选/拍图 → 加进图库。空库时设为主图；新建态首张自动识别。
  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    setSavedHint("");
    if (g.addFile(file) && !editing) void runAutoTag(file); // 新建态首张自动识别
  }

  async function confirmEdit() {
    const p = editPrompt.trim();
    if (!p) return;
    setEditOpen(false);
    setEditPrompt("");
    await g.generate("edited", p);
  }

  function onRemove(id: string) {
    const e = g.remove(id);
    if (e) setErr(e);
  }

  async function onRotate(id: string) {
    setErr("");
    const e = await g.rotate(id);
    if (e) setErr(e);
  }

  async function onManualTag() {
    if (!g.selected) return setErr("请先选择一张图片");
    try {
      const blob = await g.blobOf(g.selected);
      await runAutoTag(new File([blob], "current.jpg", { type: blob.type || "image/jpeg" }));
    } catch (e) {
      setTagHint(`识别失败（${errMsg(e)}），请手动填写`);
    }
  }

  function resetForNext() {
    tagSeq.current++;
    g.reset();
    setName("");
    setGender("");
    setCategory("");
    setColorText("");
    setSeason([]);
    setDescription("");
    setEditPrompt("");
    setTagging(false);
    setTagHint("");
    setErr("");
  }

  async function doSave(): Promise<boolean> {
    if (!g.hasImage) return setErr("请先添加一张图片"), false;
    if (!category) return setErr("请选择类目"), false;
    if (!gender) return setErr("请选择适用性别"), false;
    setErr("");
    setSaving(true);
    try {
      const { images, primaryImageId } = await g.commit();
      const input = {
        name,
        gender,
        category,
        color: parseColors(colorText),
        season,
        description,
        is_in_wishlist: isWishlist,
        images,
        primary_image_id: primaryImageId,
      };
      if (editing) await updateItem(item!.id, input);
      else await createItem(input);
      return true;
    } catch (e) {
      setErr(errMsg(e, "保存单品失败"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    if (await doSave()) onSaved();
  }

  async function onSaveAndNext() {
    const savedCategory = category;
    if (await doSave()) {
      resetForNext();
      setSavedHint(`已保存「${savedCategory}」，继续添加下一件`);
    }
  }

  return (
    <>
      <Modal
        className="item-form-modal"
        bodyClassName="modal-body modal-grid"
        title={<span>{editing ? "编辑单品" : "添加单品"}</span>}
        onClose={onClose}
        footer={
          <>
            <button className="btn-ghost" onClick={onClose} disabled={saving}>
              取消
            </button>
            {!editing && (
              <button className="btn-ghost" onClick={onSaveAndNext} disabled={saving}>
                {saving ? "保存中…" : "保存并继续"}
              </button>
            )}
            <button className="btn-primary" onClick={onSave} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </button>
          </>
        }
      >
        {/* 左栏：图库 —— 主图大展示 + 缩略图条 + 生成动作 */}
        <div className="form-col-img">
          {g.selected ? (
            <div className="form-img has-img">
              <img src={g.displayUrl} alt="主图预览" />
              {g.showSource && g.sourceItem ? (
                <span className="gmain-badge">对比·原图</span>
              ) : (
                g.primaryId === g.selected.id && <span className="gmain-badge">★ 主图</span>
              )}
              {/* hover 浮现：原图↔生成图对比（生成图才有）/ 生成白底 / AI 编辑 */}
              <div className="form-img-overlay">
                {g.sourceItem && (
                  <button
                    type="button"
                    className="file-btn-overlay"
                    onClick={() => g.setShowSource(!g.showSource)}
                  >
                    {g.showSource ? "看生成图" : "看原图"}
                  </button>
                )}
                <button
                  type="button"
                  className="file-btn-overlay"
                  onClick={() => g.generate("normalized")}
                  disabled={!canGen}
                >
                  {g.genBusy === "normalized" ? "生成中…" : "生成白底"}
                </button>
                <button
                  type="button"
                  className="file-btn-overlay"
                  onClick={() => setEditOpen(true)}
                  disabled={!canGen}
                >
                  AI 编辑
                </button>
              </div>
            </div>
          ) : (
            <label className="form-img form-img-drop">
              <span className="form-img-drop-icon">＋</span>
              <span className="form-img-drop-text">点击上传 / 拍照</span>
              <input type="file" accept="image/*" onChange={onPickFile} hidden disabled={saving} />
            </label>
          )}

          {/* 缩略图条：全部图（含主图本身），大小分级区分。点选预览 / ★设主图 / ×删除 */}
          {g.hasImage && (
            <div className="gstrip">
              {g.gallery.map((im) => (
                <div
                  key={im.id}
                  className={
                    "gthumb" +
                    (im.id === g.selectedId ? " sel" : "") +
                    (im.id === g.primaryId ? " primary" : "")
                  }
                  onClick={() => g.setSelectedId(im.id)}
                  title={im.prompt || ""}
                >
                  <img src={im.url} alt="" />
                  <button
                    type="button"
                    className={"gstar" + (im.id === g.primaryId ? " on" : "")}
                    onClick={(e) => {
                      e.stopPropagation();
                      g.setPrimaryId(im.id);
                    }}
                    title="设为主图"
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    className="gdel"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(im.id);
                    }}
                    title="移除"
                  >
                    ✕
                  </button>
                  {im.path && (
                    <button
                      type="button"
                      className="grot"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRotate(im.id);
                      }}
                      title="旋转 90°"
                    >
                      ↻
                    </button>
                  )}
                </div>
              ))}
              {/* 生成中的展位（同步几秒）：占位 + 进度 */}
              {g.genBusy && (
                <div className="gthumb loading">
                  <span className="gthumb-progress">
                    {g.genBusy === "normalized" ? "白底…" : "编辑…"}
                  </span>
                </div>
              )}
              <label className="gthumb gadd">
                ＋
                <input
                  type="file"
                  accept="image/*"
                  onChange={onPickFile}
                  hidden
                  disabled={saving}
                />
              </label>
            </div>
          )}

          {/* 错误 / 重新识别 */}
          {g.hasImage && (
            <div className="gen-actions">
              {g.genErr && <div className="form-err">{g.genErr}</div>}
              <button
                type="button"
                className="link-btn"
                onClick={onManualTag}
                disabled={infoDisabled}
              >
                AI 重新识别信息
              </button>
            </div>
          )}

          {tagHint && (
            <div className={"tag-hint" + (tagging ? " busy" : "")}>
              {tagging ? `${tagHint} ${tagSecs}s` : tagHint}
            </div>
          )}
          {savedHint && <div className="saved-hint">{savedHint}</div>}
        </div>

        {/* 右栏：其他信息。没图时整体锁住 */}
        <div className={"form-col-info" + (infoDisabled ? " is-locked" : "")}>
          {!g.hasImage && (
            <div className="info-lock-hint">
              先上传图片，AI 会自动识别并填写这里（可再手动调整）
            </div>
          )}

          <label className="field-label">名称</label>
          <input
            type="text"
            value={name}
            placeholder="款式短名，如：阔腿牛仔裤"
            onChange={(e) => setName(e.target.value)}
            disabled={infoDisabled}
          />

          <label className="field-label">类目 *</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={infoDisabled}
          >
            <option value="">— 请选择 —</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <label className="field-label">性别</label>
          <GenderChips value={gender} onChange={setGender} disabled={infoDisabled} />


          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={isWishlist}
              onChange={(e) => setIsWishlist(e.target.checked)}
              disabled={infoDisabled}
            />
            加入心愿单（想买的，不参与选款）
          </label>

          <label className="field-label">颜色</label>
          <input
            type="text"
            value={colorText}
            placeholder="主色在前，如：黑、米白"
            onChange={(e) => setColorText(e.target.value)}
            disabled={infoDisabled}
          />

          <label className="field-label">季节</label>
          <div className="chips">
            {SEASONS.map((s) => (
              <button
                key={s}
                type="button"
                className={season.includes(s) ? "chip on" : "chip"}
                onClick={() => setSeason(toggle(season, s))}
                disabled={infoDisabled}
              >
                {s}
              </button>
            ))}
          </div>

          <label className="field-label">描述</label>
          <textarea
            value={description}
            rows={6}
            placeholder="款式、版型剪裁、材质质感、配色关系（撞色/印花/拼接）、风格气质与适合场合（通勤/约会/运动…）"
            onChange={(e) => setDescription(e.target.value)}
            disabled={infoDisabled}
          />

          {err && <div className="form-err">{err}</div>}
        </div>
      </Modal>

      {/* AI 编辑指令弹窗：写指令（含示例）→ 确认后回到 modal，图库出展位跑进度 */}
      {editOpen && (
        <Modal
          className="modal-narrow"
          title={<span>AI 编辑图片</span>}
          onClose={() => setEditOpen(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setEditOpen(false)}>
                取消
              </button>
              <button className="btn-primary" onClick={confirmEdit} disabled={!editPrompt.trim()}>
                确认
              </button>
            </>
          }
        >
          <label className="field-label">编辑指令</label>
          <textarea
            value={editPrompt}
            rows={3}
            autoFocus
            placeholder="想怎么改这张图，如：把衣服平铺展开、去除文字"
            onChange={(e) => setEditPrompt(e.target.value)}
          />
          <div className="edit-presets">
            {EDIT_PRESETS.map((p) => (
              <button key={p} type="button" className="preset" onClick={() => setEditPrompt(p)}>
                {p}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
