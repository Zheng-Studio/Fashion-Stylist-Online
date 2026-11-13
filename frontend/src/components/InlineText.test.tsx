import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import InlineText from "./InlineText";

function Harness({ onCommit, multiline = false }: { onCommit: (v: string) => void; multiline?: boolean }) {
  const [value, setValue] = useState("白衬衫");
  return (
    <InlineText
      value={value}
      label="名称"
      placeholder="起个名字"
      maxLength={10}
      multiline={multiline}
      onCommit={(v) => {
        setValue(v);
        onCommit(v);
      }}
    />
  );
}

it("shows text until clicked, then edits in place; Enter saves once", () => {
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} />);
  expect(screen.queryByRole("textbox")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "编辑名称" }));
  const box = screen.getByRole("textbox", { name: "名称" }) as HTMLInputElement;
  expect(document.activeElement).toBe(box);
  expect(box.value).toBe("白衬衫");
  expect(box.maxLength).toBe(10);

  fireEvent.change(box, { target: { value: "  米白   衬衫 " } });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith("米白 衬衫"); // trimmed, inner spaces collapsed
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText("米白 衬衫")).toBeTruthy();
});

it("Esc cancels without saving, and doesn't let the page close", () => {
  const onCommit = vi.fn();
  const pageEsc = vi.fn();
  document.addEventListener("keydown", pageEsc);
  render(<Harness onCommit={onCommit} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑名称" }));
  const box = screen.getByRole("textbox", { name: "名称" });
  fireEvent.change(box, { target: { value: "不要了" } });
  fireEvent.keyDown(box, { key: "Escape" });
  fireEvent.blur(box);
  expect(onCommit).not.toHaveBeenCalled();
  expect(screen.getByText("白衬衫")).toBeTruthy();
  expect(pageEsc).not.toHaveBeenCalled();
  document.removeEventListener("keydown", pageEsc);
});

it("Enter that confirms an IME candidate does not save", () => {
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑名称" }));
  const box = screen.getByRole("textbox", { name: "名称" });
  fireEvent.change(box, { target: { value: "黑色" } });
  fireEvent.keyDown(box, { key: "Enter", isComposing: true });
  expect(onCommit).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "名称" })).toBeTruthy();
});

it("clicking away saves, but only if the value changed", () => {
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑名称" }));
  fireEvent.blur(screen.getByRole("textbox", { name: "名称" }));
  expect(onCommit).not.toHaveBeenCalled(); // unchanged

  fireEvent.click(screen.getByRole("button", { name: "编辑名称" }));
  const box = screen.getByRole("textbox", { name: "名称" });
  fireEvent.change(box, { target: { value: "黑衬衫" } });
  fireEvent.blur(box);
  expect(onCommit).toHaveBeenCalledWith("黑衬衫");
});

it("multiline: plain Enter is a newline, Ctrl/⌘+Enter saves", () => {
  const onCommit = vi.fn();
  render(<Harness onCommit={onCommit} multiline />);
  fireEvent.keyDown(screen.getByRole("button", { name: "编辑名称" }), { key: "Enter" });
  const box = screen.getByRole("textbox", { name: "名称" });
  expect(box.tagName).toBe("TEXTAREA");
  fireEvent.change(box, { target: { value: "第一行\n第二行" } });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
  expect(onCommit).toHaveBeenCalledWith("第一行\n第二行");
});
