import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { resetMe, updateMe } from "../api";
import type { Me } from "../types";
import { MAX_PHOTOS } from "../constants";
import { errMsg } from "../utils";
import TryonHistory from "./TryonHistory";
import MyPhotos from "./MyPhotos";
import { useConfirm } from "./useConfirm";
import { useModelPhotoEditor } from "./useModelPhotoEditor";

// 「我」：名字 + 本人照片（生图底图从这里选）
export default function MyProfile({
  me,
  onUpdated,
  onReset,
}: {
  me: Me;
  onUpdated: (m: Me) => void;
  onReset: (m: Me) => void;
}) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [name, setName] = useState(me.name);
  const [gender, setGender] = useState<"female" | "male" | "">(
    me.gender === "female" || me.gender === "male" ? me.gender : "",
  );
  const [age, setAge] = useState(me.age == null ? "" : String(me.age));
  const [height, setHeight] = useState(me.height_cm == null ? "" : String(me.height_cm));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  const savedGender = me.gender === "female" || me.gender === "male" ? me.gender : "";
  const dirty =
    name.trim() !== me.name ||
    gender !== savedGender ||
    age.trim() !== (me.age == null ? "" : String(me.age)) ||
    height.trim() !== (me.height_cm == null ? "" : String(me.height_cm));

  const photoEditor = useModelPhotoEditor(onUpdated);

  async function onSave() {
    const nm = name.trim();
    if (!nm) return setMsg("名字不能为空");
    const ageValue = age.trim() === "" ? null : Number(age);
    if (ageValue !== null && (!Number.isInteger(ageValue) || ageValue < 10 || ageValue > 100)) {
      return setMsg("年龄填 10 到 100 之间的整数");
    }
    const heightValue = height.trim() === "" ? null : Number(height);
    if (heightValue !== null && (!Number.isInteger(heightValue) || heightValue < 120 || heightValue > 230)) {
      return setMsg("身高填 120 到 230 厘米之间的整数");
    }
    setSaving(true);
    setMsg("");
    try {
      const saved = await updateMe({ name: nm, gender, age: ageValue, height_cm: heightValue });
      // 用服务端返回的值回填，避免 "028" 这类写法保存后仍显示为未保存。
      setName(saved.name);
      setAge(saved.age == null ? "" : String(saved.age));
      setHeight(saved.height_cm == null ? "" : String(saved.height_cm));
      onUpdated(saved);
      setJustSaved(true);
    } catch (e) {
      setMsg(errMsg(e, "保存失败"));
    } finally {
      setSaving(false);
    }
  }

  async function onResetClick() {
    const ok = await confirm({
      title: "清除全部数据？",
      message: "衣橱、本人照片、搭配和试穿记录都会被清除，无法恢复。账号会保留，之后从首次体验重新开始。",
      confirmText: "全部清除",
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    setMsg("");
    try {
      onReset(await resetMe());
    } catch (e) {
      setMsg(errMsg(e, "清除失败"));
    } finally {
      setResetting(false);
    }
  }

  if (historyOpen) return <TryonHistory onBack={() => setHistoryOpen(false)} />;

  return (
    <div className="my-profile">
      <section className="mp-section" aria-labelledby="mp-profile-title">
        <h2 className="mp-section-title" id="mp-profile-title">个人资料</h2>
        <div className="mp-list">
          <div className="mp-row">
            <label className="mp-row-label" htmlFor="mp-name">名字</label>
            <input
              id="mp-name"
              className="mp-input mp-input-text"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder="你的名字"
            />
          </div>
          <div className="mp-row" title="AI 根据照片估计，可以修改">
            <span className="mp-row-label">性别</span>
            <div className="mp-segmented" role="group" aria-label="性别">
              <button
                type="button"
                className={gender === "female" ? "active" : ""}
                aria-pressed={gender === "female"}
                disabled={saving}
                onClick={() => setGender("female")}
              >
                女
              </button>
              <button
                type="button"
                className={gender === "male" ? "active" : ""}
                aria-pressed={gender === "male"}
                disabled={saving}
                onClick={() => setGender("male")}
              >
                男
              </button>
            </div>
          </div>
          <div className="mp-row" title="AI 根据照片估计，可以修改">
            <label className="mp-row-label" htmlFor="mp-age">年龄</label>
            <span className="mp-row-control">
              <input
                id="mp-age"
                className="mp-input mp-input-number"
                type="number"
                inputMode="numeric"
                min={10}
                max={100}
                step={1}
                value={age}
                placeholder="未填"
                disabled={saving}
                onChange={(e) => setAge(e.target.value)}
              />
              <span className="mp-unit">岁</span>
            </span>
          </div>
          <div className="mp-row" title="AI 根据照片估计，可以修改">
            <label className="mp-row-label" htmlFor="mp-height">身高</label>
            <span className="mp-row-control">
              <input
                id="mp-height"
                className="mp-input mp-input-number"
                type="number"
                inputMode="numeric"
                min={120}
                max={230}
                step={1}
                value={height}
                placeholder="未填"
                disabled={saving}
                onChange={(e) => setHeight(e.target.value)}
              />
              <span className="mp-unit">cm</span>
            </span>
          </div>
        </div>
      </section>

      <section className="mp-section" aria-labelledby="mp-photos-title">
        <h2 className="mp-section-title" id="mp-photos-title">我的照片 · {me.photos.length}/{MAX_PHOTOS}</h2>
        <MyPhotos
          me={me}
          onUpdated={onUpdated}
          onError={setMsg}
          onStatus={setMsg}
          onEditPhoto={photoEditor.openEdit}
        />
      </section>

      <section className="mp-section" aria-label="更多">
        <div className="mp-list">
          <button className="mp-row mp-row-nav" type="button" onClick={() => setHistoryOpen(true)}>
            <span className="mp-row-label">试穿历史</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button
            className="mp-row mp-row-nav danger"
            type="button"
            title="清除衣橱、照片和试穿记录，回到新用户状态"
            onClick={() => void onResetClick()}
            disabled={resetting}
          >
            <span className="mp-row-label">{resetting ? "正在清除…" : "清除全部数据"}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* 整页统一的保存栏：吸底，只负责名字 / 性别 / 年龄 / 身高；照片操作是即时生效的。 */}
      <div className="my-profile-savebar">
        <span className="my-profile-savebar-msg" role="status">
          {msg || (dirty ? "有未保存的修改" : justSaved ? "已保存" : "")}
        </span>
        <button className="btn-primary" type="button" onClick={onSave} disabled={saving || !dirty}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      {confirmDialog}
      {photoEditor.dialog}
    </div>
  );
}
