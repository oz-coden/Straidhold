import {
  Action, defineActions, Game, GamepadBindings, GamepadButton, KeyboardBindings, KeyCode,
  type Point, type SceneContext, type Viewport,
} from "@simpludify/web";
import { toward } from "../rules/arena.ts";
import { ZERO, type Command } from "../rules/command.ts";
import type { InputMode, Settings } from "./settings.ts";

const Keyboard = defineActions({ move: Action.axis2D(), deploy: Action.button() });
const Touch = defineActions({ move: Action.axis2D(), fire: Action.button(), deploy: Action.button() });
const Pad = defineActions({ move: Action.axis2D(), aim: Action.axis2D(), fire: Action.button(), deploy: Action.button() });
const gameplayKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyE"]);
const hasDirection = (point: Point) => point.x !== 0 || point.y !== 0;
type MatchGame = Game<"briefing" | "match">;

export interface TouchView {
  layer: HTMLElement;
  stick: HTMLElement;
  knob: HTMLElement;
  fire: HTMLElement;
  deploy: HTMLElement;
}

const stickPosition = { x: 0.15, y: 0.75 };
function buttonPosition(view: Viewport, kind: "fire" | "deploy") {
  const radius = kind === "fire" ? 31 : 23;
  const fireX = view.x + view.width - Math.max(43, view.width * 0.12);
  return {
    radius,
    x: fireX - (kind === "fire" ? 0 : Math.min(74, view.width * 0.23)),
    y: view.y + Math.max(radius + 4, view.height * (kind === "fire" ? 0.73 : 0.49)),
  };
}

function buttonRegion(kind: "fire" | "deploy") {
  return {
    kind: "custom" as const,
    bounds(view: Viewport) {
      const { x, y, radius } = buttonPosition(view, kind);
      return { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 };
    },
    contains(point: Point, view: Viewport) {
      const { x, y, radius } = buttonPosition(view, kind);
      return Math.hypot(point.x - x, point.y - y) < radius;
    },
  };
}

function position(element: HTMLElement, center: Point, radius: number) {
  element.style.left = `${center.x}px`;
  element.style.top = `${center.y}px`;
  element.style.width = element.style.height = `${radius * 2}px`;
}

export function initialInputMode(): InputMode {
  return matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard";
}

export function createInput(game: MatchGame, context: SceneContext, initial: Settings, view: TouchView, notify: (mode: InputMode) => void) {
  const keyboard = context.actions(Keyboard, { move: KeyboardBindings.WASD, deploy: { keys: [KeyCode.E] } });
  const touch = context.actions(Touch);
  touch.keyboardEnabled = false;
  const pad = context.actions(Pad);
  pad.keyboardEnabled = false;
  const padSource = game.gamepads.bind(pad, {
    index: 0,
    deadZone: 0.23,
    bindings: {
      move: GamepadBindings.LeftStick,
      aim: GamepadBindings.RightStick,
      fire: { buttons: [GamepadButton.RightTrigger, GamepadButton.RightShoulder, GamepadButton.South] },
      deploy: { buttons: [GamepadButton.West] },
    },
  });
  let padIndex = 0;
  function assignPad() {
    const first = game.gamepads.devices.find((device) => device.standardMapping);
    if (first && first.index !== padIndex) {
      padIndex = first.index;
      padSource.assign(padIndex);
    }
  }
  game.gamepads.onChange(assignPad, context.scene);
  assignPad();

  const moveStick = context.virtualInput.stick(touch, Touch.move, {
    position: stickPosition,
    region: { kind: "rect", x: 0, y: 0.36, width: 0.46, height: 0.64 },
    visible: false,
  });
  const fireButton = context.virtualInput.button(touch, Touch.fire, {
    region: buttonRegion("fire"), direction: true, radius: 42, deadZone: 0.16, holdDelay: 0.12, visible: false,
  });
  const deployButton = context.virtualInput.button(touch, Touch.deploy, { region: buttonRegion("deploy"), visible: false });
  let mode: InputMode = initialInputMode();
  let settings = initial;
  let mouse: { clientX: number; clientY: number } | undefined;
  let lastMouse: Point | undefined;
  let mouseTravel = 0;
  let mouseHeld = false;
  let mouseTap = false;
  let touchTap: { aim: Point | null } | undefined;
  let touchHold = false;
  let touchFired = false;
  let touchAim: Point | null = null;
  let lastTouch = -Infinity;
  let padAim: Point | null = null;
  let padArmed = true;
  let padFrames = 0;

  function clearTransient() {
    mouseHeld = false;
    mouseTap = false;
    touchTap = undefined;
    touchHold = false;
    touchFired = false;
    touchAim = null;
    padAim = null;
  }

  function setMode(next: InputMode) {
    if (mode !== next) {
      clearTransient();
      if (mode === "gamepad") {
        padArmed = false;
        padFrames = 0;
      }
    }
    mode = next;
    moveStick.enabled = fireButton.enabled = deployButton.enabled = mode === "touch";
    view.layer.hidden = mode !== "touch";
    notify(mode);
  }

  function updateSettings(next: Settings) {
    settings = next;
    moveStick.mode = settings.stick;
    moveStick.radius = settings.size;
    moveStick.deadZone = settings.deadZone / 100;
    view.stick.style.opacity = String(settings.opacity / 100);
    setMode(settings.mode === "auto" ? mode : settings.mode);
    paint(false);
  }

  fireButton.onStart(() => { touchHold = false; touchFired = false; touchAim = null; });
  fireButton.onChange(({ direction }) => { touchAim = hasDirection(direction) ? direction : null; });
  fireButton.onHold(() => { touchHold = true; });
  fireButton.onCommit(({ direction }) => {
    if (!touchFired) touchTap = { aim: hasDirection(direction) ? direction : null };
    touchHold = false;
    touchAim = null;
  });
  fireButton.onCancel(() => { touchTap = undefined; touchHold = false; touchAim = null; });

  const signal = context.signal;
  // Switch mode before Simpludify routes the same pointerdown on the canvas host.
  const surface = game.element.parentElement!;
  surface.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      lastTouch = performance.now();
      if (settings.mode === "auto") setMode("touch");
      return;
    }
    if (event.pointerType !== "mouse") return;
    if (settings.mode === "auto") setMode("keyboard");
    mouse = event;
    if (event.button === 0 && mode === "keyboard") {
      mouseHeld = true;
      mouseTap = true;
    }
  }, { signal, capture: true });
  game.element.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    mouse = event;
    const next = { x: event.clientX, y: event.clientY };
    if (lastMouse) mouseTravel += Math.hypot(next.x - lastMouse.x, next.y - lastMouse.y);
    lastMouse = next;
    if (mouseTravel >= 18) {
      mouseTravel = 0;
      if (settings.mode === "auto" && performance.now() - lastTouch > 450) setMode("keyboard");
    }
  }, { signal });
  window.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse" && event.button === 0) mouseHeld = false;
  }, { signal });
  window.addEventListener("pointercancel", (event) => {
    if (event.pointerType === "mouse") mouseHeld = mouseTap = false;
  }, { signal });
  game.element.addEventListener("keydown", (event) => {
    if (settings.mode === "auto" && !event.repeat && gameplayKeys.has(event.code)) setMode("keyboard");
  }, { signal, capture: true });
  game.element.addEventListener("focusout", clearTransient, { signal });
  window.addEventListener("blur", clearTransient, { signal });
  window.addEventListener("resize", clearTransient, { signal });
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearTransient(); }, { signal });

  function paint(deployReady: boolean) {
    if (mode !== "touch") return;
    const viewport = game.viewport;
    const center = moveStick.center;
    const knob = moveStick.knob;
    position(view.stick, center, moveStick.radius);
    view.knob.style.transform = `translate(${knob.x - center.x}px, ${knob.y - center.y}px)`;
    const fire = buttonPosition(viewport, "fire");
    const deploy = buttonPosition(viewport, "deploy");
    position(view.fire, fire, fire.radius);
    position(view.deploy, deploy, deploy.radius);
    view.fire.dataset.active = String(fireButton.pressed);
    view.deploy.dataset.ready = String(deployReady);
  }

  function sample(player: Point): Command {
    const stick = pad.value(Pad.move);
    const aim = pad.value(Pad.aim);
    const button = pad.pressed(Pad.fire) || pad.pressed(Pad.deploy);
    const analog = Math.max(Math.hypot(stick.x, stick.y), Math.hypot(aim.x, aim.y));
    if (analog < 0.11 && !pad.value(Pad.fire) && !pad.value(Pad.deploy)) padArmed = true;
    padFrames = analog >= 0.29 ? padFrames + 1 : 0;
    if (settings.mode === "auto" && padArmed && (button || padFrames === 5)) setMode("gamepad");
    if (settings.mode === "auto" && mode === "gamepad" && !padSource.connected) setMode(initialInputMode());

    if (mode === "touch") {
      const held = touch.value(Touch.fire) && (touchHold || touchAim !== null);
      const tap = touchTap;
      touchTap = undefined;
      if (held) touchFired = true;
      return { move: touch.value(Touch.move), aim: held ? touchAim : tap?.aim ?? null, attack: held || !!tap, deploy: touch.pressed(Touch.deploy) };
    }
    if (mode === "gamepad") {
      if (hasDirection(aim)) padAim = aim;
      return { move: stick, aim: padAim, attack: pad.value(Pad.fire) || pad.pressed(Pad.fire), deploy: pad.pressed(Pad.deploy) };
    }
    const click = mouseHeld || mouseTap;
    mouseTap = false;
    const bounds = game.element.getBoundingClientRect();
    return {
      move: keyboard.value(Keyboard.move) ?? ZERO,
      aim: mouse && bounds.width > 0 && bounds.height > 0 ? toward(player, game.pointerToWorld(mouse)) : null,
      attack: click,
      deploy: keyboard.pressed(Keyboard.deploy),
    };
  }

  // Reapply after the renderer resolves the first viewport.
  context.onActivate(() => updateSettings(settings));
  updateSettings(initial);
  return { sample, paint, updateSettings };
}
