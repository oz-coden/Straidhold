import { Aspect, Camera, Game, type Point } from "@simpludify/web";
import "@simpludify/web/style.css";
import "./style.css";
import atlas from "./web/terrain.svg?url";
import { bushAt, distance, HEIGHT, WIDTH, type Arena } from "./rules/arena.ts";
import { arenas } from "./rules/maps.ts";
import { createAI } from "./rules/ai.ts";
import { TeamVision } from "./rules/vision.ts";
import { followCamera, matchViewport } from "./web/camera.ts";
import { createFog } from "./web/fog.ts";
import { createMinimap, mapPreview } from "./web/minimap.ts";
import { createRoster } from "./web/roster.ts";
import { ACTIVATE_TICKS, Battle, HZ, ROUND_SECONDS, SITE_RADIUS, STEP } from "./rules/battle.ts";
import { createField } from "./web/field.ts";
import { createInput, initialInputMode } from "./web/input.ts";
import { settingsPanel, type InputMode } from "./web/settings.ts";

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = get("app");
let updateCameraLayout: (() => void) | undefined;
let paintOverlay: (() => void) | undefined;
const game = new Game<"briefing" | "match">({
  parent: get("game"),
  resolution: { width: WIDTH, height: HEIGHT },
  aspect: Aspect.Adaptive,
  frames: {
    request: (step) => requestAnimationFrame((time) => {
      updateCameraLayout?.();
      step(time);
      paintOverlay?.();
    }),
    cancel: (id) => cancelAnimationFrame(id),
  },
  camera: new Camera(),
  fixedStep: { step: STEP, maxSteps: 6, maxFrameDelta: 0.1 },
  tokens: { background: "#080f18" },
});
const clock = get<HTMLTimeElement>("clock");
const overlay = get("overlay");
const headline = get("headline");
const mission = get("mission");
const start = get<HTMLButtonElement>("start");
const dialog = get<HTMLDialogElement>("settings");
const life = new AbortController();
const touchView = {
  layer: get("touch-controls"), stick: get("stick"), knob: get("knob"), fire: get("touch-fire"), deploy: get("touch-deploy"),
};
function siteHud(arena: Arena) {
  const host = get("sites");
  host.replaceChildren();
  host.style.setProperty("--site-count", String(arena.sites.length));
  return arena.sites.map(({ id }) => {
    const row = document.createElement("div");
    row.className = "site";
    const title = document.createElement("strong");
    const state = document.createElement("span");
    const progress = document.createElement("progress");
    progress.max = ACTIVATE_TICKS;
    progress.setAttribute("aria-label", `${id}拠点の起動進捗`);
    progress.hidden = true;
    title.className = "site-icon";
    title.textContent = id;
    state.textContent = "中立";
    row.append(title, state, progress);
    host.append(row);
    return { row, state, progress };
  });
}

const display = (node: HTMLElement, value: string | number) => {
  const text = String(value);
  if (node.textContent !== text) node.textContent = text;
};
function showVitals(id: "hp" | "shield", value: number) {
  const rounded = Math.ceil(value);
  get<HTMLMeterElement>(id).value = rounded;
  display(get(`${id}-value`), rounded);
}

const names = { blue: "青", red: "赤", neutral: "中立" };
const hints: Record<InputMode, string> = {
  keyboard: "WASD 移動 · 左クリック 攻撃 · E 設置",
  touch: "左スティック 移動 · 攻撃をドラッグして照準",
  gamepad: "左/右スティック 移動/照準 · RT/R1 攻撃 · 西ボタン 設置",
};
function announceMode(mode: InputMode) {
  app.dataset.inputMode = mode;
  display(get("input-hint"), hints[mode]);
}

const query = new URLSearchParams(location.search);
const selector = get<HTMLSelectElement>("map-select");
for (const { id, name } of arenas) selector.add(new Option(name, id));
let selected = arenas.find(({ id }) => id === query.get("map")) ?? arenas[0];
selector.value = selected.id;
function updateBriefing() {
  get("map-preview").replaceChildren(mapPreview(selected));
  display(get("map-description"), selected.description);
}
selector.addEventListener("change", () => {
  selected = arenas.find(({ id }) => id === selector.value) ?? arenas[0];
  updateBriefing();
}, { signal: life.signal });
updateBriefing();

const param = query.get("round");
const requested = Number(param);
const seconds = param && /^\d{1,3}$/.test(param) && requested >= 5 && requested <= ROUND_SECONDS
  ? requested
  : ROUND_SECONDS;
if (seconds !== ROUND_SECONDS) display(get("briefing-mode"), `5対5 / テストラウンド ${seconds}秒`);

function showClock(remaining: number) {
  const value = Math.ceil(remaining);
  display(clock, `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`);
}
showClock(seconds);

let currentInput: ReturnType<typeof createInput> | undefined;
let active = false;
let resultShown = false;
let transition = false;
const settings = settingsPanel(dialog, (next) => {
  currentInput?.updateSettings(next);
  if (!currentInput) announceMode(next.mode === "auto" ? initialInputMode() : next.mode);
}, life.signal);
announceMode(settings.mode === "auto" ? initialInputMode() : settings.mode);

game.scene("briefing", () => {});

game.scene("match", (context) => {
  const arena = selected;
  const sites = siteHud(arena);
  const input = createInput(game, context, settings, touchView, announceMode);
  const ai = createAI();
  const battle = new Battle(context.scene, atlas, seconds, (fighter, state) =>
    fighter.id === "blue-2" ? input.sample(fighter.position) : ai(fighter, state), arena);
  const player = battle.fighters[2];
  const vision = new TeamVision(battle.collisions, player.team, battle.fighters, arena);
  const fog = createFog(game, get("battlefield"), vision, arena);
  const minimap = createMinimap(game, get("battlefield"), battle, player, vision, fog.mask);
  const roster = createRoster(get("roster"), battle, player);
  let track: ((point: Point) => void) | undefined;
  let width = 0;
  let height = 0;
  let focus: Point = { x: player.position.x, y: player.position.y };
  let visionTick = -1;
  context.onUpdate(() => {
    if (visionTick === battle.tick) return;
    visionTick = battle.tick;
    vision.update(battle.tick);
    if (player.hp > 0) focus = player.position;
    // A defeated fighter stays at the defeat position until the respawn step.
    track?.(focus);
  });
  context.onActivate(() => {
    vision.update(battle.tick);
    visionTick = battle.tick;
  });
  const labels = createField(game, context.scene, get("map-labels"), battle, player, vision);
  context.onActivate(() => {
    currentInput = input;
    app.dataset.map = arena.id;
    get("terrain-state").hidden = !arena.lanes.length;
    updateCameraLayout = () => {
      const nextWidth = game.element.clientWidth;
      const nextHeight = game.element.clientHeight;
      if (nextWidth <= 0 || nextHeight <= 0 || (width === nextWidth && height === nextHeight)) return;
      width = nextWidth;
      height = nextHeight;
      const viewport = matchViewport(width, height);
      track = followCamera(game.camera, viewport, player.profile.vision, arena);
      track(focus);
      game.setViewport(viewport);
    };
    paintOverlay = () => {
      fog.paint();
      labels();
      minimap.paint();
      input.paint(get("deploy-state").dataset.ready === "true");
      if (resultShown) touchView.layer.hidden = true;
    };
    fog.mount();
    minimap.mount();
    roster.mount();
    roster.paint();
    active = true;
    resultShown = false;
    game.element.focus({ preventScroll: true });
  });
  context.onDispose(() => {
    fog.dispose();
    minimap.dispose();
    roster.dispose();
    if (currentInput === input) {
      currentInput = undefined;
      updateCameraLayout = undefined;
      paintOverlay = undefined;
    }
  });

  context.onUpdate(() => {
    display(get("blue-score"), battle.scores.blue);
    display(get("red-score"), battle.scores.red);
    showClock(battle.remaining);
    showVitals("hp", player.hp);
    showVitals("shield", player.shield);
    const respawn = get("respawn");
    respawn.hidden = player.hp > 0 || battle.result !== null;
    if (!respawn.hidden) display(respawn, `復活まで ${Math.ceil((player.downUntil - battle.tick) / HZ)}秒`);
    const availableSite = battle.sites.find((site) => distance(player.position, site) <= SITE_RADIUS);
    const deploy = player.hp > 0 && !!availableSite && !availableSite.device && availableSite.owner !== player.team;
    const deployState = get("deploy-state");
    deployState.dataset.ready = String(deploy);
    display(deployState, deploy ? `${availableSite.id}に装置を設置できる`
      : availableSite?.device ? `${availableSite.id}の装置が起動中` : "拠点に近づくと設置可能");
    const terrain = get("terrain-state");
    if (arena.lanes.length) {
      const lane = battle.supply.laneAt(player.position);
      const bush = bushAt(arena, player.position) !== 0;
      const speed = Math.round(100 * player.motion.speed / player.profile.speed);
      display(terrain, player.hp <= 0 ? "" : bush ? (battle.tick < player.revealedUntil ? "茂み · 攻撃で露出中" : "茂み · 隠蔽") : lane < 0 ? "ジャングル"
        : speed === 100 ? "レーン" : `レーン · 速度 ${speed}%`);
    }
    const attack = get("attack-state");
    const hasTarget = player.target && vision.shows(player.target);
    const fired = battle.shots.some(({ from }) => from === player);
    display(attack, player.hp <= 0 ? "攻撃不可" : fired ? "攻撃命中" : player.command.attack && !hasTarget ? "射程内に有効な対象なし"
      : battle.tick < player.attackAt ? "攻撃クールダウン" : hasTarget ? "攻撃対象を捕捉" : "攻撃待機");
    roster.paint();
    battle.sites.forEach(({ id, owner, device }, i) => {
      const { row, state, progress } = sites[i];
      row.dataset.owner = owner ?? "neutral";
      const supply = owner && arena.lanes.length
        ? battle.supply.connected[owner].has(id) ? "linked" : "cut" : "";
      if (row.dataset.supply !== supply) {
        row.dataset.supply = supply;
        row.title = supply === "linked" ? "本部に接続" : supply === "cut" ? "補給が途絶" : "";
      }
      display(state, device ? `${names[owner ?? "neutral"]} / ${names[device.team]}${device.contested ? " 係争" : " 起動"} ${Math.floor(100 * device.progress / ACTIVATE_TICKS)}%` : names[owner ?? "neutral"]);
      progress.hidden = !device;
      if (device) {
        progress.value = device.progress;
        progress.dataset.team = device.team;
      }
    });
    if (battle.result && !resultShown) {
      resultShown = true;
      active = false;
      touchView.layer.hidden = true;
      display(get("briefing-mode"), "ラウンド終了");
      display(headline, battle.result === "draw" ? "引き分け" : `${names[battle.result]}チームの勝利`);
      display(mission, `青 ${battle.scores.blue} — ${battle.scores.red} 赤`);
      display(start, "再試合");
      overlay.hidden = false;
      start.focus({ preventScroll: true });
    }
  });
});

function report(error: unknown) {
  console.error(error);
  display(mission, "戦場を読み込めませんでした。ページを再読み込みしてください。");
  overlay.hidden = false;
}

start.addEventListener("click", async () => {
  if (transition) return;
  transition = true;
  start.disabled = true;
  try {
    await game.changeScene("match");
    updateCameraLayout?.();
    paintOverlay?.();
    overlay.hidden = true;
  } catch (error) {
    report(error);
  } finally {
    start.disabled = false;
    transition = false;
  }
}, { signal: life.signal });
get("open-settings").addEventListener("click", () => {
  if (transition || dialog.open) return;
  game.pause();
  dialog.showModal();
}, { signal: life.signal });
dialog.addEventListener("close", () => {
  game.resume();
  if (active) game.element.focus({ preventScroll: true });
  if (resultShown) touchView.layer.hidden = true;
}, { signal: life.signal });
function dispose() {
  life.abort();
  updateCameraLayout = undefined;
  paintOverlay = undefined;
  game.dispose();
  get("map-labels").replaceChildren();
  touchView.layer.hidden = true;
}
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) dispose();
}, { signal: life.signal });
import.meta.hot?.dispose(dispose);

game.run("briefing").then(() => { start.disabled = false; }).catch(report);
