import { authHeaders } from "./auth";
import type {
  Generation,
  Item,
  ItemInput,
  ItemJob,
  ItemPatch,
  Me,
  Outfit,
  RecommendReadiness,
  RecommendResponse,
  TagResult,
  OnboardingScene,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// 所有请求都走这里：统一带登录 token、统一把后端 detail 变成可读错误
async function request(path: string, init: RequestInit = {}, fallback = "请求失败"): Promise<Response> {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await errorDetail(res, fallback));
  return res;
}

async function errorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data?.detail) return typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
  } catch {
    /* 非 JSON 响应，用兜底文案 */
  }
  return fallback;
}

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function fileForm(field: string, file: Blob, filename = "image.jpg"): FormData {
  const form = new FormData();
  form.append(field, file, filename);
  return form;
}

// ---------------------------------------------------------------------------
// 当前用户
// ---------------------------------------------------------------------------
export async function fetchMe(): Promise<Me> {
  return (await request("/api/me", {}, "加载用户信息失败")).json();
}

export async function updateMe(
  patch: {
    name?: string;
    gender?: "female" | "male" | "";
    age?: number | null;
    height_cm?: number | null;
    gen_base?: string;
    photos?: string[];
  },
): Promise<Me> {
  return (await request("/api/me", { method: "PUT", ...json(patch) }, "保存失败")).json();
}

export async function uploadMyPhoto(file: Blob): Promise<Me> {
  return (await request("/api/me/photos", { method: "POST", body: fileForm("file", file) }, "上传照片失败")).json();
}

export async function deleteMyPhoto(path: string): Promise<Me> {
  return (await request("/api/me/photos", { method: "DELETE", ...json({ path }) }, "删除照片失败")).json();
}

// 清空衣橱、照片、搭配和试穿记录，回到首次体验状态
export async function resetMe(): Promise<Me> {
  return (await request("/api/me/reset", { method: "POST" }, "重新开始失败")).json();
}

// ---------------------------------------------------------------------------
// 单品
// ---------------------------------------------------------------------------
export async function fetchItems(): Promise<Item[]> {
  return (await request("/api/items", {}, "加载单品失败")).json();
}

// 上传一张单品图，返回存储 key
export async function uploadImage(file: Blob): Promise<string> {
  const res = await request("/api/items/upload", { method: "POST", body: fileForm("file", file) }, "图片上传失败");
  return (await res.json()).path as string;
}

// 自动打标：传图（不落盘）→ 视觉模型识别 → 结构化字段预填表单
export async function autoTagImage(file: Blob): Promise<TagResult> {
  return (await request("/api/items/auto-tag", { method: "POST", body: fileForm("file", file) }, "识别失败，请手动填写")).json();
}

/** 衣橱拖拽排序：传自己全部单品的 id（新顺序）。 */
export async function reorderItems(ids: string[]): Promise<void> {
  await request("/api/items/reorder", { method: "POST", ...json({ ids }) }, "保存排序失败");
}

export async function createItem(input: ItemInput): Promise<Item> {
  return (await request("/api/items", { method: "POST", ...json(input) }, "新建单品失败")).json();
}

export async function deleteItem(id: string): Promise<void> {
  await request(`/api/items/${id}`, { method: "DELETE" }, "删除单品失败");
}

/** 衣橱多选批量删除：全有或全无，有一件不是自己的就整批失败。 */
export async function batchDeleteItems(ids: string[]): Promise<void> {
  await request("/api/items/batch-delete", { method: "POST", ...json({ ids }) }, "批量删除失败");
}

// ---------------------------------------------------------------------------
// 单品页：每个操作调用即生效，都返回更新后的整件单品（带后台生成任务）
// ---------------------------------------------------------------------------
export async function fetchItem(id: string): Promise<Item> {
  return (await request(`/api/items/${id}`, {}, "加载单品失败")).json();
}

export async function patchItem(id: string, patch: ItemPatch): Promise<Item> {
  return (await request(`/api/items/${id}`, { method: "PATCH", ...json(patch) }, "保存失败")).json();
}

export async function addItemImage(id: string, file: Blob): Promise<Item> {
  return (await request(`/api/items/${id}/images`, { method: "POST", body: fileForm("file", file) }, "添加图片失败")).json();
}

export async function rotateItemImage(id: string, imageId: string, direction: "cw" | "ccw"): Promise<Item> {
  return (
    await request(`/api/items/${id}/images/${imageId}/rotate`, { method: "POST", ...json({ direction }) }, "旋转失败")
  ).json();
}

export async function setItemPrimary(id: string, imageId: string): Promise<Item> {
  return (await request(`/api/items/${id}/primary`, { method: "PUT", ...json({ image_id: imageId }) }, "设置主图失败")).json();
}

export async function deleteItemImage(id: string, imageId: string): Promise<Item> {
  return (await request(`/api/items/${id}/images/${imageId}`, { method: "DELETE" }, "删除图片失败")).json();
}

/** 开始后台生成（标准照 / 自定义编辑）。立即返回；完成后结果追加进图库，结果图 id = job_id。 */
export async function startItemJob(
  id: string,
  input: { kind: ItemJob["kind"]; source_image_id: string; prompt?: string },
): Promise<{ job_id: string; item: Item }> {
  return (await request(`/api/items/${id}/jobs`, { method: "POST", ...json(input) }, "开始生成失败")).json();
}

/** 关掉一条失败任务的提示。 */
export async function dismissItemJob(id: string, jobId: string): Promise<Item> {
  return (await request(`/api/items/${id}/jobs/${jobId}`, { method: "DELETE" }, "操作失败")).json();
}

// ---------------------------------------------------------------------------
// 图片工具
// ---------------------------------------------------------------------------
/**
 * 同步生图（不落库），现在只有「我」里的本人照片编辑在用；单品的生成走上面的后台任务。
 * 只选场景 + 传用户指令；提示词、尺寸和兜底约束都由后端按场景决定（domain/image_scenes.py）。
 */
export type ImageScene = "item_normalize" | "item_edit" | "photo_edit";

export async function generateImage(scene: ImageScene, source: Blob, instruction?: string): Promise<Blob> {
  const form = fileForm("source", source, "source.jpg");
  form.append("kind", scene);
  if (instruction) form.append("prompt", instruction);
  return (await request("/api/images/generate", { method: "POST", body: form }, "生成失败")).blob();
}

// ---------------------------------------------------------------------------
// 搭配 + 生成上身图（异步 + 轮询）
// ---------------------------------------------------------------------------
export async function createOutfit(input: { item_ids: string[]; note?: string }): Promise<Outfit> {
  return (await request("/api/outfits", { method: "POST", ...json(input) }, "保存搭配失败")).json();
}

export async function createGeneration(outfitId: string): Promise<Generation> {
  return (await request("/api/generations", { method: "POST", ...json({ outfit_id: outfitId }) }, "提交生图失败")).json();
}

export async function getGeneration(id: string): Promise<Generation> {
  return (await request(`/api/generations/${encodeURIComponent(id)}`, {}, "查询生图进度失败")).json();
}

/** enhance=false：跳过 AI 补全，直接用原图作为换装底图（仍会估计性别 / 年龄 / 身高）。 */
export async function prepareOnboardingPhoto(file: File, options: { enhance?: boolean } = {}): Promise<Me> {
  const form = fileForm("file", file, file.name);
  form.append("enhance", String(options.enhance ?? true));
  return (await request("/api/onboarding/photo", { method: "POST", body: form }, "照片处理失败")).json();
}

export async function fetchOnboardingScenes(gender: "female" | "male", need = ""): Promise<OnboardingScene[]> {
  const query = new URLSearchParams({ gender, need });
  return (await request(`/api/onboarding/scenes?${query}`, {}, "加载场景失败")).json();
}

export async function startOnboardingTryon(input: { gender: "female" | "male"; scene_id: string; need?: string }): Promise<Generation> {
  return (await request("/api/onboarding/try-on", { method: "POST", ...json(input) }, "提交试穿失败")).json();
}

export async function completeOnboarding(generationId: string): Promise<Me> {
  return (await request("/api/onboarding/complete", { method: "POST", ...json({ generation_id: generationId }) }, "保存首次体验失败")).json();
}

// ---------------------------------------------------------------------------
// 选款
// ---------------------------------------------------------------------------
export async function fetchRecommendReadiness(): Promise<RecommendReadiness> {
  return (await request("/api/recommend/readiness", {}, "检查衣橱失败")).json();
}

export async function postRecommend(
  need: string,
  history?: { role: string; text: string }[],
): Promise<RecommendResponse> {
  return (await request("/api/recommend", { method: "POST", ...json({ need, history: history ?? [] }) }, "选款请求失败")).json();
}

export async function fetchTryonHistory(offset = 0): Promise<{ items: (Generation & { outfit: Outfit })[]; has_more: boolean }> {
  return (await request(`/api/generations?offset=${offset}`, {}, "加载试穿历史失败")).json();
}
