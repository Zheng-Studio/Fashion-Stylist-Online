import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Chat from "./Chat";
import * as api from "../api";
import type { RecommendReadiness } from "../types";

vi.mock("../api", () => ({
  fetchRecommendReadiness: vi.fn(),
  postRecommend: vi.fn(),
  createOutfit: vi.fn(),
  createGeneration: vi.fn(),
  getGeneration: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

function readiness(tops: number, bottoms: number, onePieces = 0): RecommendReadiness {
  const have = tops * bottoms + onePieces;
  return {
    ready: have >= 4,
    outfits: { have, need: 4 },
    tops,
    bottoms,
    one_pieces: onePieces,
    missing: have >= 4 ? [] : ["下装 1 件"],
    item_count: tops + bottoms + onePieces,
  };
}

it("replaces the input with a wardrobe guide until the wardrobe can make 4 outfits", async () => {
  vi.mocked(api.fetchRecommendReadiness).mockResolvedValue(readiness(2, 1));
  const onAddClothes = vi.fn();
  render(<Chat active onAddClothes={onAddClothes} />);

  await screen.findByRole("heading", { name: "再添加一些单品，就能开始 AI 搭配" });
  expect(screen.getByRole("progressbar", { name: "衣橱准备进度" }).getAttribute("aria-valuenow")).toBe("50");
  // No threshold explanation or category requirements, just the bar.
  expect(screen.queryByText(/还差|套|上衣|下装/)).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText("你好，说说今天的穿衣需求吧。")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "去衣橱添加" }));
  expect(onAddClothes).toHaveBeenCalledTimes(1);
  expect(api.postRecommend).not.toHaveBeenCalled();
});

it("shows the normal chat once ready, re-checking when the tab is shown again", async () => {
  vi.mocked(api.fetchRecommendReadiness)
    .mockResolvedValueOnce(readiness(1, 2))
    .mockResolvedValueOnce(readiness(2, 2));
  const { rerender } = render(<Chat active onAddClothes={vi.fn()} />);
  await screen.findByRole("heading", { name: "再添加一些单品，就能开始 AI 搭配" });

  // User goes to the wardrobe tab, adds a top, comes back.
  rerender(<Chat active={false} onAddClothes={vi.fn()} />);
  rerender(<Chat active onAddClothes={vi.fn()} />);

  await screen.findByRole("textbox");
  expect(api.fetchRecommendReadiness).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("heading", { name: "再添加一些单品，就能开始 AI 搭配" })).toBeNull();
  expect(screen.getByText("你好，说说今天的穿衣需求吧。")).toBeTruthy();
});

it("does not block chatting if the readiness check itself fails", async () => {
  vi.mocked(api.fetchRecommendReadiness).mockRejectedValue(new Error("network"));
  render(<Chat active onAddClothes={vi.fn()} />);
  await waitFor(() => expect(api.fetchRecommendReadiness).toHaveBeenCalled());
  expect(screen.getByRole("textbox")).toBeTruthy();
});
