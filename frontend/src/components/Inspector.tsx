import type { RecommendResponse } from "../types";
import Modal from "./Modal";

function prettyJson(raw: string | null): string {
  if (!raw) return "(空)";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw; // 解析不了就原样展示，校验段会标出问题
  }
}

// 推理过程：弹出 popover（Portal 到 body，点背景 / Esc / ✕ 关闭），
// 扁平纯文本分段展示「过程」（不含最终搭配）。
export default function Inspector({
  res,
  onClose,
}: {
  res: RecommendResponse;
  onClose: () => void;
}) {
  return (
    <Modal
      className="inspector-modal"
      bodyClassName="inspector-body"
      title="推理过程"
      onClose={onClose}
      closeOnEscape
    >
      <section className="sec">
        <h4 className="sec-h">① 给 LLM 的 Prompt</h4>
        <div className="sec-label">system</div>
        <pre className="sec-pre">{res.prompt.system}</pre>
        <div className="sec-label">user</div>
        <pre className="sec-pre">{res.prompt.user}</pre>
        <div className="sec-meta">模型：{res.model}</div>
        {res.prefiltered && res.prefiltered.excluded_categories.length > 0 && (
          <div className="sec-meta">
            候选预过滤：按硬负约束剔除了「{res.prefiltered.excluded_categories.join("、")}」
          </div>
        )}
        {res.prefiltered?.season && res.prefiltered.season.excluded_count > 0 && (
          <div className="sec-meta">
            候选已按季节「{res.prefiltered.season.target.join("/")}」过滤（依据：
            {res.prefiltered.season.source === "date" ? "当前月份" : "你的描述"}），剔除{" "}
            {res.prefiltered.season.excluded_count} 件
          </div>
        )}
      </section>

      <section className="sec">
        <h4 className="sec-h">② LLM 结构化输出</h4>
        {res.error ? (
          <div className="sec-err">{res.error}</div>
        ) : (
          <pre className="sec-pre">{prettyJson(res.raw_output)}</pre>
        )}
      </section>

      {res.validation && (
        <section className="sec">
          <h4 className="sec-h">③ 校验过程{res.retried ? "（含 1 次失败重试）" : ""}</h4>
          {res.validation.map((c, i) => (
            <div key={i} className={c.ok ? "check ok" : "check bad"}>
              {c.ok ? "✓" : "✗"} {c.name} —— {c.detail}
            </div>
          ))}
        </section>
      )}
    </Modal>
  );
}
