import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("exportação desktop usa conta autorizada e baixa catálogo somente ao clicar", async ({ page }) => {
  const exports = [];
  const errors = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/editor/database/export") exports.push(request.method()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/desktop-export");
  await expect(page.getByText("Conta conectada", { exact: true })).toBeVisible();
  await expect(page.getByText("owner@example.com", { exact: true })).toBeVisible();
  expect(exports).toEqual([]);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar minha base (.json)", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("bola-manager-base.json");
  const content = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(content.format).toBe("bola-manager-database");
  expect(content.version).toBe(1);
  expect(content.records.players).toHaveLength(64);
  expect(content.records.clubs).toHaveLength(4);
  expect(content.records.leagues).toHaveLength(1);
  expect(JSON.stringify(content)).not.toContain("owner-token");
  expect(exports).toEqual(["GET"]);
  expect(errors).toEqual([]);
});

test("exportação desktop recusa autorização sem baixar nem expor a mensagem interna", async ({ page }) => {
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  await page.route("**/api/editor/database/export", (route) => route.fulfill({ status: 403, contentType: "application/json",
    body: JSON.stringify({ error: { code: "FORBIDDEN", message: "SECRET_SHOULD_NOT_RENDER" } }) }));
  await page.goto("/desktop-export");
  await page.getByRole("button", { name: "Baixar minha base (.json)", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Sua conta não pôde autorizar a exportação");
  await expect(page.getByRole("main")).not.toContainText("SECRET_SHOULD_NOT_RENDER");
  expect(downloads).toBe(0);
});
