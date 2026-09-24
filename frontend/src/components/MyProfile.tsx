import { useState } from "react";
import { updateMe } from "../api";
import type { Me } from "../types";
import { assetUrl, errMsg } from "../utils";
import GenderChips from "./GenderChips";
import MyPhotos from "./MyPhotos";
import { useModelPhotoEditor } from "./useModelPhotoEditor";
import { useAvatarCropper } from "./useAvatarCropper";

// 「我」：名字 / 性别（给选款做上下文）+ 本人照片（生图底图从这里选）
export default function MyProfile({ me, onUpdated }: { me: Me; onUpdated: (m: Me) => void }) {
  const [name, setName] = useState(me.name);
  const [gender, setGender] = useState(me.gender ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const avatar = me.avatar || me.photos[0] || "";

  const photoEditor = useModelPhotoEditor(onUpdated);
  const cropper = useAvatarCropper(me.photos, onUpdated);

  async function onSave() {
    const nm = name.trim();
    if (!nm) return setMsg("名字不能为空");
    setSaving(true);
    setMsg("");
    try {
      onUpdated(await updateMe({ name: nm, gender }));
      setMsg("已保存");
    } catch (e) {
      setMsg(errMsg(e, "保存失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="my-profile">
      <div className="my-profile-avatar" onClick={() => cropper.openCrop()}>
        {avatar ? (
          <img src={assetUrl(avatar)} alt={me.name} />
        ) : (
          <div className="my-profile-noimg">{me.name.slice(0, 1) || "?"}</div>
        )}
        <div className="my-profile-avatar-overlay">更换头像</div>
      </div>

      <label className="field-label">名字</label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={saving}
        placeholder="你的名字"
      />

      <label className="field-label">性别</label>
      <GenderChips value={gender} onChange={setGender} disabled={saving} />

      <button className="btn-primary" onClick={onSave} disabled={saving}>
        {saving ? "保存中…" : "保存"}
      </button>

      <hr className="my-profile-sep" />
      <label className="field-label">
        我的照片（{me.photos.length} 张）· <span className="gen-base-star">★</span> 为生图默认底图
      </label>

      <MyPhotos
        me={me}
        onUpdated={onUpdated}
        onError={setMsg}
        onStatus={setMsg}
        onEditPhoto={photoEditor.openEdit}
      />

      {msg && <div className="form-msg">{msg}</div>}
      {photoEditor.dialog}
      {cropper.dialog}
    </div>
  );
}
