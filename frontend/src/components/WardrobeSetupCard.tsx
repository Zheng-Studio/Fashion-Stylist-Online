import { Shirt } from "lucide-react";
import type { RecommendReadiness } from "../types";

// 衣橱还没达到「可以开始 AI 搭配」的标准时的引导卡：对话页和衣橱页共用。
// 刻意只给进度条和「添加单品」——不讲门槛怎么算、不点名缺哪个品类，用户只需要知道「再加一些」。
// 标准由后端 /api/recommend/readiness 判断。
export default function WardrobeSetupCard({
  readiness,
  actionLabel,
  onAction,
}: {
  readiness: RecommendReadiness;
  actionLabel: string;
  onAction?: () => void;
}) {
  const { have, need } = readiness.outfits;
  const pct = need > 0 ? Math.min(100, Math.round((have / need) * 100)) : 0;
  return (
    <section className="setup-card" aria-labelledby="setup-card-title">
      <span className="setup-card-icon" aria-hidden="true">
        <Shirt size={26} strokeWidth={1.5} />
      </span>
      <h2 id="setup-card-title">再添加一些单品，就能开始 AI 搭配</h2>
      <div
        className="setup-card-bar"
        role="progressbar"
        aria-label="衣橱准备进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      {onAction && (
        <button type="button" className="btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </section>
  );
}
