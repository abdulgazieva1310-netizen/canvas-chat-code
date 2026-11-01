import { expect, test } from "../frontend/node_modules/@playwright/test/index";
import { completeInterview, registerAccount, removeAccount } from "./helpers";

test("completed answers persist in the report and can be reopened from history", async ({ page }) => {
  const account = await registerAccount(page, "report-history");
  try {
    const interviewId = await completeInterview(page);
    await expect(page.getByText(/5 of 5 main questions · complete/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Question by question" })).toBeVisible();
    await expect(page.getByText("FIXTURE_FEEDBACK: concrete example").first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(/5 of 5 main questions · complete/)).toBeVisible();

    await page.goto("/history");
    await expect(page.getByRole("heading", { name: "Interview History" })).toBeVisible();
    const reportLink = page.getByRole("link", { name: "Open report" }).first();
    await expect(reportLink).toBeVisible();
    await reportLink.click();
    await expect(page).toHaveURL(new RegExp(`/report\\?interviewId=${interviewId}`));
    await expect(page.getByText(/5 of 5 main questions · complete/)).toBeVisible();
  } finally {
    await removeAccount(page, account);
  }
});
