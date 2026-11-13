import { useRef, useState } from "react";
import { deleteMyPhoto, updateMe, uploadMyPhoto } from "../api";
import type { Me } from "../types";
import { MAX_PHOTOS } from "../constants";
import { assetUrl, errMsg } from "../utils";
import Modal from "./Modal";
import PhotoMenu from "./PhotoMenu";
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
  const [viewing, setViewing] = useState<string | null>(null); // 灯箱里正在看的照片 key
  const fileRef = useRef<HTMLInputElement>(null);
  // 满 9 张：不再显示添加格；AI 编辑会另存一张新照片，也先禁掉，免得花了钱存不下。
  const full = me.photos.length >= MAX_PHOTOS;
  const fullHint = `最多 ${MAX_PHOTOS} 张，先删除一张`;

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
      {me.photos.map((path, index) => {
        const isBase = path === me.gen_base;
        return (
          <div key={path} className={"my-profile-photo" + (isBase ? " is-base" : "")}>
            <button
              type="button"
              className="my-profile-photo-zoom"
              aria-label={`放大查看照片 ${index + 1}`}
              onClick={() => setViewing(path)}
            >
              <img src={assetUrl(path)} alt={`我的照片 ${index + 1}`} loading="lazy" />
            </button>
            {isBase && (
              <span className="my-profile-photo-badge" role="img" aria-label="默认试穿底图" title="默认试穿底图">
                ★
              </span>
            )}
            <PhotoMenu
              label={`照片 ${index + 1} 的更多操作`}
              items={[
                ...(isBase
                  ? []
                  : [{
                      label: "设为默认试穿底图",
                      disabled: busy,
                      onSelect: () => void run(() => updateMe({ gen_base: path }), "已设为默认试穿底图", "设置失败"),
                    }]),
                { label: "编辑", disabled: full, hint: fullHint, onSelect: () => onEditPhoto(path) },
                { label: "删除", danger: true, disabled: busy, onSelect: () => void onDelete(path) },
              ]}
            />
          </div>
        );
      })}
      {!full && (
        <div className="my-profile-photo my-profile-photo-add" onClick={() => fileRef.current?.click()}>
          <span className="my-profile-photo-plus">+</span>
          <input ref={fileRef} type="file" accept="image/*" onChange={onPick} hidden disabled={busy} />
        </div>
      )}
      {viewing && (
        <Modal
          title={viewing === me.gen_base ? "★ 试穿底图" : "我的照片"}
          className="photo-lightbox"
          bodyClassName="photo-lightbox-body"
          closeOnEscape
          onClose={() => setViewing(null)}
          footer={
            <>
              <button
                className="btn-ghost"
                type="button"
                disabled={full}
                title={full ? fullHint : undefined}
                onClick={() => {
                  setViewing(null);
                  onEditPhoto(viewing);
                }}
              >
                ✦ 编辑
              </button>
              {viewing !== me.gen_base && (
                <button
                  className="btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => updateMe({ gen_base: viewing }), "已设为默认试穿底图", "设置失败")}
                >
                  设为默认试穿底图
                </button>
              )}
            </>
          }
        >
          <img src={assetUrl(viewing)} alt="放大的照片" />
        </Modal>
      )}
    </div>
  );
}
