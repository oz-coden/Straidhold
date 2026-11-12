import { Aspect, Camera, Game } from "@simpludify/web";
import "@simpludify/web/style.css";
import "./style.css";
import atlas from "./web/terrain.svg?url";
import { distance, HEIGHT, placeArena, SITES, WIDTH } from "./rules/arena.ts";
import { createAI } from "./rules/ai.ts";
import { ACTIVATE_TICKS, Battle, HZ, ROUND_SECONDS, SITE_RADIUS, STEP } from "./rules/battle.ts";
import { createField } from "./web/field.ts";
import { createInput, initialInputMode } from "./web/input.ts";
import { settingsPanel, type InputMode } from "./web/settings.ts";

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = get("app");
const game = new Game<"briefing" | "match">({
  parent: get("game"),
  resolution: { width: WIDTH, height: HEIGHT },
  aspect: Aspect.Fit,
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
const sites = SITES.map(({ id }) => {
  const row = document.createElement("div");
  row.className = "site";
  const title = document.createElement("strong");
  const state = document.createElement("span");
  const progress = document.createElement("progress");
  progress.max = ACTIVATE_TICKS;
  progress.setAttribute("aria-label", `${id}拠点の起動進捗`);
  progress.hidden = true;
  title.textContent = id;
  state.textContent = "中立";
  row.append(title, state, progress);
  get("sites").append(row);
  return { row, state, progress };
});

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

const param = new URLSearchParams(location.search).get("round");
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

game.scene("briefing", ({ scene }) => {
  placeArena(scene, atlas);
  createField(game, scene, get("map-labels"));
});

game.scene("match", (context) => {
  const input = createInput(game, context, settings, touchView, announceMode);
  const ai = createAI();
  const battle = new Battle(context.scene, atlas, seconds, (fighter, state) =>
    fighter.id === "blue-2" ? input.sample(fighter.position) : ai(fighter, state));
  const player = battle.fighters[2];
  createField(game, context.scene, get("map-labels"), battle, player);
  context.onActivate(() => {
    currentInput = input;
    active = true;
    resultShown = false;
    overlay.hidden = true;
    game.element.focus({ preventScroll: true });
  });
  context.onDispose(() => {
    if (currentInput === input) currentInput = undefined;
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
    const attack = get("attack-state");
    const fired = battle.shots.some(({ from }) => from === player);
    display(attack, player.hp <= 0 ? "攻撃不可" : fired ? "攻撃命中" : player.command.attack && !player.target ? "射程内に有効な対象なし"
      : battle.tick < player.attackAt ? "攻撃クールダウン" : player.target ? "攻撃対象を捕捉" : "攻撃待機");
    input.paint(deploy);
    battle.sites.forEach(({ owner, device }, i) => {
      const { row, state, progress } = sites[i];
      row.dataset.owner = owner ?? "neutral";
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
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  life.abort();
  game.dispose();
}, { signal: life.signal });
import.meta.hot?.dispose(() => {
  life.abort();
  game.dispose();
});

game.run("briefing").then(() => { start.disabled = false; }).catch(report);
