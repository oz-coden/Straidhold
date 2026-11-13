import { Actor, Renderable, Shape, Transform, type Game, type Point, type Scene } from "@simpludify/web";
import { distance, TEAMS, trainingArena, type Team } from "../rules/arena.ts";
import { ACTIVATE_TICKS, type Battle, type Fighter } from "../rules/battle.ts";

import type { TeamVision } from "../rules/vision.ts";

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

function addLabel(label: string, team?: Team) {
  const node = document.createElement("span");
  node.className = "map-label";
  node.textContent = label;
  if (team) node.dataset.team = team;
  return node;
}

export function createField(game: Game<"briefing" | "match">, scene: Scene, labels: HTMLElement, battle?: Battle, player?: Fighter, vision?: TeamVision<Fighter>) {
  const elements: HTMLElement[] = [];
  const arena = battle?.arena ?? trainingArena;
  const supplyMarks = arena.lanes.map(({ a, b, length }) => {
    const mark = shape(scene, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, length, 5, colors.neutral, -8);
    mark.transform.rotation = Math.atan2(b.y - a.y, b.x - a.x);
    mark.render.visible = false;
    return mark;
  });
  let supplyRevision = -1;
  const hqs = TEAMS.map((team) => {
    const point = arena.hq[team];
    shape(scene, point, 214, 62, colors[team], -7).render.opacity = 0.24;
    shape(scene, point, 212, 2, colors[team], -6).transform.y += team === "blue" ? 30 : -30;
    shape(scene, point, 63, 57, colors[team], -6, Shape.Hexagon).render.opacity = 0.55;
    const label = addLabel(team === "blue" ? "青本部" : "赤本部", team);
    elements.push(label);
    return { point: { x: point.x, y: point.y + (team === "blue" ? 42 : -42) }, label };
  });
  const sites = arena.sites.map((site) => {
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
    const label = addLabel(site.id);
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
  const playerRing = shape(scene, arena.hq.blue, 35, 35, white, 3, Shape.Circle);
  const playerInset = shape(scene, arena.hq.blue, 30, 30, dark, 4, Shape.Circle);
  const targetRing = shape(scene, arena.hq.blue, 33, 33, 0xffc887, 3, Shape.Hexagon);
  const aimMarker = shape(scene, arena.hq.blue, 6, 7, white, 3, Shape.Triangle);
  for (const item of [playerRing, playerInset, targetRing, aimMarker]) item.render.visible = false;
  const tracers = battle ? Array.from({ length: 10 }, () => shape(scene, arena.hq.blue, 1, 2.8, white, 2)) : [];
  scene.onDispose(() => elements.forEach((element) => element.remove()));

  scene.onActivate(() => labels.append(...elements));

  function project(node: HTMLElement, point: Point, clip: (typeof game.view)["clip"]) {
    const screen = game.worldToScreen({ space: "world", ...point });
    node.hidden = screen.x < clip.x || screen.y < clip.y || screen.x >= clip.x + clip.width || screen.y >= clip.y + clip.height;
    if (node.hidden) return;
    node.style.left = `${screen.x}px`;
    node.style.top = `${screen.y}px`;
  }

  let previousView = null as typeof game.view | null;
  function projectLabels() {
    const view = game.view;
    if (view === previousView) return;
    previousView = view;
    for (const { point, label } of hqs) project(label, point, view.clip);
    for (const { site, label } of sites) project(label, site, view.clip);
  }

  function paint() {
    if (battle && supplyRevision !== battle.supply.revision) {
      supplyRevision = battle.supply.revision;
      supplyMarks.forEach(({ render }, i) => {
        const owner = battle.supply.lanes[i];
        render.visible = owner !== null;
        if (owner) render.color = colors[owner];
        render.opacity = 0.50;
      });
    }
    sites.forEach(({ site, label, base, outer, device, progress }, i) => {
      const state = battle?.sites[i];
      const color = colors[state?.owner ?? "neutral"];
      label.dataset.team = state?.owner ?? "neutral";
      const linked = state?.owner && battle?.supply.connected[state.owner].has(state.id);
      const text = linked ? `${site.id} ⇆` : state?.owner && arena.lanes.length ? `${site.id} ×` : site.id;
      if (label.textContent !== text) label.textContent = text;
      base.render.color = outer.render.color = color;
      outer.render.opacity = state?.owner ? 0.43 : 0.29;
      device.render.visible = progress.render.visible = !!state?.device;
      if (state?.device) {
        device.render.color = progress.render.color = colors[state.device.team];
        progress.render.width = Math.max(1, 60 * state.device.progress / ACTIVATE_TICKS);
      }
    });
    if (!battle || !player || !vision) return;
    for (const { fighter, body, core, heading, back, hp, shield } of units) {
      const show = vision.shows(fighter);
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
    targetRing.render.visible = !!target && vision.shows(target);
    if (target && targetRing.render.visible) move(targetRing, target.position.x, target.position.y);
    const aim = player.command.aim;
    aimMarker.render.visible = !!aim && player.hp > 0;
    if (aim && player.hp > 0) {
      move(aimMarker, player.position.x + aim.x * 27, player.position.y + aim.y * 27);
      aimMarker.transform.rotation = Math.atan2(aim.y, aim.x) + Math.PI / 2;
    }
    const shots = battle.shots.filter(({ from, to, origin, impact }) =>
      vision.shows(from) && vision.shows(to) && vision.sees(origin) && vision.sees(impact)).slice(-tracers.length);
    tracers.forEach((tracer, i) => {
      const shot = shots[i];
      tracer.render.visible = !!shot;
      if (!shot) return;
      const { from, origin: a, impact: b, tick } = shot;
      move(tracer, (a.x + b.x) / 2, (a.y + b.y) / 2);
      tracer.transform.rotation = Math.atan2(b.y - a.y, b.x - a.x);
      tracer.render.width = Math.max(1, distance(a, b));
      tracer.render.color = colors[from.team];
      tracer.render.opacity = Math.max(0.1, 1 - (battle.tick - tick) / 14);
    });
  }
  scene.onActivate(paint);
  let paintedTick = battle?.tick;
  scene.onUpdate(() => {
    if (battle?.tick === paintedTick) return;
    paintedTick = battle?.tick;
    paint();
  });
  return projectLabels;
}
