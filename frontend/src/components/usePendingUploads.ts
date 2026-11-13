import { useCallback, useEffect, useRef, useState } from "react";
import { autoTagImage, createItem, uploadImage } from "../api";
import type { Item, TagResult } from "../types";
import { assetUrl, errMsg } from "../utils";

// 衣橱「添加单品」的后台流水线：选完图立刻在列表里出一张占位卡，
// 每张按 上传中 → 智能识别中 → 保存中 → 完成 自己跑完，用户可以接着添加。
//
// - 识别出品类和性别就直接建单品，之后就是普通单品，在单品页里直接改。
// - 识别失败或缺品类 / 性别：停在「待补充」，点开一个小面板选好两项就加入衣橱（complete）。
//   图已经上传过，补充时不会重传。
// - 预览 objectURL 在这里建、在移除时回收。

export type PendingStatus = "uploading" | "tagging" | "saving" | "done" | "needs_info" | "failed";

export interface PendingUpload {
  id: string;
  file: File;
  url: string; // 本地预览
  path?: string; // 上传完成后的存储 key
  tags?: Partial<TagResult>; // 识别出来的（可能不全），「待补充」面板拿来预填
  status: PendingStatus;
  error?: string;
  item?: Item; // 完成后建出来的单品
}

const CONCURRENCY = 2; // 一次最多并行跑两张，免得一次选十几张把识别接口打满
const DONE_LINGER_MS = 1500; // 「完成」状态停留一会儿再换成正式卡片
const PRELOAD_MAX_MS = 8000; // 换卡前等正式图加载，最多等这么久

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, "");

const EMPTY_TAGS: TagResult = { name: "", gender: "", category: "", color: [], season: [], description: "" };

export function usePendingUploads(onCreated: () => void) {
  const [pending, setPending] = useState<PendingUpload[]>([]);
  // 流水线读写用的权威副本（异步步骤里拿最新值，不依赖闭包里的旧 state）
  const entries = useRef(new Map<string, PendingUpload>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const timers = useRef<number[]>([]);
  const onCreatedRef = useRef(onCreated);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  }, [onCreated]);

  const patch = useCallback((id: string, change: Partial<PendingUpload>) => {
    const cur = entries.current.get(id);
    if (!cur) return;
    const next = { ...cur, ...change };
    entries.current.set(id, next);
    setPending((list) => list.map((p) => (p.id === id ? next : p)));
  }, []);

  const remove = useCallback((id: string) => {
    const cur = entries.current.get(id);
    if (cur) URL.revokeObjectURL(cur.url);
    entries.current.delete(id);
    setPending((list) => list.filter((p) => p.id !== id));
  }, []);

  /** 建单品，成功后显示「已添加」一会儿、等正式图加载好再把占位卡换掉。 */
  const create = useCallback(
    async (id: string, path: string, tags: TagResult) => {
      patch(id, { status: "saving", error: undefined });
      const imageId = newId();
      const item = await createItem({ ...tags, images: [{ id: imageId, kind: "upload", path }], primary_image_id: imageId });
      patch(id, { status: "done", item });
      onCreatedRef.current();
      // 正式卡片用的是存储里的图：先预加载好再换，免得换上去是一张空白卡。最多等 PRELOAD_MAX_MS。
      const preload = new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => resolve();
        img.src = assetUrl(item.primary_path);
        timers.current.push(window.setTimeout(resolve, PRELOAD_MAX_MS));
      });
      const linger = new Promise<void>((resolve) => {
        timers.current.push(window.setTimeout(resolve, DONE_LINGER_MS));
      });
      void Promise.all([preload, linger]).then(() => remove(id));
    },
    [patch, remove],
  );

  const runOne = useCallback(
    async (id: string) => {
      const start = entries.current.get(id);
      if (!start) return;
      try {
        let path = start.path;
        if (!path) {
          patch(id, { status: "uploading", error: undefined });
          path = await uploadImage(start.file);
          patch(id, { path });
        }
        patch(id, { status: "tagging" });
        let tags: TagResult;
        try {
          tags = await autoTagImage(start.file);
        } catch (e) {
          patch(id, { status: "needs_info", error: errMsg(e, "识别失败") });
          return;
        }
        // 必填是保存边界的约束：缺了就交给用户补，不在这里硬塞默认值
        if (!tags.category || !tags.gender) {
          patch(id, { status: "needs_info", tags, error: "需要补充品类或性别" });
          return;
        }
        await create(id, path, tags);
      } catch (e) {
        const cur = entries.current.get(id);
        // 图已经传上去了就别让用户重传，转成「待补充」；没传上去才算失败可重试
        if (cur?.path) patch(id, { status: "needs_info", error: errMsg(e, "保存失败") });
        else patch(id, { status: "failed", error: errMsg(e, "上传失败") });
      }
    },
    [patch, create],
  );

  // 跑完一张再拉下一张；递归调用走 ref，拿到的总是最新的 pump
  const pumpRef = useRef<() => void>(() => {});
  const pump = useCallback(() => {
    while (active.current < CONCURRENCY && queue.current.length) {
      const id = queue.current.shift()!;
      active.current += 1;
      void runOne(id).finally(() => {
        active.current -= 1;
        pumpRef.current();
      });
    }
  }, [runOne]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const add = useCallback(
    (files: File[]) => {
      const added = files.map((file) => ({
        id: newId(),
        file,
        url: URL.createObjectURL(file),
        status: "uploading" as const,
      }));
      for (const p of added) {
        entries.current.set(p.id, p);
        queue.current.push(p.id);
      }
      setPending((list) => [...added.reverse(), ...list]); // 新的排最前
      pump();
    },
    [pump],
  );

  /** 「待补充」的卡：用户选好品类 / 性别后加入衣橱。返回错误文案（null = 成功）。 */
  const complete = useCallback(
    async (id: string, fields: { name: string; category: string; gender: string }): Promise<string | null> => {
      const cur = entries.current.get(id);
      if (!cur?.path) return "图片还没上传好";
      try {
        await create(id, cur.path, { ...EMPTY_TAGS, ...cur.tags, ...fields });
        return null;
      } catch (e) {
        patch(id, { status: "needs_info" });
        return errMsg(e, "加入衣橱失败");
      }
    },
    [create, patch],
  );

  /** 失败的卡重新跑一遍。 */
  const retry = useCallback(
    (id: string) => {
      queue.current.push(id);
      patch(id, { status: "uploading", error: undefined });
      pump();
    },
    [patch, pump],
  );

  useEffect(() => {
    const map = entries.current;
    const ts = timers.current;
    return () => {
      ts.forEach((t) => window.clearTimeout(t));
      map.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, []);

  return { pending, add, complete, discard: remove, retry };
}
