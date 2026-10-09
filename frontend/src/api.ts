import { authHeaders } from "./auth";
import type {
  Generation,
  Item,
  ItemInput,
  Me,
  Outfit,
  RecommendResponse,
  TagResult,
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
  patch: { name?: string; gen_base?: string; photos?: string[] },
): Promise<Me> {
  return (await request("/api/me", { method: "PUT", ...json(patch) }, "保存失败")).json();
}

export async function uploadMyPhoto(file: Blob): Promise<Me> {
  return (await request("/api/me/photos", { method: "POST", body: fileForm("file", file) }, "上传照片失败")).json();
}

export async function deleteMyPhoto(path: string): Promise<Me> {
  return (await request("/api/me/photos", { method: "DELETE", ...json({ path }) }, "删除照片失败")).json();
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

export async function createItem(input: ItemInput): Promise<Item> {
  return (await request("/api/items", { method: "POST", ...json(input) }, "新建单品失败")).json();
}

export async function updateItem(id: string, input: ItemInput): Promise<Item> {
  return (await request(`/api/items/${id}`, { method: "PUT", ...json(input) }, "保存单品失败")).json();
}

export async function deleteItem(id: string): Promise<void> {
  await request(`/api/items/${id}`, { method: "DELETE" }, "删除单品失败");
}

// ---------------------------------------------------------------------------
// 图片工具
// ---------------------------------------------------------------------------
// 白底标准照 / AI 编辑：纯图像变换，传源图字节、拿结果 Blob，调用方决定要不要落库。
export async function generateImage(
  kind: "normalized" | "edited",
  source: Blob,
  prompt?: string,
): Promise<Blob> {
  const form = fileForm("source", source, "source.jpg");
  form.append("kind", kind);
  if (prompt) form.append("prompt", prompt);
  return (await request("/api/images/generate", { method: "POST", body: form }, "生成失败")).blob();
}

// 顺时针转 90°：后端写成新文件，返回新 key（旧文件在单品保存时清理）
export async function rotateImage(path: string): Promise<string> {
  const res = await request("/api/images/rotate", { method: "POST", ...json({ path }) }, "旋转失败");
  return (await res.json()).path as string;
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

// ---------------------------------------------------------------------------
// 选款
// ---------------------------------------------------------------------------
export async function postRecommend(
  need: string,
  history?: { role: string; text: string }[],
): Promise<RecommendResponse> {
  return (await request("/api/recommend", { method: "POST", ...json({ need, history: history ?? [] }) }, "选款请求失败")).json();
}
