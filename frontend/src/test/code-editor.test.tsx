import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({ createClientOnlyFn: (fn: () => unknown) => fn }));
vi.mock("@/components/MonacoEditor.client", () => {
  throw new Error("Monaco chunk unavailable");
});

import CodeEditor from "@/components/CodeEditor";

it("keeps an editable code textarea when the Monaco chunk fails to load", async () => {
  const onChange = vi.fn();
  render(
    <CodeEditor
      language="python"
      path="fallback.py"
      value={"def solve():\n    return 1"}
      readOnly={false}
      onChange={onChange}
    />,
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Editor unavailable. You can still enter and submit code below.",
  );
  const fallback = screen.getByRole("textbox", { name: "Code answer" });
  expect(fallback).toHaveValue("def solve():\n    return 1");
  expect(fallback).toBeEnabled();
  fireEvent.change(fallback, { target: { value: "updated code" } });
  expect(onChange).toHaveBeenCalledWith("updated code");
});
