import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import MyProfile from "./MyProfile";
import * as api from "../api";
import type { Me } from "../types";

vi.mock("../api", () => ({
  updateMe: vi.fn(),
  uploadMyPhoto: vi.fn(),
  deleteMyPhoto: vi.fn(),
  generateImage: vi.fn(),
  resetMe: vi.fn(),
}));

const me: Me = {
  id: "u1",
  name: "Alice",
  photos: ["u/u1/photos/a.jpg"],
  gen_base: "u/u1/photos/a.jpg",
  gender: "female",
  age: 28,
  height_cm: 168,
  onboarding_completed: true,
};

beforeEach(() => vi.clearAllMocks());

it("asks for confirmation before clearing all user content", async () => {
  const onReset = vi.fn();
  const after: Me = {
    ...me, photos: [], gen_base: null, gender: "", age: null, height_cm: null, onboarding_completed: false,
  };
  vi.mocked(api.resetMe).mockResolvedValue(after);

  render(<MyProfile me={me} onUpdated={vi.fn()} onReset={onReset} />);
  fireEvent.click(screen.getByRole("button", { name: "清除全部数据" }));

  expect(api.resetMe).not.toHaveBeenCalled();
  expect(screen.getByText("清除全部数据？")).toBeTruthy();
  expect(screen.getByText(/无法恢复/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "全部清除" }));
  await waitFor(() => expect(api.resetMe).toHaveBeenCalledTimes(1));
  expect(onReset).toHaveBeenCalledWith(after);
});

it("does nothing when the confirmation is cancelled", async () => {
  const onReset = vi.fn();
  render(<MyProfile me={me} onUpdated={vi.fn()} onReset={onReset} />);

  fireEvent.click(screen.getByRole("button", { name: "清除全部数据" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));

  await waitFor(() => expect(screen.queryByText("清除全部数据？")).toBeNull());
  expect(api.resetMe).not.toHaveBeenCalled();
  expect(onReset).not.toHaveBeenCalled();
});

it("lays the profile out as label/control rows, with history and clear-data as list rows", () => {
  render(<MyProfile me={me} onUpdated={vi.fn()} onReset={vi.fn()} />);
  expect((screen.getByLabelText("名字") as HTMLInputElement).value).toBe("Alice");
  for (const label of ["名字", "年龄", "身高"]) {
    expect(screen.getByLabelText(label).closest(".mp-row")).toBeTruthy();
  }
  expect(screen.getByRole("group", { name: "性别" }).closest(".mp-row")).toBeTruthy();
  const history = screen.getByRole("button", { name: "试穿历史" });
  const clear = screen.getByRole("button", { name: "清除全部数据" });
  expect(history.parentElement).toBe(clear.parentElement);
  expect(screen.queryByRole("button", { name: "重新开始" })).toBeNull();
});

it("saves the editable gender, age and height", async () => {
  const onUpdated = vi.fn();
  const saved: Me = { ...me, gender: "male", age: 31, height_cm: 172 };
  vi.mocked(api.updateMe).mockResolvedValue(saved);
  render(<MyProfile me={me} onUpdated={onUpdated} onReset={vi.fn()} />);

  expect((screen.getByLabelText("年龄") as HTMLInputElement).value).toBe("28");
  expect((screen.getByLabelText("身高") as HTMLInputElement).value).toBe("168");
  fireEvent.change(screen.getByLabelText("年龄"), { target: { value: "31" } });
  fireEvent.change(screen.getByLabelText("身高"), { target: { value: "172" } });
  fireEvent.click(screen.getByRole("button", { name: "男" }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(() => expect(api.updateMe).toHaveBeenCalledWith({
    name: "Alice", gender: "male", age: 31, height_cm: 172,
  }));
  expect(onUpdated).toHaveBeenCalledWith(saved);
});

it("keeps a single page-level save button that only enables after a change", () => {
  render(<MyProfile me={me} onUpdated={vi.fn()} onReset={vi.fn()} />);
  const saves = screen.getAllByRole("button", { name: "保存" });
  expect(saves).toHaveLength(1);
  expect((saves[0] as HTMLButtonElement).disabled).toBe(true);
  // The save bar sits after the photos and the reset block, not inside the profile fields.
  const photo = screen.getByRole("button", { name: "放大查看照片 1" });
  expect(photo.compareDocumentPosition(saves[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.change(screen.getByLabelText("身高"), { target: { value: "170" } });
  expect((saves[0] as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText("有未保存的修改")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("身高"), { target: { value: "168" } });
  expect((saves[0] as HTMLButtonElement).disabled).toBe(true);
});

it("opens a photo in the lightbox and can set it as the generation base", async () => {
  const two: Me = { ...me, photos: ["u/u1/photos/a.jpg", "u/u1/photos/b.jpg"] };
  const onUpdated = vi.fn();
  vi.mocked(api.updateMe).mockResolvedValue({ ...two, gen_base: "u/u1/photos/b.jpg" });
  render(<MyProfile me={two} onUpdated={onUpdated} onReset={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "放大查看照片 2" }));
  expect(screen.getByRole("img", { name: "放大的照片" }).getAttribute("src")).toContain("u/u1/photos/b.jpg");
  fireEvent.click(screen.getByRole("button", { name: "设为默认试穿底图" }));
  await waitFor(() => expect(api.updateMe).toHaveBeenCalledWith({ gen_base: "u/u1/photos/b.jpg" }));
  expect(onUpdated).toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("img", { name: "放大的照片" })).toBeNull();
});

const twoPhotos: Me = { ...me, photos: ["u/u1/photos/a.jpg", "u/u1/photos/b.jpg"] };

it("keeps set-base, edit and delete inside each photo's ⋯ menu", async () => {
  vi.mocked(api.updateMe).mockResolvedValue({ ...twoPhotos, gen_base: "u/u1/photos/b.jpg" });
  render(<MyProfile me={twoPhotos} onUpdated={vi.fn()} onReset={vi.fn()} />);

  // No loose action buttons on the tiles any more.
  expect(screen.queryByRole("button", { name: /设为|编辑|删除/ })).toBeNull();
  expect(screen.getAllByRole("img", { name: "默认试穿底图" })).toHaveLength(1);

  // The current base photo has no "set as base" entry.
  fireEvent.click(screen.getByRole("button", { name: "照片 1 的更多操作" }));
  expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["编辑", "删除"]);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

  fireEvent.click(screen.getByRole("button", { name: "照片 2 的更多操作" }));
  expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["设为默认试穿底图", "编辑", "删除"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "设为默认试穿底图" }));
  expect(screen.queryByRole("menu")).toBeNull();
  await waitFor(() => expect(api.updateMe).toHaveBeenCalledWith({ gen_base: "u/u1/photos/b.jpg" }));
});

it("asks before deleting a photo from the menu", async () => {
  vi.mocked(api.deleteMyPhoto).mockResolvedValue({ ...me, photos: [] });
  render(<MyProfile me={me} onUpdated={vi.fn()} onReset={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "照片 1 的更多操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
  expect(api.deleteMyPhoto).not.toHaveBeenCalled();
  expect(screen.getByText(/此操作不可撤销/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  await waitFor(() => expect(api.deleteMyPhoto).toHaveBeenCalledWith("u/u1/photos/a.jpg"));
});

it("moves focus into the menu, navigates with arrows, and returns focus on Escape", () => {
  render(<MyProfile me={twoPhotos} onUpdated={vi.fn()} onReset={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "照片 2 的更多操作" });

  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const items = screen.getAllByRole("menuitem");
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
  expect(document.activeElement).toBe(items[1]);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
  fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
  expect(document.activeElement).toBe(items[2]); // wraps around

  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("closes the menu on an outside click without running any action", () => {
  render(<MyProfile me={twoPhotos} onUpdated={vi.fn()} onReset={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "照片 2 的更多操作" }));
  expect(screen.getByRole("menu")).toBeTruthy();

  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(api.updateMe).not.toHaveBeenCalled();
  expect(api.deleteMyPhoto).not.toHaveBeenCalled();
});

it("stays on the page after saving and switches back to unsaved when edited again", async () => {
  const saved: Me = { ...me, age: 28, height_cm: 170 };
  vi.mocked(api.updateMe).mockResolvedValue(saved);
  const { rerender } = render(<MyProfile me={me} onUpdated={vi.fn()} onReset={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("年龄"), { target: { value: "028" } });
  fireEvent.change(screen.getByLabelText("身高"), { target: { value: "170" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(api.updateMe).toHaveBeenCalled());
  rerender(<MyProfile me={saved} onUpdated={vi.fn()} onReset={vi.fn()} />);

  await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy());
  expect((screen.getByLabelText("年龄") as HTMLInputElement).value).toBe("28");
  expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(screen.getByLabelText("身高"), { target: { value: "171" } });
  expect(screen.queryByText("已保存")).toBeNull();
  expect(screen.getByText("有未保存的修改")).toBeTruthy();
});

it("caps photos at 9: shows n/9, hides the add tile and disables AI edit when full", () => {
  const nine: Me = { ...me, photos: Array.from({ length: 9 }, (_, i) => `u/u1/photos/${i}.jpg`), gen_base: "u/u1/photos/0.jpg" };
  const { container } = render(<MyProfile me={nine} onUpdated={vi.fn()} onReset={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "我的照片 · 9/9" })).toBeTruthy();
  expect(container.querySelector(".my-profile-photo-add")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "照片 2 的更多操作" }));
  const edit = screen.getByRole("menuitem", { name: "编辑" }) as HTMLButtonElement;
  expect(edit.disabled).toBe(true);
  expect(edit.title).toContain("最多 9 张");
  expect((screen.getByRole("menuitem", { name: "删除" }) as HTMLButtonElement).disabled).toBe(false);
});

it("still shows the add tile below the cap", () => {
  const { container } = render(<MyProfile me={me} onUpdated={vi.fn()} onReset={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "我的照片 · 1/9" })).toBeTruthy();
  expect(container.querySelector(".my-profile-photo-add")).toBeTruthy();
});
