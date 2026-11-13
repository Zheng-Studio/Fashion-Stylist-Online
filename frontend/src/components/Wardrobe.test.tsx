import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Wardrobe from "./Wardrobe";
import * as api from "../api";
import type { Item, TagResult } from "../types";

import type { DragEndEvent } from "@dnd-kit/core";

// 截住 Wardrobe 传给 DndContext 的 onDragEnd（见文件末尾 dropOn）
const dnd: { onDragEnd?: (e: DragEndEvent) => unknown } = {};
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      dnd.onDragEnd = props.onDragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});

vi.mock("../api", () => ({
  fetchItems: vi.fn(),
  deleteItem: vi.fn(),
  uploadImage: vi.fn(),
  autoTagImage: vi.fn(),
  createItem: vi.fn(),
  reorderItems: vi.fn(),
  batchDeleteItems: vi.fn(),
}));

// 单品页自己会调很多接口；这里只关心它有没有被打开、打开的是哪件。
vi.mock("./ItemPage", () => ({
  default: ({ item }: { item: { name: string } }) => <div role="dialog" aria-label="单品详情">{item.name}</div>,
}));

const TAGS: TagResult = { name: "白衬衫", gender: "female", category: "内搭", color: ["白"], season: ["春"], description: "" };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const file = (name: string) => new File(["x"], name, { type: "image/jpeg" });

async function renderWardrobe() {
  render(<Wardrobe />);
  await waitFor(() => expect(api.fetchItems).toHaveBeenCalled());
  return screen.getByLabelText("选择单品图片") as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchItems).mockResolvedValue([]);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  try {
    localStorage.clear();
  } catch {
    /* 存不了就算了 */
  }
});

const existing = [{ id: "i1", name: "黑裤", category: "下装", primary_path: "u/u1/items/i1.jpg", season: [], color: [] }] as unknown as Item[];

it("keeps the add cell as the first grid cell, card-sized, and it opens the file picker", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(existing);
  const input = await renderWardrobe();
  await screen.findByRole("img", { name: "黑裤" });

  const grid = document.querySelector(".wardrobe-grid")!;
  const add = screen.getByRole("button", { name: "添加单品" });
  expect(grid.firstElementChild).toBe(add);
  expect(add.className).toContain("card");

  const pick = vi.spyOn(input, "click");
  fireEvent.click(add);
  expect(pick).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.change(input, { target: { files: [] } }); // cancelled picker
  expect(screen.queryByRole("button", { name: /新单品/ })).toBeNull();
});

it("new placeholder cards go right after the add cell, so it stays leftmost", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(existing);
  vi.mocked(api.uploadImage).mockReturnValue(new Promise(() => {}));
  const input = await renderWardrobe();
  await screen.findByRole("img", { name: "黑裤" });

  fireEvent.change(input, { target: { files: [file("a.jpg")] } });
  const cells = Array.from(document.querySelector(".wardrobe-grid")!.children);
  expect(cells[0].textContent).toBe("添加单品");
  expect(cells[1].getAttribute("aria-label")).toBe("新单品：上传中…");
});

it("the list view has no add row; the toolbar button is the way to add there", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(existing);
  await renderWardrobe();
  fireEvent.click(screen.getByRole("button", { name: "列表" }));
  await screen.findByRole("img", { name: "黑裤" });
  expect(screen.queryByRole("button", { name: "添加单品" })).toBeNull();
  expect(screen.getByRole("button", { name: "+ 添加单品" })).toBeTruthy();
});

it("adds a placeholder card per photo that steps through upload, recognition and done, without opening a form", async () => {
  const upload = deferred<string>();
  const tag = deferred<TagResult>();
  const created = { id: "it1", name: "白衬衫", category: "内搭" } as Item;
  vi.mocked(api.uploadImage).mockReturnValueOnce(upload.promise).mockReturnValue(new Promise(() => {}));
  vi.mocked(api.autoTagImage).mockReturnValueOnce(tag.promise);
  vi.mocked(api.createItem).mockResolvedValue(created);
  const input = await renderWardrobe();

  fireEvent.change(input, { target: { files: [file("a.jpg"), file("b.jpg")] } });
  expect(screen.getAllByRole("button", { name: "新单品：上传中…" })).toHaveLength(2);
  expect(screen.queryByRole("dialog")).toBeNull();
  // The add cell stays in the grid so the user can keep adding.
  expect(screen.getByRole("button", { name: "添加单品" })).toBeTruthy();

  await act(async () => upload.resolve("u/u1/items/a.jpg"));
  expect(await screen.findByRole("button", { name: "新单品：智能识别中…" })).toBeTruthy();

  await act(async () => tag.resolve(TAGS));
  expect(await screen.findByRole("button", { name: "新单品：已添加" })).toBeTruthy();
  const input0 = vi.mocked(api.createItem).mock.calls[0][0];
  expect(input0.category).toBe("内搭");
  expect(input0.images).toEqual([{ id: input0.primary_image_id, kind: "upload", path: "u/u1/items/a.jpg" }]);
  // The list is reloaded so readiness and the real card update.
  expect(api.fetchItems).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("parks a card as 待补充 when recognition fails; the small sheet adds it with the photo already uploaded", async () => {
  vi.mocked(api.uploadImage).mockResolvedValue("u/u1/items/a.jpg");
  vi.mocked(api.autoTagImage).mockRejectedValue(new Error("识别失败"));
  vi.mocked(api.createItem).mockResolvedValue({ id: "new1", name: "", category: "下装", primary_path: "u/u1/items/a.jpg" } as Item);
  const input = await renderWardrobe();

  fireEvent.change(input, { target: { files: [file("a.jpg")] } });
  const card = await screen.findByRole("button", { name: "新单品：待补充，点击完善" });
  expect(api.createItem).not.toHaveBeenCalled();

  // 「稍后再说」keeps the card as it was.
  fireEvent.click(card);
  expect(screen.getByText("补充单品信息")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "稍后再说" }));
  expect(screen.queryByText("补充单品信息")).toBeNull();
  expect(screen.getByRole("button", { name: "新单品：待补充，点击完善" })).toBeTruthy();

  // Both required fields have to be picked before it can be added.
  fireEvent.click(screen.getByRole("button", { name: "新单品：待补充，点击完善" }));
  const add = screen.getByRole("button", { name: "加入衣橱" }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "下装" }));
  expect(add.disabled).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "中性" }));
  fireEvent.click(add);
  await waitFor(() => expect(api.createItem).toHaveBeenCalledTimes(1));
  const sent = vi.mocked(api.createItem).mock.calls[0][0];
  expect(sent.category).toBe("下装");
  expect(sent.gender).toBe("unisex");
  expect(sent.images[0].path).toBe("u/u1/items/a.jpg"); // reuses the upload, no second upload
  expect(api.uploadImage).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByText("补充单品信息")).toBeNull());
});

it("clicking a card that is still being recognised does nothing (no duplicate item)", async () => {
  const tag = deferred<TagResult>();
  vi.mocked(api.uploadImage).mockResolvedValue("u/u1/items/a.jpg");
  vi.mocked(api.autoTagImage).mockReturnValue(tag.promise);
  vi.mocked(api.createItem).mockResolvedValue({ id: "new1", name: "白衬衫", category: "内搭", primary_path: "u/u1/items/a.jpg" } as Item);
  const input = await renderWardrobe();

  fireEvent.change(input, { target: { files: [file("a.jpg")] } });
  fireEvent.click(await screen.findByRole("button", { name: "新单品：智能识别中…" }));
  expect(screen.queryByRole("dialog")).toBeNull();

  await act(async () => tag.resolve(TAGS));
  await waitFor(() => expect(api.createItem).toHaveBeenCalledTimes(1));
});

it("a failed upload can be retried by clicking the card", async () => {
  vi.mocked(api.uploadImage).mockRejectedValueOnce(new Error("网络错误")).mockReturnValue(new Promise(() => {}));
  const input = await renderWardrobe();

  fireEvent.change(input, { target: { files: [file("a.jpg")] } });
  const card = await screen.findByRole("button", { name: "新单品：上传失败，点击重试" });
  fireEvent.click(card);
  expect(await screen.findByRole("button", { name: "新单品：上传中…" })).toBeTruthy();
  expect(api.uploadImage).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("each item card has a ⋯ menu (open / delete) that doesn't also open the item page", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(existing);
  vi.mocked(api.deleteItem).mockResolvedValue(undefined);
  await renderWardrobe();
  await screen.findByRole("img", { name: "黑裤" });

  const trigger = screen.getByRole("button", { name: "黑裤 的更多操作" });
  expect(trigger.closest(".card")).toBeTruthy();
  fireEvent.click(trigger);
  expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["打开", "删除"]);
  expect(screen.queryByRole("dialog", { name: "单品详情" })).toBeNull();

  fireEvent.click(screen.getByRole("menuitem", { name: "打开" }));
  expect(screen.getByRole("dialog", { name: "单品详情" }).textContent).toBe("黑裤");
});

it("delete from the card menu asks first", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(existing);
  vi.mocked(api.deleteItem).mockResolvedValue(undefined);
  await renderWardrobe();
  await screen.findByRole("img", { name: "黑裤" });
  fireEvent.click(screen.getByRole("button", { name: "黑裤 的更多操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
  expect(screen.queryByRole("dialog", { name: "单品详情" })).toBeNull();
  expect(api.deleteItem).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith("i1"));
});

it("clicking the card itself opens the item page", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(existing);
  await renderWardrobe();
  fireEvent.click(await screen.findByRole("img", { name: "黑裤" }));
  expect(screen.getByRole("dialog", { name: "单品详情" })).toBeTruthy();
});

it("a card whose item is generating in the background shows a badge", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue([
    { ...existing[0], jobs: [{ id: "j1", kind: "item_normalize", status: "running", error: "", source_image_id: "x", prompt: "", created_at: "" }] },
  ] as Item[]);
  await renderWardrobe();
  expect(await screen.findByRole("img", { name: "正在生成" })).toBeTruthy();
});

const three = ["上衣A", "上衣B", "上衣C"].map((name, i) => ({
  id: `t${i}`, name, category: "内搭", primary_path: `u/u1/items/t${i}.jpg`, season: [], color: [],
})) as unknown as Item[];

it("has no sort dropdown; order comes straight from the server", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(three);
  await renderWardrobe();
  await screen.findByRole("img", { name: "上衣C" });
  expect(screen.queryByRole("combobox", { name: "排序" })).toBeNull();
  const names = screen.getAllByRole("img").map((el) => el.getAttribute("alt"));
  expect(names).toEqual(["上衣A", "上衣B", "上衣C"]);
});

it("Enter on a focused card opens its detail view", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(three);
  await renderWardrobe();
  const card = (await screen.findByRole("img", { name: "上衣B" })).closest(".sortable-item") as HTMLElement;
  fireEvent.keyDown(card, { code: "Enter", key: "Enter" });
  expect(screen.getByRole("dialog", { name: "单品详情" })).toBeTruthy();
});

// dnd-kit 的键盘/指针拖动依赖真实布局，jsdom 里测不了手势本身；这里截住 Wardrobe 交给
// DndContext 的 onDragEnd，直接模拟「把 A 拖到 B 上」，测我们自己的排序 / 保存 / 回滚逻辑。
async function dropOn(activeId: string, overId: string) {
  await act(async () => {
    await dnd.onDragEnd?.({ active: { id: activeId }, over: { id: overId } } as unknown as DragEndEvent);
  });
}

it("dropping a card on another moves it there and saves the full new order", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(three);
  vi.mocked(api.reorderItems).mockResolvedValue(undefined);
  await renderWardrobe();
  await screen.findByRole("img", { name: "上衣C" });

  await dropOn("t2", "t0");
  expect(api.reorderItems).toHaveBeenCalledWith(["t2", "t0", "t1"]);
  expect(screen.getAllByRole("img").map((el) => el.getAttribute("alt"))).toEqual(["上衣C", "上衣A", "上衣B"]);
});

it("dropping a card back on itself does nothing", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(three);
  await renderWardrobe();
  await screen.findByRole("img", { name: "上衣C" });
  await dropOn("t1", "t1");
  expect(api.reorderItems).not.toHaveBeenCalled();
});

it("rolls the order back and says so if saving the new order fails", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(three);
  vi.mocked(api.reorderItems).mockRejectedValue(new Error("保存排序失败"));
  await renderWardrobe();
  await screen.findByRole("img", { name: "上衣C" });

  await dropOn("t2", "t0");
  expect(await screen.findByText("保存排序失败")).toBeTruthy();
  expect(screen.getAllByRole("img").map((el) => el.getAttribute("alt"))).toEqual(["上衣A", "上衣B", "上衣C"]);
});

it("with a category filter on, reorders within the visible items and keeps hidden ones in place", async () => {
  const mixed = [
    { id: "a", name: "上衣A", category: "内搭" },
    { id: "p", name: "裤子P", category: "下装" },
    { id: "b", name: "上衣B", category: "内搭" },
  ].map((x) => ({ ...x, primary_path: `${x.id}.jpg`, season: [], color: [] })) as unknown as Item[];
  vi.mocked(api.fetchItems).mockResolvedValue(mixed);
  vi.mocked(api.reorderItems).mockResolvedValue(undefined);
  await renderWardrobe();
  await screen.findByRole("img", { name: "裤子P" });

  fireEvent.click(screen.getByRole("button", { name: "内搭" }));
  expect(screen.queryByRole("img", { name: "裤子P" })).toBeNull();
  await dropOn("b", "a");
  // Tops swap their two slots; the hidden trousers stay in the middle.
  expect(api.reorderItems).toHaveBeenCalledWith(["b", "p", "a"]);
});

it("the list view puts category, colour and season together in one tag row", async () => {
  const one = [{
    id: "i1", name: "黑裤", category: "下装", primary_path: "i1.jpg", season: ["秋", "冬"], color: ["黑"], description: "",
  }] as unknown as Item[];
  vi.mocked(api.fetchItems).mockResolvedValue(one);
  await renderWardrobe();
  fireEvent.click(screen.getByRole("button", { name: "列表" }));
  const row = (await screen.findByRole("img", { name: "黑裤" })).closest(".item-row") as HTMLElement;
  const tags = Array.from(row.querySelectorAll(".row-tags .tag")).map((el) => el.textContent);
  expect(tags).toEqual(["下装", "黑", "秋", "冬"]);
  expect(row.querySelector(".row-color")).toBeNull();
});

const checks = () => screen.getAllByRole("checkbox").map((el) => el.getAttribute("aria-checked"));

it("select mode: tap to check, select all, invert, clear, and Esc / × to exit", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(three);
  await renderWardrobe();
  await screen.findByRole("img", { name: "上衣A" });

  fireEvent.click(screen.getByRole("button", { name: "选择" }));
  expect(screen.getByRole("toolbar", { name: "多选操作" })).toBeTruthy();
  // In select mode: no add cell, no ⋯ menus, tapping a card checks it instead of opening detail.
  expect(screen.queryByRole("button", { name: "添加单品" })).toBeNull();
  expect(screen.queryByRole("button", { name: /的更多操作/ })).toBeNull();
  expect((screen.getByRole("button", { name: "删除" }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(screen.getByRole("checkbox", { name: "上衣B" }));
  expect(checks()).toEqual(["false", "true", "false"]);
  expect(screen.queryByRole("dialog", { name: "单品详情" })).toBeNull();
  expect(screen.getByText("已选", { exact: false }).textContent).toContain("1");

  fireEvent.click(screen.getByRole("button", { name: "反选" }));
  expect(checks()).toEqual(["true", "false", "true"]);
  fireEvent.click(screen.getByRole("button", { name: "全选" }));
  expect(checks()).toEqual(["true", "true", "true"]);
  expect((screen.getByRole("button", { name: "全选" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "取消选择" }));
  expect(checks()).toEqual(["false", "false", "false"]);

  // Keyboard: space toggles a focused card.
  fireEvent.keyDown(screen.getByRole("checkbox", { name: "上衣C" }), { key: " " });
  expect(checks()).toEqual(["false", "false", "true"]);

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("toolbar", { name: "多选操作" })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();

  // Re-entering starts with nothing selected; × also exits.
  fireEvent.click(screen.getByRole("button", { name: "选择" }));
  expect(checks()).toEqual(["false", "false", "false"]);
  fireEvent.click(screen.getByRole("button", { name: "退出多选" }));
  expect(screen.getByRole("button", { name: "添加单品" })).toBeTruthy();
});

it("batch delete asks first, deletes the checked items in one call, then leaves select mode", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(three);
  vi.mocked(api.batchDeleteItems).mockResolvedValue(undefined);
  await renderWardrobe();
  await screen.findByRole("img", { name: "上衣A" });

  fireEvent.click(screen.getByRole("button", { name: "选择" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "上衣A" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "上衣C" }));
  fireEvent.click(screen.getByRole("button", { name: "删除 2 件" }));

  expect(await screen.findByText("删除 2 件单品？")).toBeTruthy();
  expect(api.batchDeleteItems).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  await waitFor(() => expect(api.batchDeleteItems).toHaveBeenCalledWith(["t0", "t2"]));
  await waitFor(() => expect(screen.queryByRole("toolbar", { name: "多选操作" })).toBeNull());
  expect(api.fetchItems).toHaveBeenCalledTimes(2);
});

it("stays in select mode and shows the error if batch delete fails", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(three);
  vi.mocked(api.batchDeleteItems).mockRejectedValue(new Error("有单品不存在，请刷新后重试"));
  await renderWardrobe();
  await screen.findByRole("img", { name: "上衣A" });

  fireEvent.click(screen.getByRole("button", { name: "选择" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "上衣A" }));
  fireEvent.click(screen.getByRole("button", { name: "删除 1 件" }));
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  expect(await screen.findByText("有单品不存在，请刷新后重试")).toBeTruthy();
  expect(screen.getByRole("toolbar", { name: "多选操作" })).toBeTruthy();
  expect(checks()).toEqual(["true", "false", "false"]);
});

it("select all and delete only cover the items visible under the current filter", async () => {
  const mixed = [
    { id: "a", name: "上衣A", category: "内搭" },
    { id: "p", name: "裤子P", category: "下装" },
    { id: "b", name: "上衣B", category: "内搭" },
  ].map((x) => ({ ...x, primary_path: `${x.id}.jpg`, season: [], color: [] })) as unknown as Item[];
  vi.mocked(api.fetchItems).mockResolvedValue(mixed);
  vi.mocked(api.batchDeleteItems).mockResolvedValue(undefined);
  await renderWardrobe();
  await screen.findByRole("img", { name: "裤子P" });

  fireEvent.click(screen.getByRole("button", { name: "选择" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "裤子P" })); // checked while visible…
  fireEvent.click(screen.getByRole("button", { name: "内搭" })); // …then hidden by the filter
  fireEvent.click(screen.getByRole("button", { name: "全选" }));
  fireEvent.click(screen.getByRole("button", { name: "删除 2 件" }));
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  await waitFor(() => expect(api.batchDeleteItems).toHaveBeenCalledWith(["a", "b"]));
});

it("list view supports select mode too", async () => {
  vi.mocked(api.fetchItems).mockResolvedValue(three);
  await renderWardrobe();
  fireEvent.click(screen.getByRole("button", { name: "列表" }));
  await screen.findByRole("img", { name: "上衣A" });
  fireEvent.click(screen.getByRole("button", { name: "选择" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "上衣B" }));
  expect(checks()).toEqual(["false", "true", "false"]);
  expect(screen.getByRole("checkbox", { name: "上衣B" }).className).toContain("item-row");
});
