import {
  Action, defineActions, Game, GamepadBindings, GamepadButton, KeyboardBindings, KeyCode,
  type Point, type SceneContext, type Viewport, type VirtualStick,
} from "@simpludify/web";
import { toward } from "../rules/arena.ts";
import { CLASSES } from "../rules/classes.ts";
import type { Battle, Fighter } from "../rules/battle.ts";
import { aimSkill, radialSkillPoint, type SkillAim } from "./skill-aim.ts";
import { ZERO, type Command, type SkillOrder } from "../rules/command.ts";
import type { InputMode, Settings } from "./settings.ts";
import { touchAttack } from "./touch-attack.ts";

const Keyboard = defineActions({ move: Action.axis2D(), deploy: Action.button() });
const Touch = defineActions({ move: Action.axis2D(), aim: Action.axis2D(), deploy: Action.button() });
const Pad = defineActions({ move: Action.axis2D(), aim: Action.axis2D(), fire: Action.button(), deploy: Action.button(), north: Action.button(), shoulder: Action.button(), cancel: Action.button() });
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
  skill: HTMLButtonElement;
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

export function createInput(game: MatchGame, context: SceneContext, initial: Settings, view: TouchView, notify: (mode: InputMode) => void,
  player: Fighter, battle: Battle, combat: () => boolean) {
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
      north: { buttons: [GamepadButton.North] },
      shoulder: { buttons: [GamepadButton.LeftShoulder] },
      cancel: { buttons: [GamepadButton.East] },
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
  const ability = CLASSES[player.classId];
  let aiming = false;
  let pending: SkillOrder | undefined;
  let radial: Point | undefined;
  let pointer: { id: number; x: number; y: number } | undefined;

  const canSkill = () => combat() && player.hp > 0 && battle.abilities.cooldown(player) === 0;

  function cancelSkill() {
    aiming = false;
    radial = undefined;
    const id = pointer?.id;
    pointer = undefined;
    if (id !== undefined && view.skill.hasPointerCapture(id)) view.skill.releasePointerCapture(id);
  }

  function preview(): SkillAim | undefined {
    if (!aiming || !canSkill()) return;
    if (mode !== "keyboard") return aimSkill(battle, player, radial && radialSkillPoint(player, radial), true);
    const bounds = game.element.getBoundingClientRect();
    const clip = game.view.clip;
    const point = mouse && mouse.clientX >= bounds.left + clip.x && mouse.clientY >= bounds.top + clip.y
      && mouse.clientX < bounds.left + clip.x + clip.width && mouse.clientY < bounds.top + clip.y + clip.height
      ? game.pointerToWorld(mouse) : undefined;
    return aimSkill(battle, player, point);
  }

  function confirmSkill() {
    const order = preview()?.order;
    if (order) {
      pending = order;
      cancelSkill();
    }
  }

  function openSkill() {
    if (!canSkill()) return;
    if (ability.target === "self") pending = { kind: "self" };
    else aiming = true;
  }

  function takeSkill(): SkillOrder | undefined {
    const order = pending;
    pending = undefined;
    if (!canSkill()) {
      cancelSkill();
      return;
    }
    return order;
  }

  function clearTransient() {
    mouseHeld = false;
    mouseTap = false;
    padAim = null;
    pending = undefined;
    cancelSkill();
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
    if (mode === "keyboard" && aiming && (event.button === 0 || event.button === 2)) {
      event.preventDefault();
      if (event.button === 0) confirmSkill();
      else cancelSkill();
      return;
    }
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
    if (event.code === "Escape" && aiming) {
      cancelSkill();
      event.preventDefault();
      return;
    }
    if (event.repeat) return;
    if (settings.mode === "auto" && (gameplayKeys.has(event.code) || event.code === settings.skillKey)) setMode("keyboard");
    if (mode === "keyboard" && event.code === settings.skillKey) {
      event.preventDefault();
      if (aiming) cancelSkill();
      else openSkill();
    }
  }, { signal, capture: true });
  game.element.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });
  view.skill.addEventListener("pointerdown", (event) => {
    if (mode !== "touch" || !canSkill() || pointer) return;
    event.preventDefault();
    const { pointerId: id, clientX: x, clientY: y } = event;
    pointer = { id, x, y };
    view.skill.setPointerCapture(id);
    if (ability.target !== "self") openSkill();
  }, { signal });
  function updateSkillDrag(event: PointerEvent) {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    radial = Math.hypot(dx, dy) < 12 ? undefined : { x: dx / 64, y: dy / 64 };
  }
  view.skill.addEventListener("pointermove", updateSkillDrag, { signal });
  view.skill.addEventListener("pointerup", (event) => {
    if (pointer?.id !== event.pointerId) return;
    updateSkillDrag(event);
    if (ability.target === "self" && !radial) openSkill();
    else confirmSkill();
    cancelSkill();
  }, { signal });
  for (const name of ["pointercancel", "lostpointercapture"] as const) {
    view.skill.addEventListener(name, (event) => { if (pointer?.id === event.pointerId) cancelSkill(); }, { signal });
  }
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
    const surface = touchSurface();
    position(view.skill, { x: deploy.x, y: Math.min(surface.height - 23, deploy.y + 50) }, 22);
    view.skill.dataset.ready = String(canSkill());
  }

  function sample(): Command {
    const stick = pad.value(Pad.move);
    const aim = pad.value(Pad.aim);
    const skillAction = settings.skillPad === "north" ? Pad.north : Pad.shoulder;
    const skillPressed = pad.pressed(skillAction);
    const button = pad.pressed(Pad.fire) || pad.pressed(Pad.deploy) || skillPressed;
    const analog = Math.max(Math.hypot(stick.x, stick.y), Math.hypot(aim.x, aim.y));
    if (analog < 0.11 && !pad.value(Pad.fire) && !pad.value(Pad.deploy) && !pad.value(skillAction)) padArmed = true;
    padFrames = analog >= 0.29 ? padFrames + 1 : 0;
    if (settings.mode === "auto" && padArmed && (button || padFrames === 5)) setMode("gamepad");
    if (settings.mode === "auto" && mode === "gamepad" && !padSource.connected) setMode(initialInputMode());

    if (mode === "touch") {
      return {
        move: touch.value(Touch.move),
        ...touchAttack(aimStick.pressed, touch.value(Touch.aim)),
        deploy: touch.pressed(Touch.deploy),
        skill: takeSkill(),
      };
    }
    if (mode === "gamepad") {
      if (hasDirection(aim)) padAim = aim;
      if (aiming && hasDirection(aim)) radial = aim;
      if (pad.pressed(Pad.cancel)) cancelSkill();
      else if (skillPressed) {
        if (aiming) confirmSkill();
        else {
          openSkill();
          if (aiming) radial = hasDirection(aim) ? aim : padAim ?? player.facing;
        }
      }
      return { move: stick, aim: padAim, attack: pad.value(Pad.fire) || pad.pressed(Pad.fire),
        deploy: pad.pressed(Pad.deploy), skill: takeSkill() };
    }
    const click = mouseHeld || mouseTap;
    mouseTap = false;
    const bounds = game.element.getBoundingClientRect();
    return {
      move: keyboard.value(Keyboard.move) ?? ZERO,
      aim: mouse && bounds.width > 0 && bounds.height > 0 ? toward(player.position, game.pointerToWorld(mouse)) : null,
      attack: click,
      deploy: keyboard.pressed(Keyboard.deploy),
      skill: takeSkill(),
    };
  }

  // Reapply after the renderer resolves the first viewport.
  context.onActivate(() => updateSettings(settings));
  updateSettings(initial);
  return { sample, paint, updateSettings, preview, clearTransient };
}
