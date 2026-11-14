import { expect, test, type Page } from "@playwright/test";

async function startMatch(page: Page, seconds = 22) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto(`/?map=training&round=${seconds}`);
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

  await page.goto("/?map=training&stored=legacy");
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
  for (let i = 0; i < 6 && Number(await camera.getAttribute("y")) >= view.y - 20; i++) {
    await page.clock.runFor(200);
  }
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
  for (let i = 0; i < 13 && !await page.locator(".roster-unit[data-state=down]").first().isVisible(); i++) {
    await page.clock.runFor(700);
  }
  if (!(await page.locator("#sites .site[data-owner]:not([data-owner=neutral])").count())) {
    await page.clock.runFor(1200);
  }
  expect(Number(await camera.getAttribute("y"))).toBeCloseTo(oldCameraY, 3);
  for (let i = 0; i < 6 && await contactCount() === await redMarkers.count(); i++) await page.clock.runFor(300);
  expect(await contactCount()).toBeLessThan(await redMarkers.count());
  expect(Number(await page.locator("#blue-score").textContent()) + Number(await page.locator("#red-score").textContent())).toBeGreaterThan(0);
  await expect(page.locator("#sites .site[data-owner]:not([data-owner=neutral])").first()).toBeVisible();
  const down = page.locator(".roster-unit[data-state=down]").first();
  await expect(down).toBeVisible();
  const seconds = Number(await down.textContent());
  expect(seconds).toBeGreaterThan(0);
  const label = (await down.getAttribute("aria-label"))!.split(" 復活")[0];
  await page.clock.runFor(1100);
  const portrait = page.getByRole("img", { name: new RegExp(`^${label} (?:復活まで|生存)`) });
  const remaining = Number(await portrait.textContent());
  expect(remaining).toBeLessThan(seconds);
  expect(remaining).toBeGreaterThanOrEqual(Math.max(0, seconds - 2));
  expect(errors).toEqual([]);
});

test("the follow camera stays at the last position during death and returns to HQ on respawn", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 405 });
  const errors = await startMatch(page);
  const camera = page.locator(".minimap-camera");
  const player = page.locator(".minimap-player");
  const respawn = page.locator("#respawn");
  const homeY = Number(await camera.getAttribute("y"));
  await page.keyboard.down("w");
  for (let i = 0; i < 12; i++) {
    const transform = await player.getAttribute("transform");
    const y = Number(transform?.match(/translate\([^ ]+ ([^)]+)\)/)?.[1]);
    if (y < 105) break;
    await page.clock.runFor(300);
  }
  await page.keyboard.up("w");
  expect(Number(await camera.getAttribute("y"))).toBeLessThan(homeY - 100);
  for (let i = 0; i < 18 && !await respawn.isVisible(); i++) await page.clock.runFor(800);
  await expect(respawn).toBeVisible();
  await expect(player).not.toHaveAttribute("transform");
  const deathY = await camera.getAttribute("y");
  await page.clock.runFor(600);
  await expect(camera).toHaveAttribute("y", deathY!);
  for (let i = 0; i < 14 && await respawn.isVisible(); i++) await page.clock.runFor(800);
  await expect(respawn).toBeHidden();
  await expect(player).toHaveAttribute("transform", /^translate\(480\.0 464\.0\)/);
  await expect(page.locator(".roster-player")).toHaveAttribute("data-state", "alive");
  expect(Number(await camera.getAttribute("y"))).toBeCloseTo(homeY);
  expect(errors).toEqual([]);
});

test("all five tactical maps launch with their own layout and allow changing maps after a round", async ({ page }) => {
  const layouts = [
    ["twin-forks", 7, "0 0 2560 1216"],
    ["three-crossings", 7, "0 0 2624 1344"],
    ["central-line", 5, "0 0 2496 1216"],
    ["split-merge", 4, "0 0 2432 1152"],
    ["cross-supply", 7, "0 0 2624 1344"],
  ] as const;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 760, height: 430 });
  await page.clock.install();
  await page.goto("/?round=5");
  await expect(page.locator("#start")).toBeEnabled();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250));
  const picker = page.getByRole("combobox", { name: "戦場", exact: true });
  const panel = page.locator(".minimap");
  await expect(picker).toHaveValue(layouts[0][0]);
  await expect(picker.locator("option")).toHaveCount(6);
  for (const [id, count, view] of layouts) {
    await picker.selectOption(id);
    await expect(page.locator("#map-preview svg")).toHaveAttribute("viewBox", view);
    await page.locator("#start").click({ force: true });
    await expect(page.locator("#overlay")).toBeHidden();
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute("data-map", id);
    await expect(panel.locator("svg").first()).toHaveAttribute("viewBox", view);
    await expect(page.locator("#sites .site")).toHaveCount(count);
    await page.keyboard.down("d");
    await page.clock.runFor(300);
    await page.keyboard.up("d");
    await expect(panel.locator(".minimap-player")).not.toHaveAttribute("transform", /^translate\(192\.0 /);
    for (let i = 0; i < 4 && await page.locator("#overlay").isHidden(); i++) {
      await page.clock.runFor(1700);
    }
    await expect(page.locator("#clock")).toHaveText("00:00");
    await expect(picker).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("a player reaches the front, connects supply, and attacks on the compact map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 800, height: 450 });
  await page.clock.install();
  await page.goto("/?map=central-line&round=40");
  await expect(page.locator("#start")).toBeEnabled();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250));
  await page.locator("#start").click({ force: true });
  await expect(page.locator("#overlay")).toBeHidden();
  await expect(page.locator(".minimap-unit[data-team=red][transform]")).toHaveCount(0);
  const forwardSite = page.locator("#sites .site").filter({ has: page.getByText("D", { exact: true }) });
  await page.keyboard.down("d");
  await page.clock.runFor(3200);
  await page.keyboard.up("d");
  await expect(forwardSite).toContainText(/青 起動|青/);
  for (let i = 0; i < 5 && await forwardSite.getAttribute("data-supply") !== "linked"; i++) {
    await page.clock.runFor(1300);
  }
  await expect(forwardSite).toHaveAttribute("data-owner", "blue");
  await expect(forwardSite).toHaveAttribute("data-supply", "linked");
  await expect(page.locator('.minimap line[stroke="#75ddff"]').first()).toBeAttached();
  expect(Number(await page.locator("#blue-score").textContent())).toBeGreaterThan(0);
  const clip = (await page.locator(".fog").boundingBox())!;
  await page.mouse.move(clip.x + clip.width * 0.9, clip.y + clip.height * 0.5);
  await page.mouse.down();
  await page.keyboard.down("d");
  for (let i = 0; i < 13; i++) {
    await page.clock.runFor(380);
    if (await page.locator("#attack-state").textContent() === "攻撃命中") break;
  }
  await page.keyboard.up("d");
  await page.mouse.up();
  await expect(page.locator("#attack-state")).toHaveText("攻撃命中");
  await expect(page.locator(".minimap-unit[data-team=red][transform]").first()).toBeAttached();
  expect(errors).toEqual([]);
});

test.describe("tactical map on a small touch screen", () => {
  test.use({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });

  test("keeps the map picker and seven objectives usable during multi-touch movement", async ({ page }) => {
    await page.clock.install();
    await page.goto("/?map=cross-supply&round=20");
    await expect(page.getByRole("combobox", { name: "戦場", exact: true })).toBeInViewport();
    await expect(page.locator("#start")).toBeEnabled();
    await expect(page.locator("#start")).toBeInViewport();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250));
    await page.locator("#start").click({ force: true });
    await expect(page.locator("#overlay")).toBeHidden();
    const markers = page.locator("#sites .site");
    await expect(markers).toHaveCount(7);
    await expect(markers.last()).toBeInViewport();
    await page.clock.runFor(100);
    const map = (await page.locator(".minimap").boundingBox())!;
    const stick = (await page.locator("#stick").boundingBox())!;
    const fire = (await page.locator("#touch-fire").boundingBox())!;
    expect(fire.y).toBeGreaterThan(map.y + map.height);
    const cdp = await page.context().newCDPSession(page);
    const stickPoint = { id: 1, x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
    const firePoint = { id: 2, x: fire.x + fire.width / 2, y: fire.y + fire.height / 2 };
    const player = page.locator(".minimap-player");
    const before = await player.getAttribute("transform");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [stickPoint, firePoint] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...stickPoint, x: stickPoint.x + 42 }, { ...firePoint, y: firePoint.y - 21 }] });
    await page.clock.runFor(350);
    await expect(player).not.toHaveAttribute("transform", before!);
    await expect(page.locator("#touch-fire")).toHaveAttribute("data-active", "true");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
});


test.describe("held touch input during capture", () => {
  test.use({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });

  test("keeps the first contact moving through a second-finger deployment and HUD updates", async ({ page }) => {
    await page.clock.install();
    await page.goto("/?map=central-line&round=40");
    await expect(page.locator("#start")).toBeEnabled();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 250));
    await page.locator("#start").click({ force: true });
    await expect(page.locator("#overlay")).toBeHidden();

    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", touchPoints: { id: number; x: number; y: number }[]) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    const control = async (selector: string, id: number) => {
      const box = (await page.locator(selector).boundingBox())!;
      return { id, x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const marker = page.locator(".minimap-player");
    const playerX = async () => Number((await marker.getAttribute("transform"))!.match(/^translate\(([0-9.]+)/)?.[1]);
    const move = await control("#stick", 1);
    const deploy = await control("#touch-deploy", 2);
    const battlefield = page.locator("#battlefield");
    const initialBounds = await battlefield.boundingBox();
    const right = { ...move, x: move.x + 56 };
    const forward = page.locator("#sites .site").filter({ has: page.getByText("D", { exact: true }) });
    const progress = forward.locator("progress");
    await touch("touchStart", [move]);
    await touch("touchMove", [right]);
    await page.clock.runFor(2650);
    for (let step = 0; step < 28 && await page.locator("#deploy-state").getAttribute("data-ready") !== "true"; step++) {
      await page.clock.runFor(17);
    }
    await expect(page.locator("#deploy-state")).toHaveAttribute("data-ready", "true");
    await expect(progress).toBeHidden();

    await touch("touchStart", [right, deploy]);
    await page.clock.runFor(80);
    await expect(progress).toBeVisible();
    await expect(forward).toContainText("青 起動");
    const atInstall = await playerX();
    await page.clock.runFor(900);
    expect(await playerX()).toBeGreaterThan(atInstall + 100);
    expect(await battlefield.boundingBox()).toEqual(initialBounds);

    for (let step = 0; step < 13 && await forward.getAttribute("data-supply") !== "linked"; step++) {
      await page.clock.runFor(430);
    }
    await expect(forward).toHaveAttribute("data-supply", "linked");
    expect(Number(await page.locator("#blue-score").textContent())).toBeGreaterThan(0);
    expect(await battlefield.boundingBox()).toEqual(initialBounds);
    await expect(page.locator("#app")).toHaveAttribute("data-input-mode", "touch");
    const beforeRelease = await playerX();
    await page.clock.runFor(200);
    expect(await playerX()).toBeGreaterThan(beforeRelease + 20);

    await touch("touchEnd", []);
    await page.clock.runFor(65);
    const stopped = await playerX();
    await page.clock.runFor(260);
    expect(await playerX()).toBe(stopped);
  });
});
