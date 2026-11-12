import { useEffect, useRef, useState } from "react";
import {
  completeOnboarding,
  fetchOnboardingScenes,
  getGeneration,
  prepareOnboardingPhoto,
  startOnboardingTryon,
} from "../api";
import type { Generation, Me, OnboardingScene } from "../types";
import { assetUrl, errMsg } from "../utils";
import "./Onboarding.css";

type Gender = "female" | "male";
type Step = "photo" | "scenes" | "result";

export default function Onboarding({
  onCompleted,
  onExit,
}: {
  onCompleted: (me: Me) => void;
  onExit: (tab: "chat" | "me") => void;
}) {
  const [step, setStep] = useState<Step>("photo");
  const [photo, setPhoto] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [scenes, setScenes] = useState<OnboardingScene[]>([]);
  const [selected, setSelected] = useState("");
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const completionStarted = useRef(false);

  const scene = scenes.find((item) => item.id === selected);
  const generationId = generation?.id;
  const generationStatus = generation?.status;

  useEffect(() => () => {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
  }, [uploadPreview]);

  useEffect(() => {
    if (!generationId || (generationStatus !== "pending" && generationStatus !== "running")) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const next = await getGeneration(generationId);
        if (!cancelled) setGeneration(next);
      } catch (e) {
        if (!cancelled) {
          setError(errMsg(e, "查询试穿进度失败"));
          setGeneration((current) => current && { ...current, status: "failed" });
        }
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [generationId, generationStatus]);

  function selectPhoto(file: File) {
    setUploadPreview(URL.createObjectURL(file));
    setPendingFile(file);
    setPhoto("");
    setGender("");
    setError("");
  }

  async function processPhoto() {
    if (!pendingFile) return;
    setBusy(true);
    setError("");
    try {
      const me = await prepareOnboardingPhoto(pendingFile);
      setPhoto(assetUrl(me.gen_base));
      // The local preview is the uploaded original; release it so the newly
      // generated standard portrait becomes the visible image.
      setUploadPreview("");
      setGender(me.gender === "female" || me.gender === "male" ? me.gender : "");
      setPendingFile(null);
    } catch (e) {
      setError(errMsg(e, "照片处理失败"));
    } finally {
      setBusy(false);
    }
  }

  async function loadScenes() {
    if (!gender) {
      setError("请选择女或男");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await fetchOnboardingScenes(gender);
      setScenes(next);
      setSelected(next.find((item) => item.recommended)?.id ?? next[0]?.id ?? "");
      setStep("scenes");
    } catch (e) {
      setError(errMsg(e, "加载搭配失败"));
    } finally {
      setBusy(false);
    }
  }

  async function tryOn() {
    if (!gender || !selected) return;
    setBusy(true);
    setError("");
    setGeneration(null);
    try {
      const next = await startOnboardingTryon({ gender, scene_id: selected });
      setGeneration(next);
      setStep("result");
    } catch (e) {
      setError(errMsg(e, "提交试穿失败"));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!generation || completed || completionStarted.current) return;
    completionStarted.current = true;
    setError("");
    try {
      const me = await completeOnboarding(generation.id);
      setCompleted(true);
      onCompleted(me);
    } catch (e) {
      setError(errMsg(e, "保存首次体验失败"));
    } finally {
      completionStarted.current = false;
    }
  }

  return (
    <div className="onboarding">
      <header className="onboarding-header"><img src="/icon-192.png" alt="" />FashionStylist</header>
      <main className="onboarding-main">
        {step === "photo" && (
          <section className="onboarding-split" aria-label="上传照片">
            <div className="onboarding-photo">
              {uploadPreview || photo ? <img src={uploadPreview || photo} alt={pendingFile ? "待处理照片预览" : photo ? "处理后的个人照片" : "你的照片"} /> : <span>你的照片</span>}
            </div>
            <div className="onboarding-panel">
              <h1>上传你的照片</h1>
              <p>全身或半身照都可以</p>
              <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) selectPhoto(file);
              }} />
              <button className="onboarding-secondary" type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
                {photo || pendingFile ? "更换照片" : "选择照片"}
              </button>
              {pendingFile && <button className="onboarding-primary" type="button" onClick={() => void processPhoto()} disabled={busy}>{busy ? "正在处理照片…" : "处理照片"}</button>}
              {photo && (
                <>
                  <div className="onboarding-gender" role="group" aria-label="性别">
                    <span>性别</span>
                    <button type="button" className={gender === "female" ? "active" : ""} aria-pressed={gender === "female"} onClick={() => setGender("female")}>女</button>
                    <button type="button" className={gender === "male" ? "active" : ""} aria-pressed={gender === "male"} onClick={() => setGender("male")}>男</button>
                  </div>
                  <button className="onboarding-primary" type="button" onClick={() => void loadScenes()} disabled={busy}>{busy ? "正在加载搭配…" : "继续"}</button>
                </>
              )}
            </div>
          </section>
        )}
        {step === "scenes" && (
          <section className="onboarding-scenes" aria-label="选择场景">
            <h1>选一套，试试看</h1>
            <div className="onboarding-scene-grid">
              {scenes.map((item) => (
                <button key={item.id} type="button" className={`onboarding-scene${selected === item.id ? " active" : ""}`} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
                  <span className="onboarding-scene-images">{item.items.map((piece) => <img key={piece.id} src={piece.image_url} alt={piece.name} />)}</span>
                  <strong>{item.name}</strong><small>{item.hint}</small>
                </button>
              ))}
            </div>
            <div className="onboarding-actions">
              <button className="onboarding-primary" type="button" onClick={() => void tryOn()} disabled={busy || !selected}>{busy ? "正在提交…" : "试穿这套"}</button>
              <button className="onboarding-quiet" type="button" onClick={() => setStep("photo")}>返回</button>
            </div>
            <p className="onboarding-source">使用示例单品，不会加入你的衣橱</p>
          </section>
        )}
        {step === "result" && (
          <section className="onboarding-result" aria-label="试穿效果">
            <h1>{scene?.name ?? "试穿效果"}</h1>
            <div className="onboarding-result-layout">
              <div className="onboarding-photo result-photo">
                {generation?.status === "done" && generation.result_path ? (
                  <img src={assetUrl(generation.result_path)} alt="试穿效果" onLoad={() => void finish()} onError={() => setError("试穿图加载失败，请重试")} />
                ) : (
                  <div className="onboarding-result-status">{generation?.status === "failed" ? "生成失败" : "正在生成试穿图…"}</div>
                )}
              </div>
              <div className="onboarding-result-side">
                <div className="onboarding-result-items">{scene?.items.map((piece) => <img key={piece.id} src={piece.image_url} alt={piece.name} />)}</div>
                {generation?.status === "failed" ? (
                  <button className="onboarding-primary" type="button" onClick={() => void tryOn()} disabled={busy}>重新生成</button>
                ) : completed ? (
                  <div className="onboarding-actions result-actions">
                    <button className="onboarding-primary" type="button" onClick={() => onExit("me")}>添加我的衣服</button>
                    <button className="onboarding-quiet" type="button" onClick={() => onExit("chat")}>进入试衣间</button>
                  </div>
                ) : generation?.status === "done" ? (
                  <button className="onboarding-quiet" type="button" onClick={() => void finish()}>继续</button>
                ) : null}
              </div>
            </div>
          </section>
        )}
        {error && <p className="onboarding-error" role="alert">{error}</p>}
      </main>
    </div>
  );
}
