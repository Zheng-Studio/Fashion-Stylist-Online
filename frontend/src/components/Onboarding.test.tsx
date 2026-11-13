import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Onboarding from "./Onboarding";
import * as api from "../api";
import type { Me } from "../types";

vi.mock("../api", () => ({
  prepareOnboardingPhoto: vi.fn(),
  fetchOnboardingScenes: vi.fn(),
  startOnboardingTryon: vi.fn(),
  getGeneration: vi.fn(),
  completeOnboarding: vi.fn(),
  updateMe: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it("uses the editable profile after photo processing to load fixed scenes", async () => {
  const prepared: Me = {
    id: "u1", name: "", photos: ["u/u1/photos/photo.jpg"], gen_base: "u/u1/photos/photo.jpg",
    gender: "female", age: 27, height_cm: 168, onboarding_completed: false,
  };
  vi.mocked(api.prepareOnboardingPhoto).mockResolvedValue(prepared);
  vi.mocked(api.updateMe).mockResolvedValue(prepared);
  vi.mocked(api.fetchOnboardingScenes).mockResolvedValue([{
    id: "work", name: "利落通勤", hint: "上班 · 简约", recommended: true,
    item_ids: ["M01", "M09"], items: [
      { id: "M01", name: "衬衫", category: "内搭", image_url: "https://example.test/M01.jpg" },
      { id: "M09", name: "西装裤", category: "下装", image_url: "https://example.test/M09.jpg" },
    ],
  }]);
  const { container } = render(<Onboarding onCompleted={vi.fn()} onExit={vi.fn()} />);
  expect(screen.getByRole("button", { name: "上传照片" })).toBeTruthy();
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["photo"], "me.jpg", { type: "image/jpeg" })] } });
  expect(screen.queryByRole("button", { name: "上传照片" })).toBeNull();
  expect(api.prepareOnboardingPhoto).not.toHaveBeenCalled();
  expect(screen.getByRole("img", { name: "上传的原图" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "处理照片" }));
  await screen.findByRole("group", { name: "性别" });

  // The upload stays on the left; the generated full-body photo sits on the right.
  expect(screen.getByRole("img", { name: "上传的原图" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "生成的全身照" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /前后对比/ })).toBeNull();

  // Clicking the generated photo opens the lightbox; close dismisses it.
  fireEvent.click(screen.getByRole("button", { name: "放大查看生成的照片" }));
  expect(screen.getAllByRole("img", { name: "生成的全身照" })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.getAllByRole("img", { name: "生成的全身照" })).toHaveLength(1);

  expect(screen.getByRole("button", { name: "女" }).getAttribute("aria-pressed")).toBe("true");
  expect((screen.getByLabelText("年龄") as HTMLInputElement).value).toBe("27");
  expect((screen.getByLabelText("身高") as HTMLInputElement).value).toBe("168");
  fireEvent.change(screen.getByLabelText("年龄"), { target: { value: "31" } });
  fireEvent.change(screen.getByLabelText("身高"), { target: { value: "172" } });
  fireEvent.click(screen.getByRole("button", { name: "男" }));
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  await screen.findByRole("button", { name: /利落通勤/ });
  expect(api.updateMe).toHaveBeenCalledWith({ gender: "male", age: 31, height_cm: 172 });
  expect(api.fetchOnboardingScenes).toHaveBeenCalledWith("male");
  expect(screen.getByRole("img", { name: "衬衫" }).getAttribute("src")).toBe("https://example.test/M01.jpg");

  // Remote example images show a loading placeholder until they load, and a hint if they fail.
  const shirt = screen.getByRole("img", { name: "衬衫" });
  const pants = screen.getByRole("img", { name: "西装裤" });
  expect(shirt.parentElement?.getAttribute("aria-busy")).toBe("true");
  expect(pants.parentElement?.className).toContain("is-loading");
  fireEvent.load(shirt);
  expect(shirt.parentElement?.getAttribute("aria-busy")).toBe("false");
  expect(shirt.parentElement?.className).toContain("is-loaded");
  fireEvent.error(pants);
  expect(pants.parentElement?.className).toContain("is-error");
  expect(screen.getByText("加载失败")).toBeTruthy();
});

it("shows the flowing waiting state while the photo is processed", async () => {
  let resolve!: (me: Me) => void;
  vi.mocked(api.prepareOnboardingPhoto).mockReturnValue(new Promise((done) => { resolve = done; }));
  const { container } = render(<Onboarding onCompleted={vi.fn()} onExit={vi.fn()} />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["photo"], "me.jpg", { type: "image/jpeg" })] } });
  fireEvent.click(screen.getByRole("button", { name: "处理照片" }));

  expect(screen.getByRole("status").textContent).toContain("正在处理照片");
  expect(screen.getByRole("button", { name: "正在处理照片…" })).toBeTruthy();

  resolve({
    id: "u1", name: "", photos: ["u/u1/photos/photo.jpg"], gen_base: "u/u1/photos/photo.jpg",
    gender: "female", age: 27, height_cm: 168, onboarding_completed: false,
  });
  await screen.findByRole("group", { name: "性别" });
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("img", { name: "生成的全身照" })).toBeTruthy();
});

it("can use the uploaded photo directly without AI processing", async () => {
  vi.mocked(api.prepareOnboardingPhoto).mockResolvedValue({
    id: "u1", name: "", photos: ["u/u1/photos/raw.jpg"], gen_base: "u/u1/photos/raw.jpg",
    gender: "male", age: 35, height_cm: null, onboarding_completed: false,
  });
  const { container } = render(<Onboarding onCompleted={vi.fn()} onExit={vi.fn()} />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["photo"], "me.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });

  fireEvent.click(screen.getByRole("button", { name: "直接使用原图" }));
  expect(screen.getByRole("status").textContent).toContain("正在读取照片");
  await screen.findByRole("group", { name: "性别" });

  expect(api.prepareOnboardingPhoto).toHaveBeenCalledWith(file, { enhance: false });
  expect(screen.getByRole("img", { name: "换装底图" })).toBeTruthy();
  expect(screen.queryByRole("img", { name: "生成的全身照" })).toBeNull();
  expect(screen.getByText("直接使用原图作为换装底图")).toBeTruthy();
  expect(screen.getByRole("button", { name: "男" }).getAttribute("aria-pressed")).toBe("true");
  expect((screen.getByLabelText("身高") as HTMLInputElement).value).toBe("");
});

it("shows how long the user has waited and what to expect, then reassures if it runs long", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(api.prepareOnboardingPhoto).mockReturnValue(new Promise(() => {}));
    const { container } = render(<Onboarding onCompleted={vi.fn()} onExit={vi.fn()} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["photo"], "me.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: "处理照片" }));

    const wait = () => container.querySelector(".onboarding-wait")!.textContent;
    expect(wait()).toBe("已等待 0 秒 · 通常需要 30 秒到 1 分钟");
    act(() => vi.advanceTimersByTime(12_000));
    expect(wait()).toBe("已等待 12 秒 · 通常需要 30 秒到 1 分钟");
    act(() => vi.advanceTimersByTime(63_000));
    expect(wait()).toBe("已等待 75 秒 · 比平时慢一些，请再稍等");
    // The ticking counter is hidden from screen readers; the status still reads the plain label.
    expect(screen.getByRole("status").textContent).toContain("正在处理照片…");
    expect(container.querySelector(".onboarding-wait")!.getAttribute("aria-hidden")).toBe("true");
  } finally {
    vi.useRealTimers();
  }
});

it("using the original photo shows a short wait hint", () => {
  vi.mocked(api.prepareOnboardingPhoto).mockReturnValue(new Promise(() => {}));
  const { container } = render(<Onboarding onCompleted={vi.fn()} onExit={vi.fn()} />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["photo"], "me.jpg", { type: "image/jpeg" })] } });
  fireEvent.click(screen.getByRole("button", { name: "直接使用原图" }));
  expect(container.querySelector(".onboarding-wait")!.textContent).toBe("已等待 0 秒 · 通常几秒钟");
});
