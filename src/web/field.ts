import { Actor, Renderable, Shape, Transform, type Game, type Point, type Scene } from "@simpludify/web";
import { distance, HQ, SITES, TEAMS, type Team } from "../rules/arena.ts";
import { ACTIVATE_TICKS, canSee, type Battle, type Fighter } from "../rules/battle.ts";

const colors = { blue: 0x5bcff6, red: 0xff817a, neutral: 0xa8b5bc };
const dark = 0x102331;
const white = 0xf1faff;

function shape(scene: Scene, point: Point, width: number, height: number, color: number, zIndex: number, geometry: Shape = Shape.Box, actor = scene.add(new Actor())) {
  const transform = actor.get(Transform.type) ?? actor.add(new Transform(point));
  const render = actor.add(new Renderable({ width, height, color, zIndex, source: { kind: "shape", shape: geometry } }));
  return { transform, render };
}

function move(sprite: { transform: Transform }, x: number, y: number) {
  sprite.transform.x = x;
  sprite.transform.y = y;
}

function addLabel(layer: HTMLElement, label: string, team?: Team) {
  const node = document.createElement("span");
  node.className = "map-label";
  node.textContent = label;
  if (team) node.dataset.team = team;
  layer.append(node);
  return node;
}

export function createField(game: Game<"briefing" | "match">, scene: Scene, labels: HTMLElement, battle?: Battle, player?: Fighter) {
  const elements: HTMLElement[] = [];
  const hqs = TEAMS.map((team) => {
    const point = HQ[team];
    shape(scene, point, 214, 62, colors[team], -7).render.opacity = 0.24;
    shape(scene, point, 212, 2, colors[team], -6).transform.y += team === "blue" ? 30 : -30;
    shape(scene, point, 63, 57, colors[team], -6, Shape.Hexagon).render.opacity = 0.55;
    const label = addLabel(labels, team === "blue" ? "青本部" : "赤本部", team);
    elements.push(label);
    return { point: { x: point.x, y: point.y + (team === "blue" ? 42 : -42) }, label };
  });
  const sites = SITES.map((site) => {
    const outer = shape(scene, site, 108, 108, colors.neutral, -6, Shape.Circle);
    outer.render.opacity = 0.29;
    shape(scene, site, 102, 102, 0x1b2e3d, -5, Shape.Circle).render.opacity = 0.83;
    const base = shape(scene, site, 58, 52, colors.neutral, -4, Shape.Hexagon);
    base.render.opacity = 0.55;
    shape(scene, site, 45, 40, dark, -3, Shape.Hexagon);
    const device = shape(scene, { x: site.x, y: site.y - 31 }, 11, 11, colors.neutral, -2, Shape.Hexagon);
    device.render.visible = false;
    const progress = shape(scene, { x: site.x, y: site.y + 30 }, 3, 3, white, -2);
    progress.render.visible = false;
    const label = addLabel(labels, site.id);
    elements.push(label);
    return { site, outer, base, device, progress, label };
  });
  const units = battle?.fighters.map((fighter) => {
    const body = shape(scene, fighter.position, 23, 23, colors[fighter.team], 5, Shape.Circle, fighter.actor);
    const core = shape(scene, fighter.position, 13, 13, dark, 6, Shape.Circle);
    const heading = shape(scene, fighter.position, 9, 9, white, 7, Shape.Triangle);
    const back = shape(scene, fighter.position, 31, 7, dark, 7);
    const hp = shape(scene, fighter.position, 28, 2.8, 0x84f0b5, 8);
    const shield = shape(scene, fighter.position, 28, 2.4, 0x65dfff, 8);
    return { fighter, body, core, heading, back, hp, shield };
  }) ?? [];
  const playerRing = shape(scene, HQ.blue, 35, 35, white, 3, Shape.Circle);
  const playerInset = shape(scene, HQ.blue, 30, 30, dark, 4, Shape.Circle);
  const targetRing = shape(scene, HQ.blue, 33, 33, 0xffc887, 3, Shape.Hexagon);
  const aimMarker = shape(scene, HQ.blue, 6, 7, white, 3, Shape.Triangle);
  for (const item of [playerRing, playerInset, targetRing, aimMarker]) item.render.visible = false;
  const tracers = battle ? Array.from({ length: 10 }, () => shape(scene, HQ.blue, 1, 2.8, white, 2)) : [];
  scene.onDispose(() => elements.forEach((element) => element.remove()));

  function project(node: HTMLElement, point: Point) {
    const screen = game.worldToScreen({ space: "world", ...point });
    node.style.left = `${screen.x}px`;
    node.style.top = `${screen.y}px`;
  }

  function paint() {
    for (const { point, label } of hqs) project(label, point);
    sites.forEach(({ site, label, base, outer, device, progress }, i) => {
      project(label, site);
      const state = battle?.sites[i];
      const color = colors[state?.owner ?? "neutral"];
      label.dataset.team = state?.owner ?? "neutral";
      base.render.color = outer.render.color = color;
      outer.render.opacity = state?.owner ? 0.43 : 0.29;
      device.render.visible = progress.render.visible = !!state?.device;
      if (state?.device) {
        device.render.color = progress.render.color = colors[state.device.team];
        progress.render.width = Math.max(1, 60 * state.device.progress / ACTIVATE_TICKS);
      }
    });
    if (!battle || !player) return;
    const visible = new Set(battle.fighters.filter((fighter) => fighter.team === player.team
      || battle.fighters.some((ally) => ally.team === player.team && canSee(ally, fighter))));
    for (const { fighter, body, core, heading, back, hp, shield } of units) {
      const show = visible.has(fighter) && fighter.hp > 0;
      for (const part of [body, core, heading, back, hp, shield]) part.render.visible = show;
      if (!show) continue;
      const { x, y } = fighter.position;
      body.render.color = battle.tick - fighter.hitAt < 6 ? white : colors[fighter.team];
      move(core, x, y);
      move(heading, x + fighter.facing.x * 9, y + fighter.facing.y * 9);
      heading.transform.rotation = Math.atan2(fighter.facing.y, fighter.facing.x) + Math.PI / 2;
      move(back, x, y - 19);
      hp.render.width = Math.max(0.1, 28 * fighter.hp / fighter.profile.hp);
      shield.render.width = Math.max(0.1, 28 * fighter.shield / fighter.profile.shield);
      shield.render.visible = fighter.shield > 0;
      move(hp, x - 14 + hp.render.width / 2, y - 17.5);
      move(shield, x - 14 + shield.render.width / 2, y - 21);
    }
    for (const ring of [playerRing, playerInset]) {
      ring.render.visible = player.hp > 0;
      move(ring, player.position.x, player.position.y);
    }
    const target = player.target;
    targetRing.render.visible = !!target && target.hp > 0 && visible.has(target);
    if (target) move(targetRing, target.position.x, target.position.y);
    const aim = player.command.aim;
    aimMarker.render.visible = !!aim && player.hp > 0;
    if (aim) {
      move(aimMarker, player.position.x + aim.x * 27, player.position.y + aim.y * 27);
      aimMarker.transform.rotation = Math.atan2(aim.y, aim.x) + Math.PI / 2;
    }
    const shots = battle.shots.filter(({ from, to }) => visible.has(from) && visible.has(to)).slice(-tracers.length);
    tracers.forEach((tracer, i) => {
      const shot = shots[i];
      tracer.render.visible = !!shot;
      if (!shot) return;
      const { from, to, tick } = shot;
      const a = from.position;
      const b = to.position;
      move(tracer, (a.x + b.x) / 2, (a.y + b.y) / 2);
      tracer.transform.rotation = Math.atan2(b.y - a.y, b.x - a.x);
      tracer.render.width = Math.max(1, distance(a, b));
      tracer.render.color = colors[from.team];
      tracer.render.opacity = Math.max(0.1, 1 - (battle.tick - tick) / 14);
    });
  }
  scene.onActivate(paint);
  scene.onUpdate(paint);
}
