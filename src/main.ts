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
import { resultsPanel } from "./web/match-results.ts";
import { createHitFeedback } from "./web/hit-feedback.ts";
import { createCombatFeed } from "./web/combat-feedback.ts";
import { createField } from "./web/field.ts";
import { createInput, initialInputMode } from "./web/input.ts";
import { CHARACTERS, initialMatchSetup, MatchSeries, PLAYER_ID, RoundPreparation, RULES, showScreen, type CharacterId, type RuleId } from "./web/game-flow.ts";
import { settingsPanel, type InputMode } from "./web/settings.ts";

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = get("app");
const screens = {
  title: get("title-screen"), setup: get("setup-screen"), character: get("character-screen"),
  lobby: get("lobby-screen"), battle: app, result: get("result-screen"),
};
const lobbyStart = get<HTMLButtonElement>("lobby-start");
const lobbyReady = get<HTMLButtonElement>("lobby-ready");
const lobbyError = get("lobby-error");
let ready = false;
let rendererReady = false;
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
const preparationView = get("preparation");
const preparationTitle = get("preparation-heading");
const skipPreparation = get<HTMLButtonElement>("skip-preparation");
let preparation: RoundPreparation | undefined;
const headline = get("headline");
const mission = get("mission");
const start = get<HTMLButtonElement>("start");
const dialog = get<HTMLDialogElement>("settings");
const leaveDialog = get<HTMLDialogElement>("leave-dialog");
const life = new AbortController();
const results = resultsPanel(get("participant-results"), get<HTMLSelectElement>("result-round-select"), life.signal);
const touchView = {
  layer: get("touch-controls"),
  move: { base: get("stick"), knob: get("knob") },
  aim: { base: get("aim-stick"), knob: get("aim-knob") },
  deploy: get("touch-deploy"),
};
function siteHud(arena: Arena) {
  const host = get("sites");
  host.replaceChildren();
  host.style.setProperty("--site-count", String(arena.sites.length));
  return arena.sites.map(({ id }) => {
    const row = document.createElement("div");
    row.className = "site";
    row.dataset.owner = "neutral";
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
  touch: "左：移動 · 右：押すと自動照準、倒すと方向指定",
  gamepad: "左/右スティック 移動/照準 · RT/R1 攻撃 · 西ボタン 設置",
};
function announceMode(mode: InputMode) {
  app.dataset.inputMode = mode;
  display(get("input-hint"), hints[mode]);
}

let setup = initialMatchSetup(new URLSearchParams(location.search));
const selector = get<HTMLSelectElement>("map-select");
for (const { id, name } of arenas) selector.add(new Option(name, id));
selector.value = setup.arena.id;
const rule = get<HTMLSelectElement>("rule-select");
for (const [id, { label }] of Object.entries(RULES)) rule.add(new Option(label, id));
rule.value = setup.rule;
rule.addEventListener("change", () => {
  setup = { ...setup, rule: rule.value as RuleId };
}, { signal: life.signal });
function updateBriefing() {
  get("map-preview").replaceChildren(mapPreview(setup.arena));
  display(get("map-description"), setup.arena.description);
}
selector.addEventListener("change", () => {
  const arena = arenas.find(({ id }) => id === selector.value);
  if (!arena) return;
  setup = { ...setup, arena };
  updateBriefing();
}, { signal: life.signal });
updateBriefing();

const seconds = setup.roundSeconds;
if (seconds !== ROUND_SECONDS) display(get("briefing-mode"), `5対5 / テストラウンド ${seconds}秒`);

function showClock(remaining: number) {
  const value = Math.ceil(remaining);
  display(clock, `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`);
}
showClock(seconds);

let currentInput: ReturnType<typeof createInput> | undefined;
let series: MatchSeries | undefined;
let transition = false;
const settings = settingsPanel(dialog, (next) => {
  currentInput?.updateSettings(next);
  if (!currentInput) announceMode(next.mode === "auto" ? initialInputMode() : next.mode);
}, life.signal);
announceMode(settings.mode === "auto" ? initialInputMode() : settings.mode);

game.scene("briefing", () => {});

game.scene("match", (context) => {
  const match = series!;
  const arena = match.setup.arena;
  const intro = new RoundPreparation(match.rounds.length === 0);
  let finished = false;
  let playerHitAt = -Infinity;
  const sites = siteHud(arena);
  const input = createInput(game, context, settings, touchView, announceMode);
  const ai = createAI();
  const battle = new Battle(context.scene, atlas, match.setup.roundSeconds, (fighter, state) =>
    fighter.id === PLAYER_ID ? input.sample(fighter.position) : ai(fighter, state), arena, false, match.rounds.length + 1);
  const player = battle.fighters.find(({ id }) => id === PLAYER_ID)!;
  const feed = createCombatFeed(get("combat-feed"), player.id, player.team);
  const feedback = createHitFeedback(get("hit-marker"), get("damage-edge"), get("vitals"), player.id);
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
    display(get("blue-score"), 0);
    display(get("red-score"), 0);
    showClock(battle.remaining);
    showVitals("hp", player.hp);
    showVitals("shield", player.shield);
    get("respawn").hidden = true;
    const deployState = get("deploy-state");
    deployState.dataset.ready = "false";
    display(deployState, "拠点に近づくと設置可能");
    display(get("attack-state"), "攻撃待機");
    currentInput = input;
    preparation = intro;
    app.dataset.phase = intro.phase;
    preparationView.hidden = false;
    skipPreparation.hidden = false;
    display(preparationTitle, "ラウンド準備");
    const { blue, red } = match.wins;
    display(get("round-status"), match.setup.rule === "single"
      ? ""
      : `第${match.rounds.length + 1}ラウンド · 青 ${blue} — ${red} 赤`);
    display(get("preparation-time"), intro.remaining);
    preparationTitle.focus({ preventScroll: true });
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
      if (finished || intro.phase !== "combat") touchView.layer.hidden = true;
    };
    fog.mount();
    minimap.mount();
    roster.mount();
    roster.paint();
  });
  context.onDispose(() => {
    feed.dispose();
    feedback.dispose();
    fog.dispose();
    minimap.dispose();
    roster.dispose();
    if (currentInput === input) {
      currentInput = undefined;
      preparation = undefined;
      preparationView.hidden = true;
      updateCameraLayout = undefined;
      paintOverlay = undefined;
    }
  });

  context.onUpdate(() => {
    if (intro.phase !== "combat") {
      const phase = intro.advance();
      app.dataset.phase = phase;
      if (phase === "combat") {
        preparationView.hidden = true;
        battle.start();
        input.updateSettings(settings);
        game.element.focus({ preventScroll: true });
      } else {
        display(preparationTitle, phase === "preparation" ? "ラウンド準備" : "戦闘開始まで");
        display(get("preparation-time"), intro.remaining);
        if (phase === "countdown" && !skipPreparation.hidden) {
          skipPreparation.hidden = true;
          preparationTitle.focus({ preventScroll: true });
        }
      }
    }
    display(get("blue-score"), battle.scores.blue);
    display(get("red-score"), battle.scores.red);
    showClock(battle.remaining);
    showVitals("hp", player.hp);
    showVitals("shield", player.shield);
    const respawn = get("respawn");
    respawn.hidden = player.hp > 0 || battle.result !== null;
    if (!respawn.hidden) display(respawn, `撃破された · 復活まで ${Math.ceil((player.downUntil - battle.tick) / HZ)}秒`);
    const availableSite = battle.sites.find((site) => distance(player.position, site) <= SITE_RADIUS);
    const deploy = intro.phase === "combat" && player.hp > 0 && !!availableSite && !availableSite.device && availableSite.owner !== player.team;
    const deployState = get("deploy-state");
    deployState.dataset.ready = String(deploy);
    display(deployState, deploy ? `${availableSite.id}に装置を設置できる`
      : availableSite?.device ? `${availableSite.id} ${availableSite.device.contested || availableSite.device.abandoned ? "占領停止中" : "占領進行中"}`
        : "拠点に近づくと設置可能");
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
    if (battle.combatEvents.some((event) => event.kind === "damage" && event.attacker === player.id)) playerHitAt = battle.tick;
    const fired = battle.tick - playerHitAt <= Math.round(HZ * 0.22);
    feedback.update(battle.combatEvents, battle.tick);
    display(attack, player.hp <= 0 ? "攻撃不可" : fired ? "攻撃命中" : player.command.attack && !hasTarget ? "射程内に有効な対象なし"
      : battle.tick < player.attackAt ? "攻撃クールダウン" : hasTarget ? "攻撃対象を捕捉" : "攻撃待機");
    roster.paint();
    feed.update(battle.combatEvents, battle.tick);
    battle.sites.forEach(({ id, owner, device }, i) => {
      const { row, state, progress } = sites[i];
      row.dataset.owner = owner ?? "neutral";
      const supply = owner && arena.lanes.length
        ? battle.supply.connected[owner].has(id) ? "linked" : "cut" : "";
      if (row.dataset.supply !== supply) {
        row.dataset.supply = supply;
        row.title = supply === "linked" ? "本部に接続" : supply === "cut" ? "補給が途絶" : "";
      }
      const paused = !!device && (device.contested || device.abandoned > 0);
      const phase = !device ? "idle" : device.contested ? "contested" : device.abandoned ? "waiting" : device.progress ? "active" : "installed";
      row.dataset.capture = phase;
      const action = device?.contested ? "係争" : device?.abandoned ? "停止" : device?.progress ? "起動" : "設置";
      const status = device ? `${names[device.team]} ${action} ${Math.floor(100 * device.progress / ACTIVATE_TICKS)}%`
        : feed.captureStatus(id) ?? names[owner ?? "neutral"];
      display(state, status);
      const detail = device ? `${names[owner ?? "neutral"]} / ${status}` : status;
      if (state.title !== detail) state.title = detail;
      progress.hidden = !device;
      if (device) {
        progress.value = device.progress;
        progress.dataset.team = device.team;
        progress.dataset.paused = String(paused);
        progress.setAttribute("aria-valuetext", status);
      }
    });
    if (battle.result && !finished) {
      finished = true;
      touchView.layer.hidden = true;
      match.finishRound({ winner: battle.result, scores: battle.scores, participants: battle.participantStats() });
      void showResult(match);
    }
  });
});

function report(error: unknown) {
  console.error(error);
  lobbyError.textContent = "戦場を読み込めませんでした。ページを再読み込みしてください。";
  lobbyError.hidden = false;
  showScreen(screens, "lobby");
}

async function startMatch(next: MatchSeries) {
  if (transition) return;
  transition = true;
  start.disabled = lobbyStart.disabled = true;
  series = next;
  results.clear();
  get("round-results").replaceChildren();
  showScreen(screens, "battle");
  try {
    await game.changeScene("match");
    updateCameraLayout?.();
    paintOverlay?.();
  } catch (error) {
    await releaseBattle().catch(console.error);
    series = undefined;
    report(error);
  } finally {
    start.disabled = false;
    transition = false;
    updateReady();
  }
}

async function releaseBattle() {
  await game.changeScene("briefing");
  get("sites").replaceChildren();
  touchView.layer.hidden = true;
  delete app.dataset.phase;
  delete app.dataset.map;
}

async function showResult(match: MatchSeries) {
  transition = true;
  const winner = match.winner;
  const last = match.rounds.at(-1)!;
  const { blue, red } = match.wins;
  display(get("result-round"), winner === null ? `第${match.rounds.length}ラウンド終了` : "試合結果");
  const roundWinner = winner ?? last.winner;
  display(headline, roundWinner === "draw" ? "引き分け" : `${names[roundWinner]}チームの勝利`);
  const totals = match.scoreTotals;
  const score = `青 ${totals.blue} — ${totals.red} 赤`;
  display(mission, match.setup.rule === "single" ? score
    : `ラウンド勝利数　青 ${blue} — ${red} 赤 ｜ チーム累計スコア　${score}`);
  get("round-results").replaceChildren(...(match.setup.rule === "single" ? [] : match.rounds.map(({ winner, scores }) => {
    const row = document.createElement("li");
    row.textContent = `青 ${scores.blue} — ${scores.red} 赤 · ${winner === "draw" ? "引き分け" : `${names[winner]}の勝利`}`;
    return row;
  })));
  results.show(match);
  display(start, winner === null ? "次のラウンド" : "再戦");
  for (const button of [start, get<HTMLButtonElement>("result-title"), get<HTMLButtonElement>("result-setup")]) button.disabled = true;
  showScreen(screens, "result");
  try {
    await releaseBattle();
  } catch (error) {
    report(error);
  } finally {
    transition = false;
    for (const button of [start, get<HTMLButtonElement>("result-title"), get<HTMLButtonElement>("result-setup")]) button.disabled = false;
  }
}
const choices = get("character-choice");
const characterIds = Object.keys(CHARACTERS) as CharacterId[];
for (const id of characterIds) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "character";
  input.value = id;
  input.checked = id === setup.character;
  input.addEventListener("change", () => {
    if (input.checked) setup = { ...setup, character: id };
  }, { signal: life.signal });
  label.append(input, CHARACTERS[id]);
  choices.append(label);
}

const playerStatus = document.createElement("small");
for (const team of ["blue", "red"] as const) {
  const list = get(`lobby-${team}`);
  characterIds.forEach((_, slot) => {
    const row = document.createElement("li");
    const playerSlot = `${team}-${slot}` === PLAYER_ID;
    row.append(playerSlot ? document.createElement("strong") : document.createElement("span"));
    row.firstElementChild!.textContent = playerSlot ? "あなた" : `AI ${slot + 1}`;
    const status = playerSlot ? playerStatus : document.createElement("small");
    if (!playerSlot) status.textContent = "準備完了";
    row.append(status);
    list.append(row);
  });
}
function updateReady() {
  lobbyReady.setAttribute("aria-pressed", String(ready));
  lobbyReady.textContent = ready ? "準備を取り消す" : "準備完了";
  playerStatus.textContent = `${CHARACTERS[setup.character]} · ${ready ? "準備完了" : "準備中"}`;
  lobbyStart.disabled = !ready || !rendererReady || transition;
}
function openLobby() {
  ready = false;
  display(get("lobby-summary"), `${setup.arena.name} · ${RULES[setup.rule].label}`);
  updateReady();
  showScreen(screens, "lobby");
}
for (const [id, screen] of [
  ["solo", "setup"], ["setup-back", "title"], ["setup-next", "character"],
  ["character-back", "setup"], ["lobby-back", "character"],
] as const) get(id).addEventListener("click", () => showScreen(screens, screen), { signal: life.signal });
get("character-next").addEventListener("click", openLobby, { signal: life.signal });
lobbyReady.addEventListener("click", () => {
  ready = !ready;
  updateReady();
}, { signal: life.signal });
lobbyStart.addEventListener("click", () => {
  if (ready && rendererReady) void startMatch(new MatchSeries(setup));
}, { signal: life.signal });
skipPreparation.addEventListener("click", () => {
  preparation?.skipPreparation();
}, { signal: life.signal });
start.addEventListener("click", () => {
  if (!series) return;
  void startMatch(series.winner === null ? series : new MatchSeries(series.setup));
}, { signal: life.signal });
for (const [id, screen] of [["result-title", "title"], ["result-setup", "setup"]] as const) {
  get(id).addEventListener("click", () => {
    series = undefined;
    results.clear();
    get("round-results").replaceChildren();
    showScreen(screens, screen);
  }, { signal: life.signal });
}

get("leave-battle").addEventListener("click", () => {
  if (transition) return;
  game.pause();
  leaveDialog.returnValue = "";
  leaveDialog.showModal();
}, { signal: life.signal });
leaveDialog.addEventListener("close", async () => {
  if (leaveDialog.returnValue !== "leave") {
    resumeBattle();
    return;
  }
  transition = true;
  try {
    await releaseBattle();
    series = undefined;
    showScreen(screens, "title");
  } catch (error) {
    report(error);
  } finally {
    game.resume();
    transition = false;
  }
}, { signal: life.signal });
function resumeBattle() {
  game.resume();
  if (!app.hidden) (preparationView.hidden ? game.element : preparationTitle).focus({ preventScroll: true });
}
function openSettings() {
  if (transition || dialog.open) return;
  game.pause();
  dialog.showModal();
}
for (const id of ["open-settings", "title-settings"]) get(id).addEventListener("click", openSettings, { signal: life.signal });
dialog.addEventListener("close", resumeBattle, { signal: life.signal });
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

game.run("briefing").then(() => {
  rendererReady = true;
  updateReady();
}).catch((error: unknown) => {
  console.error(error);
  lobbyError.textContent = "戦場を読み込めませんでした。ページを再読み込みしてください。";
  lobbyError.hidden = false;
});
