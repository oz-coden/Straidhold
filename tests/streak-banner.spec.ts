import { expect, test } from "@playwright/test";
import { build } from "vite";

test.use({ hasTouch: true, isMobile: true });

type TestNotice = { sequence: number; streak: number; stoppedStreak?: number; attacker?: string };

test("personal banners fit beside the feed and minimap and let touch reach the battlefield", async ({ page }) => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "esnext",
      lib: { entry: "src/web/streak-presentation.ts", formats: ["es"] },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!output || !("output" in output)) throw new Error("Expected the presentation test module");
  const module = output.output.find((entry) => entry.type === "chunk");
  if (!module) throw new Error("Missing presentation test module");
  await page.route("**/streak-test-module.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: module.code }));
  await page.setViewportSize({ width: 568, height: 320 });
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
  await page.goto("/");
  await page.locator("#solo").click();
  await page.locator("#setup-next").click();
  await page.locator("#character-next").click();
  await page.locator("#lobby-ready").click();
  await page.locator("#lobby-start").click();
  await page.locator("#skip-preparation").click();
  await page.clock.runFor(3050);
  await expect(page.locator("#app")).toHaveAttribute("data-phase", "combat");

  // Drive a separate presentation from known defeat events while the production
  // match supplies the HUD layout, renderer, and real input surface.
  await page.evaluate(async () => {
    const { createStreakPresentation } = await import(new URL("streak-test-module.js", location.href).href);
    const view = createStreakPresentation(document.getElementById("streak-banner"), "blue-2", 60);
    Object.assign(window, { streakTestFrame: (notices: TestNotice[], tick: number) => view.update(
      notices.map(({ attacker = "blue-2", sequence, streak, stoppedStreak = 0 }) => ({
        kind: "defeat", attacker, target: "red-1", team: "blue", assists: [],
        sequence, round: 1, tick, streak, stoppedStreak,
      })), tick),
    });
    const feed = document.getElementById("combat-feed")!;
    const row = document.createElement("li");
    row.textContent = "BLUE 2 が5連続キル！";
    feed.append(row);
  });
  const frame = (notices: TestNotice[], tick: number) => page.evaluate(({ notices, tick }) => {
    const driver = window as unknown as { streakTestFrame(notices: TestNotice[], tick: number): void };
    driver.streakTestFrame(notices, tick);
  }, { notices, tick });

  const banner = page.locator("#streak-banner");
  await frame([{ sequence: 1, streak: 5, attacker: "blue-1" }], 1);
  await expect(banner).toBeHidden();
  await frame([{ sequence: 2, streak: 3 }, { sequence: 3, streak: 5 }, { sequence: 4, streak: 10, stoppedStreak: 7 }], 2);
  await frame([], 14);
  await expect(banner).toHaveText("3連続キル！");
  await frame([], 95);
  await expect(banner).toHaveText("5連続キル！");
  await frame([], 197);
  await expect(banner).toHaveText("10連続キル！");
  await frame([], 314);
  await frame([], 326);
  await expect(banner).toHaveText(/SHUTDOWN.*7連続キルを阻止/);
  await expect(banner).toHaveCSS("pointer-events", "none");

  for (const size of [{ width: 320, height: 568 }, { width: 1280, height: 720 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(size);
    await page.clock.runFor(40);
    const [box, feed, minimap, battlefield] = await Promise.all([
      banner.boundingBox(), page.locator("#combat-feed").boundingBox(),
      page.locator(".minimap").boundingBox(), page.locator("#battlefield").boundingBox(),
    ]);
    expect(box!.x).toBeGreaterThanOrEqual(feed!.x + feed!.width);
    expect(box!.x + box!.width).toBeLessThanOrEqual(minimap!.x);
    expect(box!.y + box!.height).toBeLessThan(battlefield!.y + battlefield!.height * 0.46);
  }

  const pointerReachedGame = await banner.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return !!document.elementFromPoint(x + width / 2, y + height / 2)?.closest("#game");
  });
  expect(pointerReachedGame).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  const center = async (selector: string, id: number) => {
    const box = (await page.locator(selector).boundingBox())!;
    return { id, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const move = await center("#stick", 1);
  const fire = await center("#aim-stick", 2);
  const before = await page.locator(".minimap-player").getAttribute("transform");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [move, fire] });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove", touchPoints: [{ ...move, y: move.y - 54 }, { ...fire, x: fire.x - 30 }],
  });
  await page.clock.runFor(150);
  await expect(page.locator("#stick")).toHaveAttribute("data-active", "true");
  await expect(page.locator("#aim-stick")).toHaveAttribute("data-active", "true");
  await expect(page.locator(".minimap-player")).not.toHaveAttribute("transform", before!);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  const opacity = await banner.evaluate((node) => node.style.opacity);
  await frame([], 326);
  await expect(banner).toHaveCSS("opacity", opacity);
  await frame([], 422);
  await expect(banner).toBeHidden();
});
