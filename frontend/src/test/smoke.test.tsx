import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

afterEach(cleanup);

it("renders React without application features or external services", () => {
  render(<h1>Interview Mirror baseline</h1>);
  expect(screen.getByRole("heading", { name: "Interview Mirror baseline" })).toBeVisible();
});
