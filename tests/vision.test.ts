import assert from "node:assert/strict";
import { test } from "node:test";
import { CollisionWorld, Engine, Scene } from "@simpludify/core";
import { placeArena } from "../src/rules/arena.ts";
import { Battle, recruit, selectTarget, STEP } from "../src/rules/battle.ts";
import { IDLE } from "../src/rules/command.ts";
import { seesPoint, sightOutline, TeamVision, type VisionUnit } from "../src/rules/vision.ts";

function arena(t: { after(fn: () => void): void }) {
  const scene = new Scene("terrain");
  t.after(() => scene.dispose());
  const collisions = new CollisionWorld(scene);
  placeArena(scene, "terrain.svg");
  return collisions;
}

const source: VisionUnit = { team: "blue", hp: 100, profile: { vision: 235 }, position: { x: 320, y: 272 } };

test("sight is circular, inclusive at the limit, and blocked by the same walls as combat", (t) => {
  const collisions = arena(t);
  const corridor = { ...source, position: { x: 480, y: 272 } };
  assert.equal(seesPoint(collisions, corridor, { x: 480, y: 37 }), true);
  assert.equal(seesPoint(collisions, corridor, { x: 480, y: 36.99 }), false);
  assert.equal(seesPoint(collisions, source, { x: 340, y: 272 }), true);
  assert.equal(seesPoint(collisions, source, { x: 425, y: 272 }), false);
  assert.equal(seesPoint(collisions, { ...source, hp: 0 }, source.position), false);
});

test("the deterministic visual outline stops at the wall and follows its corners", (t) => {
  const collisions = arena(t);
  const outline = sightOutline(collisions, source.position, source.profile.vision);
  assert.deepEqual(outline, sightOutline(collisions, source.position, source.profile.vision));
  assert.ok(outline.some(({ x, y }) => Math.abs(x - 352) < 1e-7 && Math.abs(y - 272) < 1e-7));
  function contains(x: number, y: number) {
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const a = outline[i];
      const b = outline[j];
      if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
    }
    return inside;
  }
  for (const point of [{ x: 340, y: 272 }, { x: 425, y: 272 }, { x: 423, y: 241 }, { x: 318, y: 44 }]) {
    assert.equal(contains(point.x, point.y), seesPoint(collisions, source, point), JSON.stringify(point));
  }
});

test("both teams share only living allies' sight and invalidate hidden enemy display on the same update", (t) => {
  const collisions = arena(t);
  const blue = { ...source };
  const scout = { ...source, position: { x: 460, y: 272 } };
  const red: VisionUnit = { ...source, team: "red", position: { x: 425, y: 272 } };
  const units = [blue, scout, red];
  const blueVision = new TeamVision(collisions, "blue", units);
  const redVision = new TeamVision(collisions, "red", units);
  blueVision.update();
  redVision.update();
  assert.equal(blueVision.shows(blue), true);
  assert.equal(blueVision.shows(red), true);
  assert.equal(redVision.shows(blue), false);
  assert.equal(redVision.shows(scout), true);
  const revision = blueVision.outlineRevision;
  blueVision.update();
  assert.equal(blueVision.outlineRevision, revision);

  scout.hp = 0;
  blueVision.update();
  redVision.update();
  assert.equal(blueVision.shows(red), false);
  assert.equal(blueVision.shows(scout), false);
  assert.equal(redVision.shows(scout), false);
  assert.ok(blueVision.outlineRevision > revision);
  const visibleOutlines: unknown[] = [];
  blueVision.visitOutlines((outline) => visibleOutlines.push(outline));
  assert.equal(visibleOutlines.length, 1);

  scout.hp = 100;
  scout.position = { x: 480, y: 460 };
  Object.assign(red.position, { x: 480, y: 415 });
  blueVision.update();
  assert.equal(blueVision.shows(red), true);
  Object.assign(red.position, { x: 480, y: 100 });
  blueVision.update();
  assert.equal(blueVision.shows(red), false);
});

test("a shared contact behind cover does not grant a target or damage; shots record positions at impact", () => {
  const engine = new Engine();
  const battle = new Battle(engine.scene, "terrain.svg", 10, (unit) => ({ ...IDLE, attack: unit.id === "blue-2" }));
  const [scout, player, enemy] = [battle.fighters[1], battle.fighters[2], battle.fighters[7]];
  Object.assign(player.position, source.position);
  Object.assign(scout.position, { x: 460, y: 272 });
  Object.assign(enemy.position, { x: 425, y: 272 });
  const vision = new TeamVision(battle.collisions, "blue", battle.fighters);
  engine.step(STEP);
  vision.update();
  assert.equal(vision.shows(enemy), true);
  assert.equal(selectTarget(battle.collisions, player, [enemy], null), undefined);
  assert.equal(enemy.shield, recruit.shield);

  Object.assign(player.position, { x: 470, y: 355 });
  engine.step(STEP);
  const shot = battle.shots.find(({ from, to }) => from === player && to === enemy);
  assert.ok(shot);
  const impact = { ...shot.impact };
  enemy.position.x += 7;
  assert.deepEqual(shot.impact, impact);
  engine.dispose();
});
