import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Onboarding from "./Onboarding";
import * as api from "../api";

vi.mock("../api", () => ({
  prepareOnboardingPhoto: vi.fn(),
  fetchOnboardingScenes: vi.fn(),
  startOnboardingTryon: vi.fn(),
  getGeneration: vi.fn(),
  completeOnboarding: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it("uses the editable gender after photo processing to load fixed scenes", async () => {
  vi.mocked(api.prepareOnboardingPhoto).mockResolvedValue({
    id: "u1", name: "", photos: ["u/u1/photos/photo.jpg"], gen_base: "u/u1/photos/photo.jpg",
    gender: "female", onboarding_completed: false,
  });
  vi.mocked(api.fetchOnboardingScenes).mockResolvedValue([{
    id: "work", name: "利落通勤", hint: "上班 · 简约", recommended: true,
    item_ids: ["M01", "M09"], items: [
      { id: "M01", name: "衬衫", category: "内搭", image_url: "https://example.test/M01.jpg" },
      { id: "M09", name: "西装裤", category: "下装", image_url: "https://example.test/M09.jpg" },
    ],
  }]);
  const { container } = render(<Onboarding onCompleted={vi.fn()} onExit={vi.fn()} />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["photo"], "me.jpg", { type: "image/jpeg" })] } });
  expect(api.prepareOnboardingPhoto).not.toHaveBeenCalled();
  expect(screen.getByRole("img", { name: "待处理照片预览" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "处理照片" }));
  await screen.findByRole("group", { name: "性别" });
  expect(screen.getByRole("button", { name: "女" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "男" }));
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  await screen.findByRole("button", { name: /利落通勤/ });
  await waitFor(() => expect(api.fetchOnboardingScenes).toHaveBeenCalledWith("male"));
  expect(screen.getByRole("img", { name: "衬衫" }).getAttribute("src")).toBe("https://example.test/M01.jpg");
});
