import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  completeOnboarding,
  fetchOnboardingScenes,
  getGeneration,
  prepareOnboardingPhoto,
  startOnboardingTryon,
  updateMe,
} from "../api";
import type { Generation, Me, OnboardingScene } from "../types";
import { assetUrl, errMsg } from "../utils";
import Modal from "./Modal";
import "./Onboarding.css";

type Gender = "female" | "male";
type Step = "photo" | "scenes" | "result";

// 超过这么久还没好，就把「通常需要…」换成一句安抚，免得用户以为卡死了
const SLOW_AFTER_S = 75;

/** 等待生图的状态：转圈 + 文案 + 已等待秒数 + 预期时长。挂载时开始计时，卸载即停。 */
function WaitingState({ label, hint }: { label: string; hint: string }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="onboarding-loading" role="status">
      <span className="onboarding-spinner" aria-hidden="true" />
      <span>{label}</span>
      {/* 秒数每秒都变，不放进 live region，免得读屏每秒播报一次 */}
      <span className="onboarding-wait" aria-hidden="true">
        已等待 {secs} 秒 · {secs >= SLOW_AFTER_S ? "比平时慢一些，请再稍等" : hint}
      </span>
    </div>
  );
}

/** 示例单品图来自 COS 公网地址，可能较慢：加载中显示流光占位，失败给出提示。 */
function RemoteImg({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  return (
    <span className={`onboarding-remote is-${state}`} aria-busy={state === "loading"}>
      <img src={src} alt={alt} onLoad={() => setState("loaded")} onError={() => setState("error")} />
      {state === "error" && <span className="onboarding-remote-error">加载失败</span>}
    </span>
  );
}

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
  // 这次的底图是不是用户直接选用的原图（没经过 AI 补全）。
  const [usedOriginal, setUsedOriginal] = useState(false);
  const [processingMode, setProcessingMode] = useState<"enhance" | "original">("enhance");
  const [gender, setGender] = useState<Gender | "">("");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
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
  const resultPath = generationStatus === "done" ? generation?.result_path ?? null : null;
  // 照片处理中；结果页等图时复用同一个流转动画。
  const processing = busy && !!pendingFile;
  const generating = step === "result" && generationStatus !== "done" && generationStatus !== "failed";

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
    setUsedOriginal(false);
    setGender("");
    setAge("");
    setHeight("");
    setLightbox(null);
    setError("");
  }

  async function processPhoto(enhance: boolean) {
    if (!pendingFile) return;
    setBusy(true);
    setProcessingMode(enhance ? "enhance" : "original");
    setError("");
    try {
      const me = await prepareOnboardingPhoto(pendingFile, { enhance });
      setPhoto(assetUrl(me.gen_base));
      setUsedOriginal(!enhance);
      // Keep the local upload around so it stays visible next to the generated photo.
      setGender(me.gender === "female" || me.gender === "male" ? me.gender : "");
      setAge(me.age == null ? "" : String(me.age));
      setHeight(me.height_cm == null ? "" : String(me.height_cm));
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
    const ageValue = age.trim() === "" ? null : Number(age);
    if (ageValue !== null && (!Number.isInteger(ageValue) || ageValue < 10 || ageValue > 100)) {
      setError("年龄填 10 到 100 之间的整数");
      return;
    }
    const heightValue = height.trim() === "" ? null : Number(height);
    if (heightValue !== null && (!Number.isInteger(heightValue) || heightValue < 120 || heightValue > 230)) {
      setError("身高填 120 到 230 厘米之间的整数");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // 估计值只是默认值；继续前先按用户改过的结果落库。
      await updateMe({ gender, age: ageValue, height_cm: heightValue });
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
      <main className={`onboarding-main${step === "photo" ? " onboarding-main-photo" : ""}`}>
        {step === "photo" && (
          <section className="onboarding-photo-step" aria-label="上传照片">
            <div className="onboarding-photo-layout">
              <div className="onboarding-photo-pane onboarding-photo-pane-input">
                <div className="onboarding-photo-copy">
                  <h1>上传你的照片</h1>
                  <p>全身或半身照都可以。建议正对镜头、光线均匀、背景干净。</p>
                  <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) selectPhoto(file);
                  }} />
                </div>
                <div className="onboarding-photo-input-frame">
                  <div className={`onboarding-photo${uploadPreview ? "" : " is-empty"}`}>
                    {uploadPreview ? (
                      <button
                        type="button"
                        className="onboarding-zoom"
                        aria-label="放大查看上传的照片"
                        onClick={() => setLightbox({ src: uploadPreview, alt: "上传的原图" })}
                      >
                        <img src={uploadPreview} alt="上传的原图" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="onboarding-upload"
                        onClick={() => fileInput.current?.click()}
                        disabled={busy}
                      >
                        <Plus size={32} strokeWidth={1.4} aria-hidden="true" />
                        <span>上传照片</span>
                      </button>
                    )}
                  </div>
                  <small className="onboarding-photo-caption">你的照片</small>
                </div>
              </div>

              <div className="onboarding-photo-pane onboarding-photo-pane-output">
                <div className="onboarding-photo">
                  {photo ? (
                    <button
                      type="button"
                      className="onboarding-zoom"
                      aria-label={usedOriginal ? "放大查看换装底图" : "放大查看生成的照片"}
                      onClick={() => setLightbox({ src: photo, alt: usedOriginal ? "换装底图" : "生成的全身照" })}
                    >
                      <img src={photo} alt={usedOriginal ? "换装底图" : "生成的全身照"} />
                    </button>
                  ) : processing ? (
                    <WaitingState
                      label={processingMode === "original" ? "正在读取照片…" : "正在处理照片…"}
                      hint={processingMode === "original" ? "通常几秒钟" : "通常需要 30 秒到 1 分钟"}
                    />
                  ) : (
                    <span className="onboarding-photo-empty">生成后显示在这里</span>
                  )}
                </div>
                <small className="onboarding-photo-caption">{usedOriginal && photo ? "直接使用原图作为换装底图" : "生成的全身照"}</small>
              </div>
            </div>
            {photo && (
              <div className="onboarding-photo-meta">
                <div className="onboarding-gender" role="group" aria-label="性别">
                  <span>性别</span>
                  <button type="button" className={gender === "female" ? "active" : ""} aria-pressed={gender === "female"} onClick={() => setGender("female")}>女</button>
                  <button type="button" className={gender === "male" ? "active" : ""} aria-pressed={gender === "male"} onClick={() => setGender("male")}>男</button>
                </div>
                <div className="onboarding-figures">
                  <label>
                    年龄
                    <input
                      type="number"
                      inputMode="numeric"
                      min={10}
                      max={100}
                      step={1}
                      aria-label="年龄"
                      placeholder="未知"
                      value={age}
                      disabled={busy}
                      onChange={(e) => setAge(e.target.value)}
                    />
                    岁
                  </label>
                  <label>
                    身高
                    <input
                      type="number"
                      inputMode="numeric"
                      min={120}
                      max={230}
                      step={1}
                      aria-label="身高"
                      placeholder="未知"
                      value={height}
                      disabled={busy}
                      onChange={(e) => setHeight(e.target.value)}
                    />
                    cm
                  </label>
                </div>
                <p className="onboarding-estimate">AI 根据照片估计，可以修改</p>
              </div>
            )}
            {(photo || pendingFile) && (
              <div className="onboarding-photo-footer">
                <button className="onboarding-secondary" type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
                  更换照片
                </button>
                {pendingFile && (
                  <div className="onboarding-photo-choices">
                    <button className="onboarding-quiet" type="button" onClick={() => void processPhoto(false)} disabled={busy} title="照片已经满意，不需要 AI 补全成全身照">
                      {busy && processingMode === "original" ? "正在读取照片…" : "直接使用原图"}
                    </button>
                    <button className="onboarding-primary" type="button" onClick={() => void processPhoto(true)} disabled={busy}>
                      {busy && processingMode === "enhance" ? "正在处理照片…" : "处理照片"}
                    </button>
                  </div>
                )}
                {photo && <button className="onboarding-primary" type="button" onClick={() => void loadScenes()} disabled={busy}>{busy ? "正在加载搭配…" : "继续"}</button>}
              </div>
            )}
          </section>
        )}
        {step === "scenes" && (
          <section className="onboarding-scenes" aria-label="选择场景">
            <h1>选一套，试试看</h1>
            <div className="onboarding-scene-grid">
              {scenes.map((item) => (
                <button key={item.id} type="button" className={`onboarding-scene${selected === item.id ? " active" : ""}`} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
                  <span className="onboarding-scene-images">{item.items.map((piece) => <RemoteImg key={piece.id} src={piece.image_url} alt={piece.name} />)}</span>
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
                {resultPath ? (
                  <button
                    type="button"
                    className="onboarding-zoom"
                    aria-label="放大查看"
                    onClick={() => setLightbox({ src: assetUrl(resultPath), alt: "试穿效果" })}
                  >
                    <img src={assetUrl(resultPath)} alt="试穿效果" onLoad={() => void finish()} onError={() => setError("试穿图加载失败，请重试")} />
                  </button>
                ) : generating ? (
                  <WaitingState label="正在生成试穿图…" hint="通常需要 30 秒到 1 分钟" />
                ) : (
                  <div className="onboarding-result-status">生成失败</div>
                )}
              </div>
              <div className="onboarding-result-side">
                <div className="onboarding-result-items">{scene?.items.map((piece) => <RemoteImg key={piece.id} src={piece.image_url} alt={piece.name} />)}</div>
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
      {lightbox && (
        <Modal
          title={lightbox.alt}
          className="onboarding-lightbox"
          bodyClassName="onboarding-lightbox-body"
          closeOnEscape
          onClose={() => setLightbox(null)}
        >
          <img src={lightbox.src} alt={lightbox.alt} />
        </Modal>
      )}
    </div>
  );
}
