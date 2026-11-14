import { expect, test, type Page } from "@playwright/test";

async function freezeClock(page: Page) {
  const time = new Date("2026-01-01T00:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
}

async function enterLobby(page: Page) {
  await page.locator("#setup-next").click();
  await page.locator("#character-next").click();
  await page.locator("#lobby-ready").click();
  await expect(page.locator("#lobby-start")).toBeEnabled();
}

async function startCombat(page: Page, button = "#lobby-start") {
  await page.locator(button).click({ force: true });
  await expect(page.locator("#preparation")).toBeVisible();
  await page.locator("#skip-preparation").click({ force: true });
  await page.clock.runFor(3050);
  await expect(page.locator("#app")).toHaveAttribute("data-phase", "combat");
}

async function startMatch(page: Page, seconds = 22, map = "training") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await freezeClock(page);
  await page.goto(`/?map=${map}&round=${seconds}`);
  await page.locator("#solo").click();
  await enterLobby(page);
  await startCombat(page);
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
  await expect(page.locator("#start")).toHaveText("再戦");
  const results = page.locator("#participant-results");
  await expect(results.locator("[data-participant]")).toHaveCount(10);
  const playerRow = results.locator('[data-participant="blue-2"]');
  await expect(playerRow.getByRole("rowheader")).toHaveText("BLUE 3（自分）");
  expect(Number(await playerRow.locator("td").nth(3).textContent())).toBeGreaterThan(0);
  await playerRow.locator("summary").click({ force: true });
  await expect(results.getByText("占領維持", { exact: true }).filter({ visible: true })).toHaveCount(1);

  await startCombat(page, "#start");
  await page.clock.runFor(100);
  await expect(page.locator("#clock")).toHaveText("00:22");
  await expect(page.locator("#blue-score")).toHaveText("0");
  await expect(results.locator("[data-participant]")).toHaveCount(0);
  await expect(page.locator("#combat-feed li")).toHaveCount(0);
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
    const fire = page.locator("#aim-stick");
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
    await dialog.locator('[name="aimStick"]').selectOption("fixed");
    for (const [name, value] of [["size", "32"], ["opacity", "45"], ["deadZone", "24"]]) {
      await dialog.locator(`[name="${name}"]`).fill(value);
    }
    await dialog.getByRole("button", { name: "閉じる" }).click({ force: true });
    await expect(page.locator("#stick")).toHaveCSS("width", "64px");
    await expect(page.locator("#stick")).toHaveCSS("opacity", "0.45");
    await expect(page.locator("#aim-stick")).toHaveCSS("width", "64px");
    await expect(page.locator("#aim-stick")).toHaveCSS("opacity", "0.45");
    await page.reload();
    await page.locator("#title-settings").click({ force: true });
    await expect(dialog.locator('[name="mode"]')).toHaveValue("touch");
    await expect(dialog.locator('[name="stick"]')).toHaveValue("follow");
    await expect(dialog.locator('[name="aimStick"]')).toHaveValue("fixed");
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
      : { version: 1, mode: "alien", stick: 9, aimStick: "unsupported", size: 1000, opacity: -1, deadZone: "99" };
    localStorage.setItem("straidhold.controls", JSON.stringify(stored));
  });
  await page.goto("/");
  await expect(page.locator("#game canvas")).toBeHidden();
  await page.locator("#title-settings").click();
  const dialog = page.locator("#settings");
  await expect(dialog.locator('[name="mode"]')).toHaveValue("auto");
  await expect(dialog.locator('[name="stick"]')).toHaveValue("floating");
  await expect(dialog.locator('[name="aimStick"]')).toHaveValue("floating");
  await expect(dialog.locator('[name="size"]')).toHaveValue("68");
  await expect(dialog.locator('[name="opacity"]')).toHaveValue("25");
  await expect(dialog.locator('[name="deadZone"]')).toHaveValue("15");

  await page.goto("/?map=training&stored=legacy");
  await page.locator("#title-settings").click();
  await expect(dialog.locator('[name="mode"]')).toHaveValue("auto");
  await expect(dialog.locator('[name="stick"]')).toHaveValue("floating");
  await expect(dialog.locator('[name="aimStick"]')).toHaveValue("floating");
  await expect(dialog.locator('[name="size"]')).toHaveValue("44");
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await page.locator("#solo").click();
  await enterLobby(page);
  await page.locator("#lobby-start").click();
  await expect(page.locator("#preparation")).toBeVisible();
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
  await page.evaluate(() => {
    const edge = document.querySelector<HTMLElement>("#damage-edge")!;
    const vitals = document.querySelector<HTMLElement>("#vitals")!;
    const observed = new Set<string>();
    new MutationObserver(() => {
      const type = edge.dataset.impact;
      if (type && type === vitals.dataset.impact && !edge.hidden) observed.add(type);
      vitals.dataset.observedImpacts = Array.from(observed).join(" ");
    }).observe(edge, { attributes: true, attributeFilter: ["data-impact"] });
  });
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
  await expect(respawn).toContainText("撃破された");
  await expect(page.locator("#vitals")).toHaveAttribute("data-observed-impacts", /shield.*hp.*lethal/);
  const defeat = page.locator('#combat-feed li[data-kind="defeat"][data-personal="true"]').last();
  await expect(defeat).toContainText("に撃破された");
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
  await freezeClock(page);
  await page.goto("/?round=5");
  await page.locator("#solo").click();
  const picker = page.getByRole("combobox", { name: "戦場", exact: true });
  const panel = page.locator(".minimap");
  await expect(picker).toHaveValue(layouts[0][0]);
  await expect(picker.locator("option")).toHaveCount(6);
  for (const [id, count, view] of layouts) {
    await picker.selectOption(id);
    await expect(page.locator("#map-preview svg")).toHaveAttribute("viewBox", view);
    await enterLobby(page);
    await startCombat(page);
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute("data-map", id);
    await expect(panel.locator("svg").first()).toHaveAttribute("viewBox", view);
    await expect(page.locator("#sites .site")).toHaveCount(count);
    await page.keyboard.down("d");
    await page.clock.runFor(300);
    await page.keyboard.up("d");
    await expect(panel.locator(".minimap-player")).not.toHaveAttribute("transform", /^translate\(192\.0 /);
    for (let i = 0; i < 4 && await page.locator("#result-screen").isHidden(); i++) {
      await page.clock.runFor(1700);
    }
    await expect(page.locator("#clock")).toHaveText("00:00");
    await page.locator("#result-setup").click();
    await expect(picker).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("a player reaches the front, connects supply, and attacks on the compact map", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 450 });
  const errors = await startMatch(page, 40, "central-line");
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
    await freezeClock(page);
    await page.goto("/?map=cross-supply&round=20");
    await page.locator("#solo").click();
    await expect(page.getByRole("combobox", { name: "戦場", exact: true })).toBeInViewport();
    await enterLobby(page);
    await expect(page.locator("#lobby-start")).toBeInViewport();
    await startCombat(page);
    const markers = page.locator("#sites .site");
    await expect(markers).toHaveCount(7);
    await expect(markers.last()).toBeInViewport();
    await page.clock.runFor(100);
    const map = (await page.locator(".minimap").boundingBox())!;
    const stick = (await page.locator("#stick").boundingBox())!;
    const fire = (await page.locator("#aim-stick").boundingBox())!;
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
    await expect(page.locator("#aim-stick")).toHaveAttribute("data-active", "true");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
});


test.describe("held touch input during capture", () => {
  test.use({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });

  test("keeps the first contact moving through a second-finger deployment and HUD updates", async ({ page }) => {
    await startMatch(page, 40, "central-line");

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
    const aim = await control("#aim-stick", 3);
    const aimed = { ...aim, y: aim.y + 38 };
    const aimStick = page.locator("#aim-stick");
    const battlefield = page.locator("#battlefield");
    const initialBounds = await battlefield.boundingBox();
    const right = { ...move, x: move.x + 56 };
    const forward = page.locator("#sites .site").filter({ has: page.getByText("D", { exact: true }) });
    const progress = forward.locator("progress");
    await touch("touchStart", [move, aim]);
    await touch("touchMove", [right, aimed]);
    await page.clock.runFor(2650);
    for (let step = 0; step < 28 && await page.locator("#deploy-state").getAttribute("data-ready") !== "true"; step++) {
      await page.clock.runFor(17);
    }
    await expect(page.locator("#deploy-state")).toHaveAttribute("data-ready", "true");
    await expect(progress).toBeHidden();

    await touch("touchStart", [right, deploy, aimed]);
    await page.clock.runFor(80);
    await expect(progress).toBeVisible();
    await expect(forward).toContainText("青 起動");
    const installed = await progress.evaluate((node: HTMLProgressElement) => node.value);
    expect(installed).toBeGreaterThan(0);
    expect(installed).toBeLessThan(await progress.evaluate((node: HTMLProgressElement) => node.max));
    await expect(page.locator("#combat-feed")).toHaveCSS("pointer-events", "none");
    const atInstall = await playerX();
    await page.clock.runFor(900);
    expect(await playerX()).toBeGreaterThan(atInstall + 100);
    expect(await battlefield.boundingBox()).toEqual(initialBounds);
    await expect(aimStick).toHaveAttribute("data-active", "true");

    for (let step = 0; step < 13 && await forward.getAttribute("data-supply") !== "linked"; step++) {
      await page.clock.runFor(430);
    }
    await expect(forward).toHaveAttribute("data-supply", "linked");
    const notice = page.locator('#combat-feed li[data-kind="capture"][data-personal="true"]').filter({ hasText: "拠点Dの占領に成功" });
    await expect(notice).toHaveCount(1);
    const order = await page.locator("#combat-feed li").evaluateAll((rows) => rows.map((row) => Number((row as HTMLElement).dataset.sequence)));
    expect(order).toEqual([...new Set(order)].sort((a, b) => a - b));
    expect(order.length).toBeLessThanOrEqual(5);
    await expect(progress).toBeHidden();
    expect(Number(await page.locator("#blue-score").textContent())).toBeGreaterThan(0);
    expect(await battlefield.boundingBox()).toEqual(initialBounds);
    await expect(aimStick).toHaveAttribute("data-active", "true");
    await expect(page.locator("#app")).toHaveAttribute("data-input-mode", "touch");
    const beforeRelease = await playerX();
    await page.clock.runFor(200);
    expect(await playerX()).toBeGreaterThan(beforeRelease + 20);

    await touch("touchEnd", []);
    await page.clock.runFor(65);
    const stopped = await playerX();
    await page.clock.runFor(260);
    expect(await playerX()).toBe(stopped);
    await page.clock.runFor(5050);
    await expect(notice).toHaveCount(0);
  });
});

test.describe("attack stick", () => {
  test.use({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });

  test("switches aim while held and releases each stick independently", async ({ page }) => {
    await startMatch(page, 20);
    const cdp = await page.context().newCDPSession(page);
    type Contact = { id: number; x: number; y: number };
    const touch = (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", touchPoints: Contact[]) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    const center = async (selector: string, id: number) => {
      const box = (await page.locator(selector).boundingBox())!;
      return { id, x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const marker = page.locator(".minimap-player");
    const position = async () => {
      const [, x, y] = (await marker.getAttribute("transform"))!.match(/^translate\(([\d.]+) ([\d.]+)/)!;
      return { x: Number(x), y: Number(y) };
    };
    const aim = page.locator("#aim-stick");
    const move = page.locator("#stick");
    const attack = page.locator("#attack-state");
    const left = await center("#stick", 1);
    const right = await center("#aim-stick", 2);
    const forward = { ...left, y: left.y - 51 };
    const south = { ...right, y: right.y + 35 };
    await touch("touchStart", [left]);
    await touch("touchMove", [forward]);
    await page.clock.runFor(945);
    await touch("touchEnd", []);
    await page.clock.runFor(45);
    const stopped = await position();
    expect(stopped.y).toBeLessThan(330);
    await expect(attack).toHaveText("攻撃待機");

    await expect(page.locator(".minimap-unit[data-team=red][transform]").first()).toBeAttached();
    // A short tap spans a simulation step and can fire without a drag or hold delay.
    await touch("touchStart", [right]);
    await page.clock.runFor(45);
    await expect(attack).toHaveText("攻撃命中");
    await expect(page.locator("#hit-marker")).toBeVisible();
    await touch("touchEnd", []);
    await page.clock.runFor(700);
    await expect(attack).toHaveText("攻撃待機");
    await expect(page.locator("#hit-marker")).toBeHidden();

    await touch("touchStart", [right]);
    await touch("touchMove", [{ ...right, x: right.x + 3 }]);
    await page.clock.runFor(45);
    await expect(aim).toHaveAttribute("data-active", "true");
    await expect(attack).toHaveText("攻撃命中");
    await touch("touchMove", [south]);
    await page.clock.runFor(250);
    await expect(attack).toHaveText("射程内に有効な対象なし");
    await expect(marker).toHaveAttribute("transform", /rotate\(180\.0\)/);
    expect(await position()).toEqual(stopped);

    await touch("touchMove", [right]);
    await page.clock.runFor(120);
    await expect(aim).toHaveAttribute("data-active", "true");
    await expect(page.locator("#aim-knob")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await expect(attack).toHaveText(/攻撃命中|攻撃クールダウン/);

    // Keep the aim contact while changing the left contact and then releasing it.
    await touch("touchStart", [right, left]);
    const rightward = { ...left, x: left.x + 39 };
    const leftward = { ...left, x: left.x - 39 };
    await touch("touchMove", [right, rightward]);
    await page.clock.runFor(100);
    expect((await position()).x).toBeGreaterThan(stopped.x);
    const beforeLeft = await position();
    await touch("touchMove", [right, leftward]);
    for (let i = 0; i < 4 && (await position()).x >= beforeLeft.x; i++) await page.clock.runFor(50);
    expect((await position()).x).toBeLessThan(beforeLeft.x);
    await expect(aim).toHaveAttribute("data-active", "true");
    await touch("touchEnd", [leftward]);
    await page.clock.runFor(50);
    await expect(move).toHaveAttribute("data-active", "false");
    await expect(aim).toHaveAttribute("data-active", "true");
    const afterLeftRelease = await position();
    await page.clock.runFor(70);
    expect(await position()).toEqual(afterLeftRelease);

    await touch("touchStart", [right, left]);
    await touch("touchMove", [right, forward]);
    await touch("touchEnd", [right]);
    const beforeRightRelease = await position();
    await page.clock.runFor(250);
    expect((await position()).y).toBeLessThan(beforeRightRelease.y);
    await expect(move).toHaveAttribute("data-active", "true");
    await expect(aim).toHaveAttribute("data-active", "false");
    await expect(attack).toHaveText(/攻撃待機|攻撃クールダウン/);
    await touch("touchStart", [forward, right]);
    await page.clock.runFor(40);
    await expect(aim).toHaveAttribute("data-active", "true");
    await touch("touchCancel", []);
    await page.clock.runFor(750);
    await expect(move).toHaveAttribute("data-active", "false");
    await expect(aim).toHaveAttribute("data-active", "false");
    await expect(attack).toHaveText("攻撃待機");
    const afterCancel = await position();
    await page.clock.runFor(85);
    expect(await position()).toEqual(afterCancel);
  });

  test("fixed, floating and follow modes use the SDK center and knob", async ({ page }) => {
    await startMatch(page, 5);
    const cdp = await page.context().newCDPSession(page);
    const aim = page.locator("#aim-stick");
    const knob = page.locator("#aim-knob");
    const field = page.locator("#battlefield");
    const dialog = page.locator("#settings");
    for (const mode of ["fixed", "floating", "follow"]) {
      await page.locator("#open-settings").click({ force: true });
      await dialog.locator('[name="aimStick"]').selectOption(mode);
      await dialog.getByRole("button", { name: "閉じる" }).click({ force: true });
      await page.clock.runFor(50);
      const box = (await aim.boundingBox())!;
      const cx = box.x + box.width / 2;
      const start = { id: 7, x: cx - 20, y: box.y + box.height / 2 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
      await page.clock.runFor(40);
      expect((await aim.boundingBox())!.x + box.width / 2).toBeCloseTo(mode === "fixed" ? cx : start.x, 0);
      const edge = (await field.boundingBox())!;
      const end = { ...start, x: Math.min(start.x + 72, edge.x + edge.width - 10) };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [end] });
      await page.clock.runFor(40);
      const expected = mode === "fixed" ? cx : mode === "floating" ? start.x : end.x - box.width / 2;
      expect((await aim.boundingBox())!.x + box.width / 2).toBeCloseTo(expected, 0);
      expect(await knob.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m41)).toBeGreaterThan(25);
      if (mode === "follow") {
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      } else {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      }
      await page.clock.runFor(40);
      await expect(aim).toHaveAttribute("data-active", "false");
      await expect(knob).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const box = (await aim.boundingBox())!;
    const contact = { id: 8, x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [contact] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...contact, y: contact.y - 40 }] });
    await page.clock.runFor(90);
    await expect(aim).toHaveAttribute("data-active", "true");
    await page.clock.runFor(5000);
    await expect(page.locator("#start")).toHaveText("再戦");
    await startCombat(page, "#start");
    await page.clock.runFor(80);
    await expect(aim).toHaveAttribute("data-active", "false");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
});

test("title, setup, character and ready lobby retain selections and allow returning", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await expect(page.locator("#title-heading")).toBeVisible();
  await expect(page.locator(".title-menu button:disabled")).toHaveCount(3);
  await page.locator("#title-settings").click();
  await expect(page.locator("#settings")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("#solo").click();
  await page.locator("#map-select").selectOption("cross-supply");
  await page.locator("#rule-select").selectOption("series");
  await page.locator("#setup-next").click();
  await page.getByRole("radio", { name: "タンク" }).check();
  await page.locator("#character-next").click();
  await expect(page.locator("#lobby-blue li")).toHaveCount(5);
  await expect(page.locator("#lobby-red li")).toHaveCount(5);
  await expect(page.locator("#lobby-summary")).toHaveText(/交差補給路.*3ラウンド先取/);
  await expect(page.locator("#lobby-blue")).toContainText("タンク · 準備中");
  await expect(page.locator("#lobby-start")).toBeDisabled();
  await page.locator("#lobby-ready").click();
  await expect(page.locator("#lobby-start")).toBeEnabled();
  await page.locator("#lobby-ready").click();
  await expect(page.locator("#lobby-start")).toBeDisabled();
  await page.locator("#lobby-back").click();
  await expect(page.getByRole("radio", { name: "タンク" })).toBeChecked();
  await page.locator("#character-back").click();
  await expect(page.locator("#map-select")).toHaveValue("cross-supply");
  await expect(page.locator("#rule-select")).toHaveValue("series");
  await page.locator("#setup-back").click();
  await expect(page.locator("#title-heading")).toBeFocused();
});

test("preparation freezes both teams and leaving releases the active round", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await freezeClock(page);
  await page.goto("/?map=training&round=5");
  await page.locator("#solo").click();
  await enterLobby(page);
  await page.locator("#lobby-start").click({ force: true });
  await expect(page.locator("#preparation-time")).toHaveText("10");
  await page.clock.runFor(50);
  const markers = page.locator(".minimap-unit");
  const positions = () => markers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform")));
  const before = await positions();
  await page.keyboard.down("w");
  await page.keyboard.press("e");
  await page.clock.runFor(1800);
  await page.keyboard.up("w");
  expect(await positions()).toEqual(before);
  await expect(page.locator("#sites progress:visible")).toHaveCount(0);
  await expect(page.locator("#clock")).toHaveText("00:05");
  await expect(page.locator("#blue-score")).toHaveText("0");
  await page.locator("#skip-preparation").click({ force: true });
  await page.clock.runFor(25);
  await expect(page.locator("#preparation-heading")).toHaveText("戦闘開始まで");
  await expect(page.locator("#preparation-time")).toHaveText("3");
  await page.clock.runFor(3050);
  await expect(page.locator("#app")).toHaveAttribute("data-phase", "combat");
  await page.keyboard.down("w");
  await page.clock.runFor(400);
  await page.keyboard.up("w");
  expect(await positions()).not.toEqual(before);
  await page.locator("#leave-battle").click({ force: true });
  await page.locator("#leave-dialog").getByRole("button", { name: "対戦に戻る" }).click({ force: true });
  await expect(page.locator("#app")).toBeVisible();
  await page.locator("#leave-battle").click({ force: true });
  await page.locator("#leave-dialog").getByRole("button", { name: "タイトルへ" }).click({ force: true });
  await expect(page.locator("#title-heading")).toBeVisible();
  await expect(page.locator(".fog, .minimap, .map-label, .roster-unit")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("series retains round results and resets the battlefield for the next round", async ({ page }) => {
  await freezeClock(page);
  await page.goto("/?map=training&round=5");
  await page.locator("#solo").click();
  await page.locator("#rule-select").selectOption("series");
  await enterLobby(page);
  await startCombat(page);
  await page.clock.runFor(5200);
  await expect(page.locator("#result-round")).toHaveText("第1ラウンド終了");
  await expect(page.locator("#round-results li")).toHaveCount(1);
  const rows = page.locator("#participant-results [data-participant]");
  await expect(rows).toHaveCount(10);
  const initial = await rows.allTextContents();
  await page.locator("#result-round-select").selectOption("1");
  expect(await rows.allTextContents()).toEqual(initial);
  await expect(page.locator("#start")).toHaveText("次のラウンド");
  await expect(page.locator(".minimap")).toHaveCount(0);
  await page.locator("#start").click({ force: true });
  await expect(page.locator("#round-status")).toHaveText(/第2ラウンド/);
  await expect(page.locator("#preparation-time")).toHaveText("60");
  await expect(page.locator("#blue-score")).toHaveText("0");
  await expect(page.locator('#sites .site[data-owner="neutral"]')).toHaveCount(3);
  await expect(rows).toHaveCount(0);
  await page.locator("#skip-preparation").click({ force: true });
  await page.clock.runFor(8250);
  await expect(page.locator("#round-results li")).toHaveCount(2);
  await expect(page.locator("#result-round-select")).toHaveValue("0");
  await expect(page.locator("#result-round-select option")).toHaveCount(3);
  await page.locator("#result-title").click({ force: true });
  await expect(rows).toHaveCount(0);
  await expect(page.locator("#round-results li")).toHaveCount(0);
});
