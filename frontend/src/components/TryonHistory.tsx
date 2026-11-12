import { useEffect, useState } from "react";
import { fetchTryonHistory } from "../api";
import type { Generation, Outfit } from "../types";
import { assetUrl, errMsg } from "../utils";
import Lightbox from "./Lightbox";
import "./TryonHistory.css";

type Entry = Generation & { outfit: Outfit };
export default function TryonHistory({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchTryonHistory().then((data) => {
      if (!cancelled) { setEntries(data.items); setMore(data.has_more); }
    }).catch((e) => { if (!cancelled) setError(errMsg(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);
  async function loadMore() {
    setBusy(true); setError("");
    try {
      const data = await fetchTryonHistory(entries.length);
      setEntries((current) => [...current, ...data.items.filter((item) => !current.some((old) => old.id === item.id))]);
      setMore(data.has_more);
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }
  const date = (value: string) => new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : value + "Z").toLocaleString("zh-CN", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return <section className="tryon-history">
    <header><button type="button" onClick={() => selected ? setSelected(null) : onBack()}>{selected ? "返回历史" : "返回我的"}</button><h1>试穿历史</h1></header>
    {selected ? <div className="tryon-history-detail">
      <button className="tryon-history-photo" onClick={() => setZoom(assetUrl(selected.result_path))} aria-label="放大试穿图"><img src={assetUrl(selected.result_path)} alt="试穿效果" /></button>
      <div><time>{date(selected.created_at)}</time>
        {selected.outfit.note && <p>{selected.outfit.note}</p>}
        <div className="tryon-history-items">{selected.outfit.items.map((item) => <figure key={item.id}>
          {item.primary_path && <img src={assetUrl(item.primary_path)} alt={item.name} />}
          <figcaption>{item.name}</figcaption>
        </figure>)}</div>
      </div>
    </div> : <>
      <div className="tryon-history-grid">{entries.map((entry) => <button key={entry.id} onClick={() => setSelected(entry)} aria-label={`查看 ${date(entry.created_at)} 的试穿图`}>
        <img src={assetUrl(entry.result_path)} alt="试穿效果" loading="lazy" />
        <time>{date(entry.created_at)}</time>
      </button>)}</div>
      {busy && <p role="status">加载中…</p>}
      {!busy && !error && entries.length === 0 && <p>还没有试穿图，完成一次试穿后会保存在这里。</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && (more || error) && <button onClick={() => void loadMore()}>{error ? "重试" : "加载更多"}</button>}
    </>}
    {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
  </section>;
}
