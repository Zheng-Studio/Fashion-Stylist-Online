import { useEffect, useRef, useState } from "react";
import { generateImage, rotateImage, uploadImage } from "../api";
import type { ImageKind, ItemImage } from "../types";
import { assetUrl, errMsg } from "../utils";

// 单品图库子系统（从 ItemForm 抽出，表单只管字段与保存）。
//
// 核心约定：图先在本地攒着，**只有 Save 时才逐张上传落盘**。
// 所以图库项有两种形态：已落库的有 path，新加/新生成的有 file，url 统一给预览用
// （已落库是 /path，未落库是 objectURL）。
export interface GItem {
  id: string;
  kind: ImageKind;
  prompt?: string;
  source_id?: string;
  path?: string; // 已落库
  file?: File; // 待上传
  url: string; // 预览（/path 或 objectURL）
}

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, "");

export function useItemGallery(initialImages: ItemImage[], initialPrimaryId: string) {
  const [gallery, setGallery] = useState<GItem[]>(() =>
    initialImages.map((im) => ({ ...im, url: assetUrl(im.path) })),
  );
  const [primaryId, setPrimaryId] = useState(initialPrimaryId);
  const [selectedId, setSelectedIdState] = useState(initialPrimaryId);
  // 主图大展示里临时切看源图（生成图 ↔ 原图 对比）。切换缩略图时复位。
  const [showSource, setShowSource] = useState(false);
  const [genBusy, setGenBusy] = useState<"" | ImageKind>("");
  const [genErr, setGenErr] = useState("");

  // 切换选中图 = 顺手复位「看原图」对比态。收成一个动作，
  // 免得再靠 useEffect 追 selectedId 变化（那会多一次级联渲染）。
  function setSelectedId(id: string) {
    setSelectedIdState(id);
    setShowSource(false);
  }

  // 所有创建的 objectURL，卸载时统一回收
  const objUrls = useRef<string[]>([]);
  const mkUrl = (blob: Blob) => {
    const u = URL.createObjectURL(blob);
    objUrls.current.push(u);
    return u;
  };
  useEffect(() => () => objUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const selected = gallery.find((g) => g.id === selectedId) ?? gallery[0];
  // 选中图的源图（若是生成图）：用于主图区「生成图 ↔ 原图」对比
  const sourceItem = selected?.source_id
    ? gallery.find((g) => g.id === selected.source_id)
    : undefined;
  const displayUrl = showSource && sourceItem ? sourceItem.url : selected?.url;
  const hasImage = gallery.length > 0;

  // 取某张图的字节：未落库直接有 file，已落库拉一下
  const blobOf = async (g: GItem): Promise<Blob> =>
    g.file ? g.file : await fetch(g.url).then((r) => r.blob());

  /** 选/拍图 → 加进图库（upload）。返回加入前图库是否为空（调用方据此决定要不要自动打标）。 */
  function addFile(file: File): boolean {
    const g: GItem = { id: newId(), kind: "upload", file, url: mkUrl(file) };
    const wasEmpty = gallery.length === 0;
    setGallery((prev) => [...prev, g]);
    setSelectedId(g.id);
    if (wasEmpty) setPrimaryId(g.id);
    return wasEmpty;
  }

  /** 同步生成（白底/AI 编辑）：拿选中图字节送后端，结果当待提交项加进图库。源图不必落库。 */
  async function generate(kind: "normalized" | "edited", prompt?: string) {
    const src = selected;
    if (!src) return;
    if (kind === "edited" && !prompt?.trim()) {
      setGenErr("请输入编辑指令");
      return;
    }
    setGenErr("");
    setGenBusy(kind);
    try {
      const blob = await generateImage(kind, await blobOf(src), prompt);
      const file = new File([blob], `${kind}.jpg`, { type: "image/jpeg" });
      const g: GItem = {
        id: newId(),
        kind,
        file,
        url: mkUrl(file),
        source_id: src.id,
        prompt: kind === "edited" ? prompt : undefined,
      };
      setGallery((prev) => [...prev, g]);
      setSelectedId(g.id); // 预览新图，但不自动设主图
    } catch (e) {
      setGenErr(errMsg(e, "生成失败"));
    } finally {
      setGenBusy("");
    }
  }

  /** 移除一张图；返回错误文案（null = 成功）。至少保留一张。 */
  function remove(id: string): string | null {
    if (gallery.length <= 1) return "至少保留一张图片";
    const rest = gallery.filter((g) => g.id !== id);
    setGallery(rest);
    // 删掉主图/选中图时回落最近一张
    if (primaryId === id) setPrimaryId(rest[rest.length - 1].id);
    if (selectedId === id) setSelectedId(rest[rest.length - 1].id);
    return null;
  }

  /** 旋转 90°（仅已落库的图）；返回错误文案（null = 成功）。 */
  async function rotate(id: string): Promise<string | null> {
    const g = gallery.find((x) => x.id === id);
    if (!g?.path) return null;
    try {
      // 后端写成新 key 返回（不原地覆盖，URL 保持不可变）。图库项 id 不变、只换 path，
      // 保存时旧 key 不在新图库里，后端会顺手删掉旧文件；取消则旧图原样保留。
      const path = await rotateImage(g.path);
      setGallery((prev) =>
        prev.map((x) => (x.id === id ? { ...x, path, url: assetUrl(path) } : x)),
      );
      return null;
    } catch (e) {
      return errMsg(e, "旋转失败");
    }
  }

  /** 保存并继续：清空图库、回收 objectURL。 */
  function reset() {
    objUrls.current.forEach((u) => URL.revokeObjectURL(u));
    objUrls.current = [];
    setGallery([]);
    setPrimaryId("");
    setSelectedIdState("");
    setGenErr("");
  }

  /** 落盘：待提交项（有 file 无 path）逐张上传，返回可直接进 ItemInput 的 images + 主图 id。 */
  async function commit(): Promise<{ images: ItemImage[]; primaryImageId: string }> {
    const images: ItemImage[] = [];
    for (const g of gallery) {
      const path = g.path ?? (await uploadImage(g.file!));
      images.push({
        id: g.id,
        kind: g.kind,
        path,
        ...(g.prompt ? { prompt: g.prompt } : {}),
        ...(g.source_id ? { source_id: g.source_id } : {}),
      });
    }
    const primaryImageId = images.some((im) => im.id === primaryId)
      ? primaryId
      : images[images.length - 1].id;
    return { images, primaryImageId };
  }

  return {
    gallery,
    primaryId,
    selectedId,
    showSource,
    genBusy,
    genErr,
    selected,
    sourceItem,
    displayUrl,
    hasImage,
    setPrimaryId,
    setSelectedId,
    setShowSource,
    setGenErr,
    addFile,
    generate,
    remove,
    rotate,
    reset,
    blobOf,
    commit,
  };
}
