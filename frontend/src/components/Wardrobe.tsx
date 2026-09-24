import { useCallback, useEffect, useState } from "react";
import { deleteItem, fetchItems } from "../api";
import { CATEGORIES } from "../constants";
import { assetUrl, errMsg } from "../utils";
import type { Item } from "../types";
import ItemForm from "./ItemForm";
import ItemDetail from "./ItemDetail";
import { useConfirm } from "./useConfirm";

type ViewMode = "card" | "list";
type SortMode = "new" | "old";

const VIEW_KEY = "fs.wardrobeView";
const SORT_KEY = "fs.wardrobeSort";

const SORT_LABELS: [SortMode, string][] = [
  ["new", "创建时间 新→旧"],
  ["old", "创建时间 旧→新"],
];

function sortItems(items: Item[], mode: SortMode): Item[] {
  const byTime = (a: Item, b: Item) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id.localeCompare(a.id);
  const sorted = [...items];
  sorted.sort(mode === "new" ? byTime : (a, b) => byTime(b, a));
  return sorted;
}

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 存不了就算了 */
  }
}

// 衣橱：只有当前用户自己的单品
export default function Wardrobe() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [items, setItems] = useState<Item[]>([]);
  // 两种错误分开：loadErr = 列表拉不到（整页兜底）；opErr = 单次操作失败（只在工具条下提示）
  const [loadErr, setLoadErr] = useState("");
  const [opErr, setOpErr] = useState("");
  const imgSrc = (it: Item) => assetUrl(it.primary_path);
  // null = 不开表单；undefined = 新建；具体 item = 编辑
  const [editing, setEditing] = useState<Item | undefined | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const [catSel, setCatSel] = useState<string[]>([]); // 空 = 全部
  const [view, setView] = useState<ViewMode>(() => readPref(VIEW_KEY, "card"));
  const [sort, setSort] = useState<SortMode>(() => readPref(SORT_KEY, "new"));

  useEffect(() => writePref(VIEW_KEY, view), [view]);
  useEffect(() => writePref(SORT_KEY, sort), [sort]);

  const load = useCallback(() => {
    fetchItems()
      .then((list) => {
        setItems(list);
        setLoadErr("");
      })
      .catch((e) => setLoadErr(errMsg(e, "加载单品失败")));
  }, []);
  useEffect(() => load(), [load]);

  async function onDelete(it: Item) {
    const ok = await confirm({
      title: "删除单品",
      message: `确定删除「${it.name || it.category}」？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    setOpErr("");
    try {
      await deleteItem(it.id);
      setDetail(null);
      load();
    } catch (e) {
      setOpErr(errMsg(e, "删除单品失败")); // 只提示，不拆页面
    }
  }

  // 整页兜底只在「一件都没有」时给：已经拉到过列表就别把它换掉
  if (loadErr && items.length === 0) return <div className="error">{loadErr}</div>;

  const shown = sortItems(
    catSel.length > 0 ? items.filter((it) => catSel.includes(it.category)) : items,
    sort,
  );

  return (
    <div>
      <div className="wardrobe-head">
        <div className="filters">
          <span className="count">共 {shown.length} 件</span>
        </div>

        <div className="view-tools">
          <select
            className="sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            aria-label="排序"
          >
            {SORT_LABELS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <div className="view-toggle">
            {(
              [
                ["card", "卡片"],
                ["list", "列表"],
              ] as [ViewMode, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={"filter-btn" + (view === key ? " active" : "")}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={() => setEditing(undefined)}>
            + 添加单品
          </button>
        </div>
      </div>

      {/* 类目筛选：多选胶囊，「全部」= 清空选择；手机放不下时本行横向滚动 */}
      <div className="cat-filter" role="group" aria-label="按类目筛选">
        <button
          type="button"
          className={"chip" + (catSel.length === 0 ? " on" : "")}
          aria-pressed={catSel.length === 0}
          onClick={() => setCatSel([])}
        >
          全部
        </button>
        {CATEGORIES.map((c) => {
          const on = catSel.includes(c);
          return (
            <button
              key={c}
              type="button"
              className={"chip" + (on ? " on" : "")}
              aria-pressed={on}
              onClick={() => setCatSel(on ? catSel.filter((x) => x !== c) : [...catSel, c])}
            >
              {c}
            </button>
          );
        })}
      </div>

      {(opErr || loadErr) && <div className="form-err">{opErr || loadErr}</div>}

      {view === "card" ? (
        <div className="grid wardrobe-grid">
          {shown.map((it) => (
            <div key={it.id} className="card" onClick={() => setDetail(it)} role="button" tabIndex={0}>
              <div className="card-img">
                <img src={imgSrc(it)} alt={it.name || it.category} loading="lazy" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="item-rows">
          {shown.map((it) => (
            <div key={it.id} className="item-row" onClick={() => setDetail(it)} role="button" tabIndex={0}>
              <div className="row-img">
                <img src={imgSrc(it)} alt={it.name || it.category} loading="lazy" />
              </div>
              <div className="row-main">
                <div className="row-title">{it.name || it.category}</div>
                <div className="row-desc">{it.description}</div>
                <div className="tags row-tags">
                  {it.season.map((s) => (
                    <span key={s} className="tag">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="row-color">{it.color.join(" / ") || "—"}</div>
            </div>
          ))}
        </div>
      )}

      {editing !== null && (
        <ItemForm
          item={editing ?? undefined}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {confirmDialog}

      {detail && (
        <ItemDetail
          item={detail}
          imgSrc={imgSrc(detail)}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
          }}
          onDelete={() => onDelete(detail)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
