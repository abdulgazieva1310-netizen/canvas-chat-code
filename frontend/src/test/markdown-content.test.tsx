import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MarkdownContent } from "@/components/MarkdownContent";

afterEach(cleanup);

it("renders problem headings, lists, examples, constraints, and code as Markdown", () => {
  const { container } = render(
    <MarkdownContent>
      {
        "# Two Sum\n\n**Problem:** Find matching indices.\n\n## Input\n\nUse `nums`.\n\n```python\nnums = [2, 7]\nif nums:\n    target = 9\n```\n\n## Constraints\n\n- Two numbers\n- Distinct indices\n\n1. Read input\n2. Return indices\n\n| Input | Output |\n| --- | --- |\n| [2, 7], 9 | [0, 1] |"
      }
    </MarkdownContent>,
  );
  expect(screen.getByRole("heading", { name: "Two Sum", level: 1 })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Input", level: 2 })).toBeInTheDocument();
  expect(screen.getByText("Problem:").tagName).toBe("STRONG");
  expect(screen.getByText("nums").tagName).toBe("CODE");
  expect(container.querySelector("pre code.language-python")?.textContent).toBe(
    "nums = [2, 7]\nif nums:\n    target = 9\n",
  );
  expect(container.querySelector("pre")).toHaveAttribute("tabindex", "0");
  expect(container.querySelector("ul")).toBeInTheDocument();
  expect(container.querySelector("ol")).toBeInTheDocument();
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(container.textContent).not.toContain("**Problem**");
});

it("rejects embedded HTML and unsafe links while preserving literal code examples", () => {
  const { container } = render(
    <MarkdownContent>
      {
        '<script>alert(1)</script>\n\n<img src="https://example.com/track" onerror="alert(1)" />\n\n[unsafe](javascript:alert%281%29)\n\n![remote image](https://example.com/track)\n\n[safe](https://example.com/docs)\n\n```html\n<script>literal code</script>\n```'
      }
    </MarkdownContent>,
  );
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("unsafe").getAttribute("href")).not.toMatch(/^javascript:/);
  expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute("rel", "noopener noreferrer");
  expect(container.querySelector("pre code")?.textContent).toBe("<script>literal code</script>\n");
});
