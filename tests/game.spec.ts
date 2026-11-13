import { expect, test, type Page } from "@playwright/test";

async function startMatch(page: Page, seconds = 22) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto(`/?round=${seconds}`);
  await expect(page.locator("#start")).toBeEnabled();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250));
  await page.locator("#start").click({ force: true });
  await expect(page.locator("#overlay")).toBeHidden();
  return errors;
}

test("desktop plays the production build through attack, capture, result and rematch", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 412 });
  const errors = await startMatch(page);
  const canvas = page.locator("#game canvas");
  await expect(canvas).toHaveCount(1);
  const battlefield = (await canvas.boundingBox())!;
  await page.keyboard.down("w");
  await page.mouse.move(battlefield.x + battlefield.width * 0.5, battlefield.y + battlefield.height * 0.3);
  await page.mouse.down();
  await page.clock.runFor(1000);
  await expect(page.locator("#deploy-state")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#attack-state")).toHaveText(/攻撃命中|攻撃クールダウン/);
  await page.keyboard.up("w");
  await page.keyboard.press("e");
  await page.clock.runFor(150);
  await expect(page.locator("#sites .site").nth(1)).toContainText("青 起動");
  await page.clock.runFor(12_500);
  await expect(page.locator("#sites .site").nth(1)).toHaveAttribute("data-owner", "blue");
  await page.mouse.up();
  for (let i = 0; i < 12 && await page.locator("#clock").textContent() !== "00:00"; i++) {
    await page.clock.runFor(1000);
  }
  await expect(page.locator("#clock")).toHaveText("00:00");
  await expect(page.locator("#headline")).toHaveText(/チームの勝利|引き分け/);
  await expect(page.locator("#start")).toHaveText("再試合");

  await page.locator("#start").click({ force: true });
  await expect(page.locator("#overlay")).toBeHidden();
  await page.clock.runFor(100);
  await expect(page.locator("#clock")).toHaveText("00:22");
  await expect(page.locator("#blue-score")).toHaveText("0");
  await expect(page.locator("#map-labels .map-label")).toHaveCount(5);
  await expect(page.locator(".fog")).toHaveCount(1);
  await expect(page.locator(".minimap")).toHaveCount(1);
  await expect(page.locator(".roster-unit")).toHaveCount(10);
  await expect(canvas).toHaveCount(1);
  expect(errors).toEqual([]);
});

test.describe("small touch screen", () => {
  test.use({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });

  test("moves and aims with two fingers, switches modes, and persists controls", async ({ page }) => {
    const errors = await startMatch(page, 20);
    const app = page.locator("#app");
    await expect(app).toHaveAttribute("data-input-mode", "touch");
    const fire = page.locator("#touch-fire");
    const stick = (await page.locator("#stick").boundingBox())!;
    const button = (await fire.boundingBox())!;
    const minimap = (await page.locator(".minimap").boundingBox())!;
    const deploy = (await page.locator("#touch-deploy").boundingBox())!;
    for (const control of [stick, button, deploy]) expect(control.y).toBeGreaterThan(minimap.y + minimap.height);
    const movePoint = { id: 1, x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
    const firePoint = { id: 2, x: button.x + button.width / 2, y: button.y + button.height / 2 };
    await page.mouse.click(280, 160, { button: "right" });
    await expect(app).toHaveAttribute("data-input-mode", "keyboard");

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [movePoint, firePoint] });
    await expect(app).toHaveAttribute("data-input-mode", "touch");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...movePoint, y: movePoint.y - 51 }, { ...firePoint, y: firePoint.y - 31 }],
    });
    await page.clock.runFor(1000);
    await expect(fire).toHaveAttribute("data-active", "true");
    await expect(page.locator("#deploy-state")).toHaveAttribute("data-ready", "true");
    await expect(page.locator("#attack-state")).toHaveText(/攻撃命中|攻撃クールダウン/);

    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await page.clock.runFor(50);
    await expect(fire).toHaveAttribute("data-active", "false");
    await page.setViewportSize({ width: 320, height: 568 });
    await page.clock.runFor(50);
    await expect(page.locator("#clock")).toBeInViewport();
    await expect(page.locator("#open-settings")).toBeInViewport();
    await expect(page.locator("#hp")).toBeInViewport();

    await page.locator("#open-settings").click({ force: true });
    const dialog = page.locator("#settings");
    await expect(dialog).toBeVisible();
    const time = await page.locator("#clock").textContent();
    await page.clock.runFor(1250);
    await expect(page.locator("#clock")).toHaveText(time!);
    await dialog.locator('[name="mode"]').selectOption("touch");
    await dialog.locator('[name="stick"]').selectOption("follow");
    for (const [name, value] of [["size", "32"], ["opacity", "45"], ["deadZone", "24"]]) {
      await dialog.locator(`[name="${name}"]`).fill(value);
    }
    await dialog.getByRole("button", { name: "閉じる" }).click({ force: true });
    await expect(page.locator("#stick")).toHaveCSS("width", "64px");
    await expect(page.locator("#stick")).toHaveCSS("opacity", "0.45");
    await page.reload();
    await page.locator("#open-settings").click({ force: true });
    await expect(dialog.locator('[name="mode"]')).toHaveValue("touch");
    await expect(dialog.locator('[name="stick"]')).toHaveValue("follow");
    await expect(dialog.locator('[name="size"]')).toHaveValue("32");
    await expect(dialog.locator('[name="opacity"]')).toHaveValue("45");
    await expect(dialog.locator('[name="deadZone"]')).toHaveValue("24");
    expect(errors).toEqual([]);
  });
});

test("standard gamepad takes over on intentional input and respects drift and manual settings", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false, touched: false })),
      id: "Standard test controller", index: 2, mapping: "standard", connected: true, timestamp: 0,
    };
    Object.defineProperty(navigator, "getGamepads", { value: () => [null, null, pad] });
    Object.assign(window, { testPad: pad });
  });
  type TestPad = { axes: number[]; buttons: { pressed: boolean; value: number }[] };
  const errors = await startMatch(page);
  const setPad = (axes: number[], fire = false, deploy = false) => page.evaluate(({ axes, fire, deploy }) => {
    const pad = (window as Window & { testPad?: TestPad }).testPad!;
    pad.axes = axes;
    pad.buttons[7] = { pressed: fire, value: Number(fire) };
    pad.buttons[2] = { pressed: deploy, value: Number(deploy) };
  }, { axes, fire, deploy });
  const app = page.locator("#app");
  await page.clock.runFor(45);
  await setPad([0.17, -0.16, 0.1, 0]);
  await page.clock.runFor(45);
  await expect(app).toHaveAttribute("data-input-mode", "keyboard");
  await setPad([0, -1, 0, -1], true);
  await page.clock.runFor(960);
  await expect(app).toHaveAttribute("data-input-mode", "gamepad");
  await expect(page.locator("#attack-state")).toHaveText(/攻撃命中|攻撃クールダウン/);
  await expect(page.locator("#deploy-state")).toHaveAttribute("data-ready", "true");
  await setPad([0, 0, 0, -1], true, true);
  await page.clock.runFor(75);
  await expect(page.locator("#sites .site").nth(1)).toContainText("青 起動");

  await page.keyboard.press("a");
  await expect(app).toHaveAttribute("data-input-mode", "keyboard");
  await page.clock.runFor(200);
  await expect(app).toHaveAttribute("data-input-mode", "keyboard");
  await page.locator("#open-settings").click({ force: true });
  await page.locator('#settings [name="mode"]').selectOption("keyboard");
  await page.locator("#settings").getByRole("button", { name: "閉じる" }).click({ force: true });
  await setPad([0, 0, 0, 0]);
  await page.clock.runFor(100);
  await setPad([1, 0, 1, 0], true);
  await page.clock.runFor(300);
  await expect(app).toHaveAttribute("data-input-mode", "keyboard");
  expect(errors).toEqual([]);
});

test("saved settings recover safely and leaving an active match releases its resources", async ({ page }) => {
  await page.addInitScript(() => {
    const stored = location.search
      ? { version: 0, mode: "gamepad", stick: "fixed" }
      : { version: 1, mode: "alien", stick: 9, size: 1000, opacity: -1, deadZone: "99" };
    localStorage.setItem("straidhold.controls", JSON.stringify(stored));
  });
  await page.goto("/");
  await expect(page.locator("#clock")).toHaveText("05:00");
  await page.locator("#open-settings").click();
  const dialog = page.locator("#settings");
  await expect(dialog.locator('[name="mode"]')).toHaveValue("auto");
  await expect(dialog.locator('[name="stick"]')).toHaveValue("floating");
  await expect(dialog.locator('[name="size"]')).toHaveValue("68");
  await expect(dialog.locator('[name="opacity"]')).toHaveValue("25");
  await expect(dialog.locator('[name="deadZone"]')).toHaveValue("15");

  await page.goto("/?stored=legacy");
  await page.locator("#open-settings").click();
  await expect(dialog.locator('[name="mode"]')).toHaveValue("auto");
  await expect(dialog.locator('[name="stick"]')).toHaveValue("floating");
  await expect(dialog.locator('[name="size"]')).toHaveValue("44");
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await page.locator("#start").click();
  await expect(page.locator("#overlay")).toBeHidden();
  await expect(page.locator("#game canvas")).toHaveCount(1);
  await expect(page.locator("#map-labels .map-label")).toHaveCount(5);
  const counts = await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    return document.querySelectorAll("#game canvas, #map-labels .map-label, .fog, .minimap, .roster-unit").length;
  });
  expect(counts).toBe(0);
});

test("shared Fog, camera and public roster update during the match", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  const errors = await startMatch(page);
  const redMarkers = page.locator(".minimap-unit[data-team=red]");
  const contactCount = () => page.locator(".minimap-unit[data-team=red][transform]").count();
  const camera = page.locator(".minimap-camera");
  const view = await camera.evaluate((node) =>
    Object.fromEntries(["x", "y", "width", "height"].map((name) => [name, Number(node.getAttribute(name))])));
  expect(view.width).toBeGreaterThan(2 * 235);
  expect(view.height).toBeGreaterThan(2 * 235);
  expect(view.height).toBeLessThan(2 * 235 * 1.13);
  expect(view.x).toBeGreaterThanOrEqual(-68);
  expect(view.y + view.height).toBeLessThanOrEqual(544 + 68 + 1e-8);
  await expect(page.locator(".minimap [data-team=blue][transform]")).toHaveCount(5);
  await expect(page.locator(".minimap-player")).toHaveAttribute("transform", "translate(480.0 464.0) rotate(0.0)");
  expect(await contactCount()).toBe(0);
  await expect(page.locator(".roster-team[data-team=red] .roster-count")).toHaveText("5/5");

  async function fogAlpha(x: number, y: number) {
    return page.locator(".minimap canvas").evaluate((canvas: HTMLCanvasElement, [x, y]) =>
      canvas.getContext("2d")!.getImageData(x / 2, y / 2, 1, 1).data[3], [x, y]);
  }
  expect(await fogAlpha(480, 340)).toBeLessThan(15);
  expect(await fogAlpha(480, 220)).toBeGreaterThan(160);
  expect(await fogAlpha(370, 430)).toBeGreaterThan(160);
  expect(await fogAlpha(160, 340)).toBeGreaterThan(160);

  await page.clock.runFor(2050);
  expect(await contactCount()).toBeGreaterThan(1);
  await expect(page.locator(".minimap-player")).toHaveAttribute("transform", "translate(480.0 464.0) rotate(0.0)");
  expect(await fogAlpha(160, 340)).toBeLessThan(15);
  await page.setViewportSize({ width: 820, height: 460 });
  await page.clock.runFor(50);
  const clip = (await page.locator(".fog").boundingBox())!;
  await page.keyboard.down("w");
  await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height * 0.15);
  await page.clock.runFor(800);
  await page.keyboard.up("w");
  expect(Number(await camera.getAttribute("y"))).toBeLessThan(view.y - 20);
  await expect(page.locator("#attack-state")).toHaveText("攻撃対象を捕捉");
  await page.mouse.down();
  await page.clock.runFor(120);
  await page.mouse.up();
  await expect(page.locator("#attack-state")).toHaveText(/攻撃命中|攻撃クールダウン/);

  // Retreat to the HQ so the outlying AI skirmishes are left to run independently.
  await page.keyboard.down("s");
  await page.clock.runFor(860);
  await page.keyboard.up("s");
  const oldCameraY = Number(await camera.getAttribute("y"));
  await page.clock.runFor(6700);
  expect(Number(await camera.getAttribute("y"))).toBeCloseTo(oldCameraY, 3);
  expect(await contactCount()).toBeLessThan(await redMarkers.count());
  expect(Number(await page.locator("#blue-score").textContent()) + Number(await page.locator("#red-score").textContent())).toBeGreaterThan(0);
  await expect(page.locator("#sites .site[data-owner]:not([data-owner=neutral])").first()).toBeVisible();
  const down = page.locator(".roster-unit[data-state=down]").first();
  await expect(down).toBeVisible();
  const seconds = Number(await down.textContent());
  expect(seconds).toBeGreaterThan(0);
  const label = (await down.getAttribute("aria-label"))!.split(" 復活")[0];
  await page.clock.runFor(1000);
  const portrait = page.getByRole("img", { name: new RegExp(`^${label} (?:復活まで|生存)`) });
  if (seconds > 1) await expect(portrait).toHaveText(String(seconds - 1));
  else await expect(portrait).toHaveAttribute("data-state", "alive");
  expect(errors).toEqual([]);
});
