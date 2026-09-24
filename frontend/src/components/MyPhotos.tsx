import { useRef, useState } from "react";
import { deleteMyPhoto, updateMe, uploadMyPhoto } from "../api";
import type { Me } from "../types";
import { assetUrl, errMsg } from "../utils";
import { useConfirm } from "./useConfirm";

// 本人照片：上传 / 删除 / 设为生图底图 / AI 编辑入口
export default function MyPhotos({
  me,
  onUpdated,
  onError,
  onStatus,
  onEditPhoto,
}: {
  me: Me;
  onUpdated: (m: Me) => void;
  onError: (msg: string) => void;
  onStatus?: (msg: string) => void;
  onEditPhoto: (path: string) => void;
}) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<Me>, okMsg: string, failMsg: string) {
    setBusy(true);
    onError("");
    try {
      onUpdated(await action());
      onStatus?.(okMsg);
    } catch (e) {
      onError(errMsg(e, failMsg));
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void run(() => uploadMyPhoto(file), "照片已添加", "上传照片失败");
  }

  async function onDelete(path: string) {
    const ok = await confirm({
      title: "删除照片",
      message: "确定删除这张照片？此操作不可撤销。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    void run(() => deleteMyPhoto(path), "已删除", "删除照片失败");
  }

  return (
    <div className="my-profile-photos">
      {confirmDialog}
      {me.photos.map((path) => {
        const isBase = path === me.gen_base;
        return (
          <div key={path} className={"my-profile-photo" + (isBase ? " is-base" : "")}>
            <img src={assetUrl(path)} alt="" loading="lazy" />
            <button
              className="my-profile-photo-del"
              onClick={() => onDelete(path)}
              disabled={busy}
              aria-label="删除"
            >
              ✕
            </button>
            <div className="my-profile-photo-bar">
              {isBase ? (
                <span className="ppbar-base">★ 生图底图</span>
              ) : (
                <button
                  className="ppbar-btn"
                  onClick={() => void run(() => updateMe({ gen_base: path }), "已设为生图默认底图", "设置失败")}
                  disabled={busy}
                >
                  设为底图
                </button>
              )}
              <button className="ppbar-btn" onClick={() => onEditPhoto(path)}>
                ✦ 编辑
              </button>
            </div>
          </div>
        );
      })}
      <div className="my-profile-photo my-profile-photo-add" onClick={() => fileRef.current?.click()}>
        <span className="my-profile-photo-plus">+</span>
        <input ref={fileRef} type="file" accept="image/*" onChange={onPick} hidden disabled={busy} />
      </div>
    </div>
  );
}
