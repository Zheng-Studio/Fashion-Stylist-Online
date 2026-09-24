import { useEffect, useRef, useState } from "react";
import { createGeneration, createOutfit, getGeneration, postRecommend } from "../api";
import type { DressStep, RecommendResponse } from "../types";
import { assetUrl, errMsg } from "../utils";
import Inspector from "./Inspector";
import Lightbox from "./Lightbox";
import PromptsModal from "./PromptsModal";

interface Msg {
  role: "user" | "assistant";
  text: string;
  // 选款回复带上整条流水线的中间产物：搭配结果展示在对话里，
  // prompt / 输出 / 校验等「过程」点气泡弹窗看。
  trace?: RecommendResponse;
  // 非对话内容（开场白 / 报错提示）：展示照旧，但不作为上下文发给模型
  system?: boolean;
}

// 一条搭配的生图状态（前端轮询维护）
interface GenState {
  status: "pending" | "running" | "done" | "failed";
  total?: number;
  done?: number;
  current?: string;
  serial?: boolean; // 逐件换装模式才有「第 n/总 件」进度
  imageUrl?: string; // 结果图
  baseUrl?: string; // 底图（本人照片），供前后对比
  prompts?: DressStep[];
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 传给后端的对话上下文轮数上限：选款只需要最近几轮的调整意图
const HISTORY_LIMIT = 8;
// 生图轮询：2s 一次，最多约 10 分钟。没有上限的话后端异常会让前端永久轮询。
const GEN_POLL_INTERVAL = 2000;
const GEN_POLL_MAX = 300;

export default function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", text: "你好，说说今天的穿衣需求吧。", system: true },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null); // 打开推理过程的消息
  const [zoom, setZoom] = useState<string | null>(null); // 灯箱放大的图片 src
  // 落库后的 outfit id（按消息下标）：点生成时按需建，重试不重复落库
  const [savedOutfitId, setSavedOutfitId] = useState<Record<number, string>>({});
  const [gen, setGen] = useState<Record<number, GenState>>({});
  const logRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useEffect(scrollToBottom, [msgs, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    // 把最近几轮真实对话一并传给后端，支持「把刚才的裤子换成裙子」连续调整。
    // 开场白与报错提示（system）是噪声，不传；当前这条 need 不含在内。
    const history = msgs
      .filter((m) => !m.system)
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setLoading(true);
    try {
      const res = await postRecommend(text, history);
      setMsgs((m) => [...m, { role: "assistant" as const, text: replyText(res), trace: res }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `请求出错了：${errMsg(e)}`, system: true }]);
    } finally {
      setLoading(false);
    }
  }

  // 生成上身图：按需建 outfit（没存过才建）→ 提交 → 轮询到完成/失败。
  // outfit 只在生图这一刻落库——没生图的推荐不入库。
  async function generate(idx: number, m: Msg) {
    const enriched = m.trace?.enriched;
    if (!enriched) return;
    const cur = gen[idx];
    if (cur && (cur.status === "pending" || cur.status === "running")) return;
    setGen((g) => ({ ...g, [idx]: { status: "pending" } }));
    try {
      let outfitId = savedOutfitId[idx];
      if (!outfitId) {
        const outfit = await createOutfit({
          item_ids: enriched.items.map((it) => it.id),
          note: enriched.reason,
        });
        outfitId = outfit.id;
        setSavedOutfitId((s) => ({ ...s, [idx]: outfit.id }));
      }
      const created = await createGeneration(outfitId);
      let g = created;
      let polls = 0;
      while (g.status === "pending" || g.status === "running") {
        if (++polls > GEN_POLL_MAX) {
          setGen((s) => ({ ...s, [idx]: { status: "failed", error: "生成超时，请稍后重试" } }));
          return;
        }
        await sleep(GEN_POLL_INTERVAL);
        g = await getGeneration(created.id);
        setGen((s) => ({
          ...s,
          [idx]: {
            status: g.status,
            total: g.params?.total,
            done: g.params?.done,
            current: g.params?.current,
            serial: g.params?.mode === "serial",
            baseUrl: assetUrl(g.params?.base) || undefined,
          },
        }));
      }
      if (g.status === "done") {
        setGen((s) => ({
          ...s,
          [idx]: {
            status: "done",
            imageUrl: assetUrl(g.result_path),
            baseUrl: assetUrl(g.params?.base) || undefined,
            prompts: g.params?.prompts,
          },
        }));
      } else {
        setGen((s) => ({ ...s, [idx]: { status: "failed", error: g.params?.error || "生成失败" } }));
      }
    } catch (e) {
      setGen((s) => ({ ...s, [idx]: { status: "failed", error: errMsg(e) } }));
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {msgs.map((m, i) => {
          const expanded = i === expandedIdx;
          return (
            <div key={i} className="msg">
              <div
                className={
                  `bubble ${m.role}` + (m.trace ? " has-trace" : "") + (expanded ? " active" : "")
                }
                onClick={() => m.trace && setExpandedIdx(expanded ? null : i)}
              >
                {m.text}
                {m.trace && (
                  <span className="bubble-hint">
                    {expanded ? "收起推理过程 ▲" : "查看推理过程 ▼"}
                  </span>
                )}
              </div>
              {m.trace?.enriched && (
                <OutfitGrid
                  res={m.trace.enriched}
                  onZoom={setZoom}
                  gen={gen[i]}
                  onGenerate={() => generate(i, m)}
                />
              )}
            </div>
          );
        })}
        {loading && <div className="bubble assistant">正在思考…</div>}
      </div>
      {expandedIdx !== null && msgs[expandedIdx]?.trace && (
        <Inspector res={msgs[expandedIdx].trace!} onClose={() => setExpandedIdx(null)} />
      )}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
      {/* 用 form：回车（移动端键盘 enterkeyhint=send）直接发送 */}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          placeholder="例如：今天通勤，大地色系，不要裙子"
          enterKeyHint="send"
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setTimeout(scrollToBottom, 300)}
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          发送
        </button>
      </form>
    </div>
  );
}

function replyText(res: RecommendResponse): string {
  if (res.error) return `模型没接上：${res.error}`;
  if (!res.passed) return "模型给了结果，但没通过校验，点开气泡看推理过程。";
  if (res.enriched) return res.enriched.reason || "给你搭了一套：";
  return "已返回，点开气泡看推理过程。";
}

function progressText(gen: GenState): string {
  if (gen.status === "pending") return "排队中…";
  if (gen.serial && gen.total) {
    return `换装中（第 ${(gen.done ?? 0) + 1}/${gen.total} 件${gen.current ? `：${gen.current}` : ""}）`;
  }
  return "生成中…";
}

// 对话区里的最终搭配 + 「生成上身图」
function OutfitGrid({
  res,
  onZoom,
  gen,
  onGenerate,
}: {
  res: NonNullable<RecommendResponse["enriched"]>;
  onZoom: (src: string) => void;
  gen?: GenState;
  onGenerate: () => void;
}) {
  const running = gen?.status === "pending" || gen?.status === "running";
  const [showBase, setShowBase] = useState(false); // 按住「对比」看原图
  const [promptsOpen, setPromptsOpen] = useState(false);
  const shownSrc =
    gen?.status === "done" ? (showBase && gen.baseUrl ? gen.baseUrl : gen.imageUrl) : undefined;
  return (
    <div className="outfit-block">
      <div className="outfit-card">
        <div className="outfit-items">
          {res.items.map((it) => {
            const src = assetUrl(it.primary_path);
            return (
              <figure key={it.id} className="outfit-item">
                <img className="zoomable" src={src} alt={it.name || it.category} onClick={() => onZoom(src)} />
                <figcaption>{it.name || it.category}</figcaption>
              </figure>
            );
          })}
        </div>
        {gen?.status !== "done" && (
          <button className="btn-primary outfit-gen-btn" onClick={onGenerate} disabled={running}>
            {running ? "生成中…" : gen?.status === "failed" ? "重试生成" : "生成上身图"}
          </button>
        )}
      </div>
      {/* 一点「生成」就占好展位：底图做模糊背景、进度浮在中间，成图填进同一块舞台，不跳尺寸 */}
      {gen && (
        <div className="gen-block">
          {gen.status === "failed" ? (
            <div className="gen-error">生成失败：{gen.error}</div>
          ) : (
            <figure className="gen-fig">
              <div
                className={
                  "gen-stage" +
                  (gen.status === "done" ? "" : " loading") +
                  (gen.baseUrl ? " has-bg" : "")
                }
              >
                {gen.baseUrl && <img className="gen-bg" src={gen.baseUrl} alt="" aria-hidden />}
                {shownSrc ? (
                  <>
                    <img
                      className="zoomable gen-result"
                      src={shownSrc}
                      alt={showBase ? "原图" : "上身效果图"}
                      onClick={() => onZoom(shownSrc)}
                    />
                    {gen.baseUrl && (
                      <button
                        type="button"
                        className="gen-pill gen-compare-btn"
                        title="按住/悬停看原图"
                        onMouseEnter={() => setShowBase(true)}
                        onMouseLeave={() => setShowBase(false)}
                        onTouchStart={() => setShowBase(true)}
                        onTouchEnd={() => setShowBase(false)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        对比
                      </button>
                    )}
                    <div className="gen-btns-bl">
                      <button
                        type="button"
                        className="gen-pill"
                        onClick={(e) => {
                          e.stopPropagation();
                          onGenerate();
                        }}
                      >
                        重新生成
                      </button>
                      {!!gen.prompts?.length && (
                        <button
                          type="button"
                          className="gen-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPromptsOpen(true);
                          }}
                        >
                          提示词
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <span className="gen-overlay-text">{progressText(gen)}</span>
                )}
              </div>
            </figure>
          )}
        </div>
      )}
      {promptsOpen && gen?.prompts && (
        <PromptsModal prompts={gen.prompts} onClose={() => setPromptsOpen(false)} />
      )}
    </div>
  );
}
