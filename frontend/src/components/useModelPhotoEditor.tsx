import { useState } from "react";
import { generateImage, uploadMyPhoto } from "../api";
import { MODEL_EDIT_PRESETS } from "../constants";
import type { Me } from "../types";
import { assetUrl, errMsg } from "../utils";
import Modal from "./Modal";

// 本人照片 AI 编辑：写指令 → 同步生成预览 → 「用这张」即作为一张新照片落库。
// 调用方只管：1) 渲染 dialog；2) 在某张图上放触发按钮调 openEdit(path)。
// onUploaded：上传成功后回调（拿到更新后的 Me），调用方据此刷新。
export function useModelPhotoEditor(onUploaded: (m: Me) => void) {
  const [editSrc, setEditSrc] = useState<string | null>(null); // 源图路径，非空=弹窗开
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrlState] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function setResultUrl(url: string | null) {
    setResultUrlState((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }
  function openEdit(src: string) {
    setEditSrc(src);
    setPrompt("");
    setErr("");
    setResultBlob(null);
    setResultUrl(null);
  }
  function closeEdit() {
    setEditSrc(null);
    setPrompt("");
    setErr("");
    setBusy(false);
    setResultBlob(null);
    setResultUrl(null);
  }
  // 取源图字节 → 生图接口编辑 → 结果当预览（不落库），可改指令重生成。
  async function runGenerate() {
    if (!editSrc || !prompt.trim()) {
      setErr("请输入编辑指令");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const srcBlob = await fetch(assetUrl(editSrc)).then((r) => r.blob());
      const result = await generateImage("edited", srcBlob, prompt.trim());
      setResultBlob(result);
      setResultUrl(URL.createObjectURL(result));
    } catch (e) {
      setErr(errMsg(e, "生成失败"));
    } finally {
      setBusy(false);
    }
  }
  // 确认：结果字节作为新照片上传（即时落库），追加进 photos。
  async function confirmResult() {
    if (!resultBlob) return;
    setBusy(true);
    setErr("");
    try {
      const file = new File([resultBlob], "edited.jpg", { type: "image/jpeg" });
      onUploaded(await uploadMyPhoto(file));
      closeEdit();
    } catch (e) {
      setErr(errMsg(e, "上传照片失败"));
      setBusy(false);
    }
  }

  const dialog = editSrc ? (
    <Modal
      className="modal-narrow"
      title={<span>AI 编辑照片</span>}
      onClose={closeEdit}
      footer={
        <>
          <button className="btn-ghost" onClick={closeEdit} disabled={busy}>
            取消
          </button>
          {resultBlob ? (
            <>
              <button
                className="btn-ghost"
                onClick={runGenerate}
                disabled={busy || !prompt.trim()}
              >
                {busy ? "生成中…" : "重新生成"}
              </button>
              <button className="btn-primary" onClick={confirmResult} disabled={busy}>
                用这张
              </button>
            </>
          ) : (
            <button
              className="btn-primary"
              onClick={runGenerate}
              disabled={busy || !prompt.trim()}
            >
              {busy ? "生成中…" : "生成"}
            </button>
          )}
        </>
      }
    >
      <div className="model-edit-compare">
        <figure>
          <img src={assetUrl(editSrc)} alt="原图" />
          <figcaption>原图</figcaption>
        </figure>
        <figure>
          {resultUrl ? (
            <img src={resultUrl} alt="结果" />
          ) : (
            <div className="model-edit-placeholder">{busy ? "生成中…" : "结果预览"}</div>
          )}
          <figcaption>结果</figcaption>
        </figure>
      </div>
      <label className="field-label">编辑指令</label>
      <textarea
        value={prompt}
        rows={2}
        autoFocus
        placeholder="想怎么改这张照片，如：换成纯白背景"
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="edit-presets">
        {MODEL_EDIT_PRESETS.map((p) => (
          <button key={p} type="button" className="preset" onClick={() => setPrompt(p)}>
            {p}
          </button>
        ))}
      </div>
      {err && <div className="form-err">{err}</div>}
    </Modal>
  ) : null;

  return { openEdit, closeEdit, dialog };
}
