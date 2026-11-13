// 衣橱拖拽排序的纯逻辑（不碰 DOM / 接口，便于单测）。

/** 把 list 里 from 位置的元素挪到 to 位置，返回新数组。 */
export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * 在「可见子集」里把 activeId 拖到 overId 的位置，再合并回完整顺序。
 *
 * 按类目筛选时只能看到一部分单品：只在它们原来占的那些位置里重排，
 * 看不见的单品原地不动。不在筛选时 visibleIds 就是全部，等价于普通的 arrayMove。
 * 返回 null 表示没有变化（拖回原位、或 id 不在可见集合里）。
 */
export function reorderWithin(allIds: string[], visibleIds: string[], activeId: string, overId: string): string[] | null {
  const from = visibleIds.indexOf(activeId);
  const to = visibleIds.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  const moved = arrayMove(visibleIds, from, to);
  const visible = new Set(visibleIds);
  let k = 0;
  return allIds.map((id) => (visible.has(id) ? moved[k++] : id));
}
