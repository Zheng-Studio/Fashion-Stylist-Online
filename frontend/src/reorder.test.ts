import { expect, it } from "vitest";
import { arrayMove, reorderWithin } from "./reorder";

it("arrayMove moves an element forwards and backwards", () => {
  expect(arrayMove(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  expect(arrayMove(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
});

it("reorders the whole list when nothing is filtered", () => {
  const all = ["a", "b", "c", "d"];
  expect(reorderWithin(all, all, "d", "a")).toEqual(["d", "a", "b", "c"]);
});

it("reorders only inside the visible subset and leaves hidden items in place", () => {
  // Filtered to tops: a, c, e are visible; b, d are hidden bottoms.
  const all = ["a", "b", "c", "d", "e"];
  const visible = ["a", "c", "e"];
  // Drag e to where a is: the visible slots (0, 2, 4) become e, a, c.
  expect(reorderWithin(all, visible, "e", "a")).toEqual(["e", "b", "a", "d", "c"]);
});

it("returns null when nothing changes", () => {
  expect(reorderWithin(["a", "b"], ["a", "b"], "a", "a")).toBeNull();
  expect(reorderWithin(["a", "b"], ["a"], "a", "b")).toBeNull();
});
