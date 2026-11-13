import { useState } from "react";
import { CATEGORIES, GENDERS, GENDER_LABEL } from "../constants";
import type { TagResult } from "../types";
import Modal from "./Modal";

// 新单品识别没拿准品类或性别时，衣橱里的占位卡停在「待补充」，点开就是这个小面板：
// 选好必填的两项就加入衣橱。单品还不存在，所以这里需要一次确认；加进去之后就是普通单品，在单品页里直接改。
export default function CompleteItemSheet({
  imageUrl,
  tags,
  onSubmit,
  onClose,
}: {
  imageUrl: string;
  tags?: Partial<TagResult>;
  onSubmit: (fields: { name: string; category: string; gender: string }) => Promise<string | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState(tags?.name ?? "");
  const [category, setCategory] = useState(tags?.category ?? "");
  const [gender, setGender] = useState(tags?.gender ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ready = !!category && !!gender;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setErr("");
    const e = await onSubmit({ name: name.trim(), category, gender });
    setBusy(false);
    if (e) setErr(e);
  }

  return (
    <Modal
      className="modal-narrow complete-sheet"
      title={<span>补充单品信息</span>}
      onClose={onClose}
      closeOnEscape
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            稍后再说
          </button>
          <button className="btn-primary" onClick={() => void submit()} disabled={!ready || busy}>
            {busy ? "加入中…" : "加入衣橱"}
          </button>
        </>
      }
    >
      <div className="complete-sheet-head">
        <img src={imageUrl} alt="新添加的单品" />
        <p>识别没拿准这件的品类或性别，选一下就能加入衣橱。其他信息加入后在单品页里随时改。</p>
      </div>
      <label className="field-label" htmlFor="complete-name">
        名称
      </label>
      <input
        id="complete-name"
        className="complete-sheet-input"
        type="text"
        value={name}
        maxLength={64}
        placeholder="可以不填"
        onChange={(e) => setName(e.target.value)}
      />
      <div className="field-label">品类</div>
      <div className="complete-sheet-chips" role="radiogroup" aria-label="品类">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={category === c}
            className={"chip" + (category === c ? " on" : "")}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="field-label">性别</div>
      <div className="complete-sheet-chips" role="radiogroup" aria-label="性别">
        {GENDERS.map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={gender === g}
            className={"chip" + (gender === g ? " on" : "")}
            onClick={() => setGender(g)}
          >
            {GENDER_LABEL[g]}
          </button>
        ))}
      </div>
      {err && <div className="form-err">{err}</div>}
    </Modal>
  );
}
