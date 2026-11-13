import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PropRow from "./PropRow";

function Harness({ multiple = false, onChange }: { multiple?: boolean; onChange: (v: string[]) => void }) {
  const [value, setValue] = useState<string[]>(multiple ? ["春"] : ["内搭"]);
  return (
    <PropRow
      label={multiple ? "季节" : "品类"}
      value={value}
      options={multiple ? ["春", "夏", "秋", "冬"] : ["内搭", "外套", "下装"]}
      multiple={multiple}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

it("shows only the current value until 更改 is clicked", () => {
  render(<Harness onChange={vi.fn()} />);
  expect(screen.getByText("内搭")).toBeTruthy();
  expect(screen.queryByRole("radio")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "更改品类" }));
  expect(screen.getAllByRole("radio").map((el) => el.textContent)).toEqual(["内搭", "外套", "下装"]);
  // focus lands on the current choice so the keyboard can continue from there
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: "内搭" }));
});

it("single choice: picking one saves and collapses; picking the same one doesn't save", () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "更改品类" }));
  fireEvent.click(screen.getByRole("radio", { name: "内搭" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByRole("radio")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "更改品类" }));
  fireEvent.click(screen.getByRole("radio", { name: "外套" }));
  expect(onChange).toHaveBeenCalledWith(["外套"]);
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getByText("外套")).toBeTruthy();
});

it("multiple choice: each tap saves, keeps option order, 完成 collapses", () => {
  const onChange = vi.fn();
  render(<Harness multiple onChange={onChange} />);
  expect(screen.getByText("春")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "更改季节" }));
  fireEvent.click(screen.getByRole("button", { name: "冬" }));
  fireEvent.click(screen.getByRole("button", { name: "秋" }));
  expect(onChange).toHaveBeenLastCalledWith(["春", "秋", "冬"]);
  fireEvent.click(screen.getByRole("button", { name: "春" }));
  expect(onChange).toHaveBeenLastCalledWith(["秋", "冬"]);
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  expect(screen.getByText("秋 · 冬")).toBeTruthy();
});

it("Esc and clicking outside collapse without changing anything; Esc doesn't reach the page", () => {
  const onChange = vi.fn();
  const pageEsc = vi.fn();
  document.addEventListener("keydown", pageEsc);
  render(<Harness onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "更改品类" }));
  fireEvent.keyDown(screen.getByRole("radio", { name: "外套" }), { key: "Escape" });
  expect(screen.queryByRole("radio")).toBeNull();
  expect(pageEsc).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "更改品类" }));
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("radio")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  document.removeEventListener("keydown", pageEsc);
});
