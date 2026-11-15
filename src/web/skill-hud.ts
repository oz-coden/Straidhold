import type { Game, Point } from "@simpludify/web";
import { distance } from "../rules/arena.ts";
import { HZ, type Battle, type Fighter } from "../rules/battle.ts";
import { EFFECT_IDS } from "../rules/class-abilities.ts";
import { CLASSES } from "../rules/classes.ts";
import type { TeamVision } from "../rules/vision.ts";
import { participantLabel } from "./combat-feedback.ts";
import type { InputMode, Settings } from "./settings.ts";
import type { SkillAim } from "./skill-aim.ts";

const effectLabels: Readonly<Record<string, string>> = {
  [EFFECT_IDS.surge]: "⚔ 与ダメージ",
  [EFFECT_IDS.tank]: "◆ 被ダメージ軽減",
  [EFFECT_IDS.slow]: "▧ 移動減速",
  [EFFECT_IDS.debuff]: "▧ デバフ強化",
  [EFFECT_IDS.buff]: "✚ バフ強化",
};
const seconds = (ticks: number) => `${Math.ceil(ticks / HZ)}秒`;
const setText = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };

export function createSkillHud(
  game: Game<"briefing" | "match">, battle: Battle, player: Fighter, vision: TeamVision<Fighter>,
  world: HTMLElement, name: HTMLElement, state: HTMLElement, status: HTMLElement, button: HTMLButtonElement,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const ability = CLASSES[player.classId];
  setText(name, `${ability.name} · ${ability.icon} ${ability.active}`);
  setText(button, ability.icon);
  button.setAttribute("aria-label", ability.target === "self" ? ability.active : `${ability.active}（ドラッグで指定）`);

  function paintHud(preview: SkillAim | undefined, combat: boolean, mode: InputMode, settings: Settings) {
    const cooldown = battle.abilities.cooldown(player);
    const key = mode === "keyboard" ? settings.skillKey.slice(-1)
      : mode === "gamepad" ? settings.skillPad === "north" ? "Y / △" : "LB / L1" : "";
    const ready = combat && player.hp > 0 && cooldown === 0;
    state.dataset.ready = String(ready);
    button.dataset.aiming = String(!!preview);
    setText(state, !combat ? "準備中" : player.hp <= 0 ? "発動不可" : cooldown ? `CD ${seconds(cooldown)}`
      : preview ? (preview.order ? "確定可能" : ability.target === "ally" ? "味方を指定" : "地点を指定")
      : `発動可能${key ? ` [${key}]` : ""}`);
    button.title = state.textContent ?? "";
    const effects = combat && player.hp > 0 ? battle.abilities.effects.effective(player)
      .filter(({ id, endsAt }) => effectLabels[id] && (endsAt !== Infinity || id === EFFECT_IDS.tank))
      .map(({ id, strength, endsAt }) =>
        `${effectLabels[id]} ${Math.round(100 * strength)}%${endsAt === Infinity ? "" : ` ${seconds(endsAt - battle.tick)}`}`) : [];
    const barrier = battle.abilities.barrier(player);
    if (barrier) effects.push(`✚ バリア ${Math.ceil(barrier.capacity)} · ${seconds(barrier.endsAt - battle.tick)}`);
    const guard = battle.abilities.protecting(player);
    if (guard) effects.push(`◆ 護衛先 ${participantLabel(guard.target.id)} · ${seconds(guard.endsAt - battle.tick)}`);
    for (const { source, endsAt } of battle.abilities.protectors(player)) {
      effects.push(`◆ 護衛中 ${participantLabel(source.id)} · ${seconds(endsAt - battle.tick)}`);
    }
    setText(status, effects.join("　"));
    status.hidden = effects.length === 0;
  }

  const screen = (point: Point) => game.worldToScreen({ space: "world", ...point });
  function circle(point: Point, radius: number, color: string, fill: string, dash: number[] = []) {
    const { x, y } = screen(point);
    const r = Math.abs(screen({ x: point.x + radius, y: point.y }).x - x);
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = color;
    context.setLineDash(dash);
    context.stroke();
  }
  function mark(point: Point, glyph: string, color: string, offset = 0) {
    const { x, y } = screen(point);
    context.fillStyle = color;
    context.strokeStyle = "#101622";
    context.setLineDash([]);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "bold 14px system-ui";
    context.strokeText(glyph, x, y + offset);
    context.fillText(glyph, x, y + offset);
  }
  function link(from: Point, to: Point) {
    const a = screen(from), b = screen(to);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.strokeStyle = "#ffda97ba";
    context.setLineDash([5, 4]);
    context.stroke();
  }

  function paintWorld(preview: SkillAim | undefined, combat: boolean) {
    const { width, height } = game.element.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    const ratio = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(width * ratio), h = Math.round(height * ratio);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!combat) return;
    const { clip } = game.view;
    context.save();
    context.beginPath();
    context.rect(clip.x, clip.y, clip.width, clip.height);
    context.clip();
    context.lineWidth = 1.5;
    for (const { target } of battle.abilities.effects.all()) {
      if (typeof target === "string" || !("center" in target)) continue;
      const hostile = target.team === player.team;
      if (hostile && !vision.sees(target.center) && (player.hp <= 0 || distance(player.position, target.center) > target.radius)) continue;
      const color = hostile ? "#ffac96b0" : "#b6a8f4b0";
      circle(target.center, target.radius, color, hostile ? "#f7765719" : "#ac8aff19", [5, 4]);
      mark(target.center, CLASSES.control.icon, color);
    }
    for (const fighter of battle.fighters) {
      if (!vision.shows(fighter)) continue;
      if (battle.abilities.barrier(fighter)) circle(fighter.position, 18, "#9ef8dc", "#8bf7d021");
      const guard = battle.abilities.protecting(fighter);
      if (guard && vision.shows(guard.target)) {
        link(fighter.position, guard.target.position);
        mark(guard.target.position, CLASSES.tank.icon, "#ffda97", 20);
      }
      const contact = battle.abilities.effects.effective(fighter, "outgoingDamage").some(({ id }) => id === EFFECT_IDS.surge);
      if (contact) mark(fighter.position, CLASSES.assassin.icon, "#ffe5b2", 19);
    }
    for (const pulse of battle.abilities.scans()) {
      if (pulse.team !== player.team) continue;
      const progress = 1 - (pulse.endsAt - battle.tick) / (HZ / 2);
      circle(pulse.origin, Math.max(1, CLASSES.recon.radius * progress), "#a7f0ffcc", "#78e1ff09");
    }
    const snapshots = battle.abilities.recon(player.team);
    for (const fighter of battle.fighters) {
      if (vision.shows(fighter)) continue;
      const snapshot = snapshots.get(fighter.id);
      if (!snapshot) continue;
      mark(snapshot.position, CLASSES.recon.icon, "#a7f0ff");
    }
    if (preview && ability.target !== "self") {
      const color = preview.order ? "#c1f7eb" : "#f6c2a6";
      circle(player.position, ability.range, "#9ddaff90", "#8fd6ff0a", [4, 5]);
      if (preview.ally) circle(preview.ally.position, 23, color, "#b2fcea24");
      else if (preview.point) circle(preview.point, ability.target === "point" ? ability.radius : 9, color, "#a9f4ff16", [4, 4]);
    }
    context.restore();
  }

  return {
    mount() { world.append(canvas); },
    paint(preview: SkillAim | undefined, combat: boolean, mode: InputMode, settings: Settings) {
      paintHud(preview, combat, mode, settings);
      paintWorld(preview, combat);
    },
    dispose() { canvas.remove(); },
  };
}
