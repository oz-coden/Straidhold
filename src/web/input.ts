import {
  Action, defineActions, Game, GamepadBindings, GamepadButton, KeyboardBindings, KeyCode,
  type Point, type SceneContext, type Viewport, type VirtualStick,
} from "@simpludify/web";
import { toward } from "../rules/arena.ts";
import { ZERO, type Command } from "../rules/command.ts";
import type { InputMode, Settings } from "./settings.ts";
import { touchAttack } from "./touch-attack.ts";

const Keyboard = defineActions({ move: Action.axis2D(), deploy: Action.button() });
const Touch = defineActions({ move: Action.axis2D(), aim: Action.axis2D(), deploy: Action.button() });
const Pad = defineActions({ move: Action.axis2D(), aim: Action.axis2D(), fire: Action.button(), deploy: Action.button() });
const gameplayKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyE"]);
const hasDirection = (point: Point) => point.x !== 0 || point.y !== 0;
type MatchGame = Game<"briefing" | "match">;

interface StickView {
  base: HTMLElement;
  knob: HTMLElement;
}

export interface TouchView {
  layer: HTMLElement;
  move: StickView;
  aim: StickView;
  deploy: HTMLElement;
}

function stickRegion(surface: () => Viewport, side: "left" | "right") {
  return {
    kind: "custom" as const,
    bounds() {
      const { width, height } = surface();
      return { x: side === "left" ? 0 : width * 0.65, y: height * 0.46, width: width * 0.35, height: height * 0.54 };
    },
    contains: () => true,
  };
}

function deployPosition({ width, height }: Viewport) {
  const radius = 23;
  const x = Math.min(width * 0.65 - radius, Math.max(width * 0.5, width * 0.825 - 106));
  return { x, y: Math.max(radius + 4, height * 0.55), radius };
}

function deployRegion(surface: () => Viewport) {
  return {
    kind: "custom" as const,
    bounds() {
      const { x, y, radius } = deployPosition(surface());
      return { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 };
    },
    contains(point: Point) {
      const { x, y, radius } = deployPosition(surface());
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

  // Keep touch targets on the full host even when the camera view has side gutters.
  const touchSurface = () => ({
    x: 0, y: 0, width: game.element.clientWidth, height: game.element.clientHeight,
  });
  const moveStick = context.virtualInput.stick(touch, Touch.move, { region: stickRegion(touchSurface, "left"), visible: false });
  const aimStick = context.virtualInput.stick(touch, Touch.aim, { region: stickRegion(touchSurface, "right"), visible: false });
  const deployButton = context.virtualInput.button(touch, Touch.deploy, { region: deployRegion(touchSurface), visible: false });
  let mode: InputMode = initialInputMode();
  let settings = initial;
  let mouse: { clientX: number; clientY: number } | undefined;
  let lastMouse: Point | undefined;
  let mouseTravel = 0;
  let mouseHeld = false;
  let mouseTap = false;
  let lastTouch = -Infinity;
  let padAim: Point | null = null;
  let padArmed = true;
  let padFrames = 0;

  function clearTransient() {
    mouseHeld = false;
    mouseTap = false;
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
    moveStick.enabled = aimStick.enabled = deployButton.enabled = mode === "touch";
    view.layer.hidden = mode !== "touch";
    notify(mode);
  }

  function updateSettings(next: Settings) {
    settings = next;
    moveStick.mode = settings.stick;
    aimStick.mode = settings.aimStick;
    for (const stick of [moveStick, aimStick]) {
      stick.radius = settings.size;
      stick.deadZone = settings.deadZone / 100;
    }
    view.layer.style.setProperty("--stick-opacity", String(settings.opacity / 100));
    setMode(settings.mode === "auto" ? mode : settings.mode);
    paint(false);
  }

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

  function paintStick(stick: VirtualStick, view: StickView) {
    const { center, knob } = stick;
    position(view.base, center, stick.radius);
    view.knob.style.transform = `translate(${knob.x - center.x}px, ${knob.y - center.y}px)`;
    view.base.dataset.active = String(stick.pressed);
  }

  function paint(deployReady: boolean) {
    if (mode !== "touch") return;
    paintStick(moveStick, view.move);
    paintStick(aimStick, view.aim);
    const deploy = deployPosition(touchSurface());
    position(view.deploy, deploy, deploy.radius);
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
      return {
        move: touch.value(Touch.move),
        ...touchAttack(aimStick.pressed, touch.value(Touch.aim)),
        deploy: touch.pressed(Touch.deploy),
      };
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
