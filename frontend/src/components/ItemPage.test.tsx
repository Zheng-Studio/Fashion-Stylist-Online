import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ItemPage from "./ItemPage";
import * as api from "../api";
import type { Item, ItemJob } from "../types";

vi.mock("../api", () => ({
  fetchItem: vi.fn(),
  patchItem: vi.fn(),
  addItemImage: vi.fn(),
  rotateItemImage: vi.fn(),
  setItemPrimary: vi.fn(),
  deleteItemImage: vi.fn(),
  startItemJob: vi.fn(),
  dismissItemJob: vi.fn(),
  deleteItem: vi.fn(),
  autoTagImage: vi.fn(),
}));

const base: Item = {
  id: "i1",
  name: "白衬衫",
  gender: "female",
  category: "内搭",
  color: ["白"],
  season: ["春"],
  description: "棉质",
  images: [
    { id: "a", kind: "upload", path: "u/u1/items/a.jpg" },
    { id: "b", kind: "upload", path: "u/u1/items/b.jpg" },
  ],
  primary_image_id: "a",
  primary_path: "u/u1/items/a.jpg",
  created_at: "",
  jobs: [],
};
const job = (over: Partial<ItemJob> = {}): ItemJob => ({
  id: "j1", kind: "item_normalize", status: "pending", error: "", source_image_id: "a", prompt: "", created_at: "", ...over,
});

// 真实使用时 Wardrobe 会把 onChange 的结果再传回来：这里也这么做
function Harness({ initial = base, onDeleted = vi.fn(), onClose = vi.fn() }: { initial?: Item; onDeleted?: (id: string) => void; onClose?: () => void }) {
  const [item, setItem] = useState(initial);
  return <ItemPage item={item} onChange={setItem} onDeleted={onDeleted} onClose={onClose} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

it("is a single page: no edit mode, no save/cancel, and values are shown as text, not option lists", () => {
  render(<Harness />);
  expect(screen.getByRole("dialog", { name: "单品详情" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^(保存|取消|编辑)$/ })).toBeNull();
  expect(screen.queryByText("改动会自动保存")).toBeNull();
  expect(screen.queryByRole("radio")).toBeNull(); // no full option lists until 更改
  for (const label of ["品类", "性别", "季节", "描述"]) {
    expect(screen.getByRole("button", { name: `更改${label}` })).toBeTruthy();
  }
  expect(screen.getByText("内搭")).toBeTruthy();
  expect(screen.getByText("女")).toBeTruthy();
  expect(screen.getByText("棉质")).toBeTruthy();
});

it("picking a category saves right away and shows 已保存", async () => {
  vi.mocked(api.patchItem).mockResolvedValue({ ...base, category: "外套" });
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "更改品类" }));
  fireEvent.click(screen.getByRole("radio", { name: "外套" }));
  // optimistic: shown before the server answers
  expect(screen.getByText("外套")).toBeTruthy();
  expect(api.patchItem).toHaveBeenCalledWith("i1", { category: "外套" });
  expect(await screen.findByText("已保存")).toBeTruthy();
});

it("a failed save rolls the field back and says why", async () => {
  vi.mocked(api.patchItem).mockRejectedValue(new Error("网络断了"));
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "更改季节" }));
  fireEvent.click(screen.getByRole("button", { name: "夏" }));
  expect(await screen.findByText("网络断了")).toBeTruthy();
  expect(screen.getByRole("button", { name: "夏" }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("button", { name: "春" }).getAttribute("aria-pressed")).toBe("true");
});

it("name is edited inline and saved on Enter", async () => {
  vi.mocked(api.patchItem).mockResolvedValue({ ...base, name: "米白衬衫" });
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "编辑名称" }));
  const box = screen.getByRole("textbox", { name: "名称" });
  fireEvent.change(box, { target: { value: "米白衬衫" } });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(api.patchItem).toHaveBeenCalledWith("i1", { name: "米白衬衫" });
  expect(await screen.findByText("已保存")).toBeTruthy();
  expect(screen.getByText("米白衬衫")).toBeTruthy();
});

it("colours: remove with ×, add inline; Esc while adding adds nothing", async () => {
  vi.mocked(api.patchItem).mockImplementation(async (_id, p) => ({ ...base, ...p }));
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  const input = screen.getByRole("textbox", { name: "添加颜色" });
  fireEvent.change(input, { target: { value: "蓝" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(api.patchItem).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  const again = screen.getByRole("textbox", { name: "添加颜色" });
  fireEvent.change(again, { target: { value: "米" } });
  fireEvent.keyDown(again, { key: "Enter" });
  expect(api.patchItem).toHaveBeenLastCalledWith("i1", { color: ["白", "米"] });
  await screen.findByText("已保存");

  fireEvent.click(screen.getByRole("button", { name: "去掉颜色 白" }));
  expect(api.patchItem).toHaveBeenLastCalledWith("i1", { color: ["米"] });
});

it("AI 重新识别 updates the changed fields at once and can be undone", async () => {
  vi.mocked(api.autoTagImage).mockResolvedValue({
    name: "黑色阔腿裤", gender: "female", category: "下装", color: ["黑"], season: ["春"], description: "棉质",
  });
  vi.mocked(api.patchItem).mockImplementation(async (_id, p) => ({ ...base, ...p }));
  globalThis.fetch = vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(["x"], { type: "image/jpeg" })) }) as never;
  render(<Harness />);

  // Asks first; cancelling does nothing.
  fireEvent.click(screen.getByRole("button", { name: "重新识别" }));
  expect(await screen.findByText("重新识别这件单品？")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(api.autoTagImage).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "重新识别" }));
  await screen.findByText("重新识别这件单品？");
  // The dialog's confirm button is the last 「重新识别」 on screen (the first one is the title-row button).
  const confirmBtns = screen.getAllByRole("button", { name: "重新识别" });
  fireEvent.click(confirmBtns[confirmBtns.length - 1]);
  expect(await screen.findByText("已按这张图更新 3 项信息")).toBeTruthy();
  expect(api.patchItem).toHaveBeenCalledWith("i1", { name: "黑色阔腿裤", category: "下装", color: ["黑"] });

  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  await waitFor(() => expect(api.patchItem).toHaveBeenLastCalledWith("i1", { name: "白衬衫", category: "内搭", color: ["白"] }));
});

it("rotate is immediate: the main image is replaced by the server's new one", async () => {
  vi.mocked(api.rotateItemImage).mockResolvedValue({
    ...base,
    images: [{ id: "a", kind: "upload", path: "u/u1/items/a-rot.jpg" }, base.images[1]],
    primary_path: "u/u1/items/a-rot.jpg",
  });
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "向左旋转 90°" }));
  expect(api.rotateItemImage).toHaveBeenCalledWith("i1", "a", "ccw");
  await waitFor(() => expect(screen.getByRole("img", { name: "主图预览" }).getAttribute("src")).toContain("a-rot.jpg"));
});

it("set as primary from the main image, delete an image after confirming", async () => {
  vi.mocked(api.setItemPrimary).mockResolvedValue({ ...base, primary_image_id: "b", primary_path: "u/u1/items/b.jpg" });
  vi.mocked(api.deleteItemImage).mockResolvedValue({ ...base, images: [base.images[1]], primary_image_id: "b" });
  render(<Harness />);

  fireEvent.click(screen.getByRole("img", { name: "图片 2" }));
  fireEvent.click(screen.getByRole("button", { name: "设为主图" }));
  await waitFor(() => expect(api.setItemPrimary).toHaveBeenCalledWith("i1", "b"));
  await waitFor(() => expect(screen.queryByRole("button", { name: "设为主图" })).toBeNull());

  fireEvent.click(screen.getByRole("button", { name: "图片 1 的更多操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
  expect(api.deleteItemImage).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  await waitFor(() => expect(api.deleteItemImage).toHaveBeenCalledWith("i1", "a"));
});

it("generating runs in the background: the stage switches to it, then to the new image when done", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const running = { ...base, jobs: [job({ status: "running" })] };
  vi.mocked(api.startItemJob).mockResolvedValue({ job_id: "j1", item: running });
  const done: Item = {
    ...base,
    images: [...base.images, { id: "j1", kind: "normalized", path: "u/u1/items/std.jpg", source_id: "a" }],
    jobs: [],
  };
  vi.mocked(api.fetchItem).mockResolvedValue(done);
  render(<Harness />);

  fireEvent.click(screen.getByRole("button", { name: "生成标准照" }));
  expect(await screen.findByText("正在生成标准照…")).toBeTruthy();
  expect(screen.getByText(/可以先关掉这页/)).toBeTruthy();
  expect(screen.getByText(/已开始生成标准照/)).toBeTruthy();
  expect(api.startItemJob).toHaveBeenCalledWith("i1", { kind: "item_normalize", source_image_id: "a", prompt: undefined });

  await act(async () => {
    vi.advanceTimersByTime(2600);
  });
  await waitFor(() => expect(screen.getByRole("img", { name: "主图预览" }).getAttribute("src")).toContain("std.jpg"));
  vi.useRealTimers();
});

it("a failed job is shown on the stage with retry / dismiss", async () => {
  const failed = { ...base, jobs: [job({ status: "failed", error: "生图超时" })] };
  vi.mocked(api.dismissItemJob).mockResolvedValue(base);
  render(<Harness initial={failed} />);
  fireEvent.click(screen.getByRole("button", { name: "标准照生成失败" }));
  expect(screen.getByText("生图超时")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
  await waitFor(() => expect(api.dismissItemJob).toHaveBeenCalledWith("i1", "j1"));
  await waitFor(() => expect(screen.getByRole("img", { name: "主图预览" })).toBeTruthy());
});

it("custom edit asks for an instruction, then starts a background job for that image", async () => {
  vi.mocked(api.startItemJob).mockResolvedValue({ job_id: "j2", item: { ...base, jobs: [job({ id: "j2", kind: "item_edit" })] } });
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "图片 2 的更多操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "自定义编辑" }));
  const start = screen.getByRole("button", { name: "开始生成" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("想怎么改这张图"), { target: { value: "去掉衣架" } });
  fireEvent.click(start);
  await waitFor(() =>
    expect(api.startItemJob).toHaveBeenCalledWith("i1", { kind: "item_edit", source_image_id: "b", prompt: "去掉衣架" }),
  );
  expect(await screen.findByText("正在生成自定义编辑…")).toBeTruthy();
});

it("deleting the item from the ⋯ menu asks first", async () => {
  vi.mocked(api.deleteItem).mockResolvedValue(undefined);
  const onDeleted = vi.fn();
  render(<Harness onDeleted={onDeleted} />);
  fireEvent.click(screen.getByRole("button", { name: "单品的更多操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "删除单品" }));
  expect(api.deleteItem).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("i1"));
});

it("Esc closes the page, but not while editing a field", () => {
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑名称" }));
  fireEvent.keyDown(screen.getByRole("textbox", { name: "名称" }), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("the selection frame follows the selected thumbnail; the primary one only has a 主图 badge", () => {
  render(<Harness />);
  const thumbs = () => Array.from(document.querySelectorAll(".gstrip .gthumb:not(.gadd)"));
  expect(thumbs()[0].className).toContain("sel");
  expect(thumbs()[1].className).not.toContain("sel");
  expect(document.querySelector(".gthumb.primary")).toBeNull();
  expect(screen.getByRole("img", { name: "主图" }).textContent).toBe("主图");

  fireEvent.click(screen.getByRole("img", { name: "图片 2" }));
  expect(thumbs()[0].className).not.toContain("sel");
  expect(thumbs()[1].className).toContain("sel");
  expect(thumbs()[1].getAttribute("aria-current")).toBe("true");
});

it("at most five images: with 4 images + 1 generating, add / generate are off", () => {
  const five = {
    ...base,
    images: [
      ...base.images,
      { id: "c", kind: "upload" as const, path: "u/u1/items/c.jpg" },
      { id: "d", kind: "upload" as const, path: "u/u1/items/d.jpg" },
    ],
    jobs: [job({ status: "running" })],
  };
  render(<Harness initial={five} />);
  expect(screen.queryByLabelText("添加图片")).toBeNull();
  const std = screen.getByRole("button", { name: "生成标准照" }) as HTMLButtonElement;
  expect(std.disabled).toBe(true);
  expect(std.title).toContain("最多 5 张");
  fireEvent.click(screen.getByRole("button", { name: "图片 2 的更多操作" }));
  expect((screen.getByRole("menuitem", { name: "自定义编辑" }) as HTMLButtonElement).disabled).toBe(true);
});

it("description is shown as text with 更改; editing happens in place", async () => {
  vi.mocked(api.patchItem).mockResolvedValue({ ...base, description: "亚麻" });
  render(<Harness />);
  expect(screen.queryByRole("textbox", { name: "描述" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "更改描述" }));
  const box = screen.getByRole("textbox", { name: "描述" });
  fireEvent.change(box, { target: { value: "亚麻" } });
  fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
  expect(api.patchItem).toHaveBeenCalledWith("i1", { description: "亚麻" });
  expect(await screen.findByText("已保存")).toBeTruthy();
});
