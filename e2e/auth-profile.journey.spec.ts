import { expect, test } from "../frontend/node_modules/@playwright/test/index";
import { password, registerAccount, removeAccount } from "./helpers";

test("registration, login, and profile changes persist across reloads", async ({ page }) => {
  const account = await registerAccount(page, "profile");
  try {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Logout", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const loginPromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/login",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const login = await loginPromise;
    expect(login.status()).toBe(200);
    expect(login.headers()["authorization"]).toMatch(/^Bearer\s+\S+/);
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Updated Journey Candidate");
    await page
      .getByRole("combobox", { name: "Target role", exact: true })
      .selectOption("Python Developer");
    await page.getByRole("combobox", { name: "Level", exact: true }).selectOption("Senior");
    await page.getByLabel("Preferred language", { exact: true }).fill("Russian");
    const updatePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/me" &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    expect((await updatePromise).status()).toBe(200);
    await expect(page.getByText("Profile saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Updated Journey Candidate",
    );
    await expect(
      page.getByRole("combobox", { name: "Target role", exact: true }),
    ).toHaveValue("Python Developer");
    await expect(page.getByRole("combobox", { name: "Level", exact: true })).toHaveValue("Senior");
    await expect(page.getByLabel("Preferred language", { exact: true })).toHaveValue("Russian");
  } finally {
    await removeAccount(account);
  }
});
