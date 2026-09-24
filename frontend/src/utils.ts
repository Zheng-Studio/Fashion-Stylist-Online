// 把 catch 到的任意值转成可读文案。全站错误提示统一走这里。
export function errMsg(e: unknown, fallback = "操作失败"): string {
  if (e instanceof Error) return e.message || fallback;
  if (typeof e === "string") return e || fallback;
  return String(e ?? fallback);
}

const FILES_BASE = import.meta.env.VITE_FILES_BASE ?? "/files/";

// 存储 key → 图片 URL。
// 后端所有图片字段存的都是 key（如 u/<uid>/items/<uuid>.jpg），写入后永不原地修改
// （旋转也是写新 key），所以 URL 天然不可变，不需要任何破缓存参数。
export function assetUrl(key: string | null | undefined): string {
  if (!key) return "";
  return FILES_BASE + key;
}
