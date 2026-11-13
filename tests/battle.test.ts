import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine, Scene } from "@simpludify/core";
import { castTerrain, distance, hasClearance, HQ, RADIUS, route } from "../src/rules/arena.ts";
import { createAI } from "../src/rules/ai.ts";
import { ABANDON_TICKS, ACTIVATE_TICKS, Battle, HZ, recruit, ROUND_SECONDS, selectTarget, STEP } from "../src/rules/battle.ts";
import { IDLE, validate, type Command } from "../src/rules/command.ts";

function match(seconds = 60) {
  const engine = new Engine();
  const orders = new Map<string, Command>();
  const battle = new Battle(engine.scene, "terrain.svg", seconds, (fighter) => orders.get(fighter.id) ?? IDLE);
  const step = (count = 1) => {
    for (let i = 0; i < count; i++) engine.step(STEP);
  };
  return { engine, battle, orders, step };
}

test("creates two teams of five and applies the same validated command to every slot", () => {
  const { engine, battle, orders, step } = match();
  assert.equal(battle.fighters.length, 10);
  assert.equal(battle.fighters.filter(({ team }) => team === "blue").length, 5);
  assert.equal(battle.fighters.filter(({ team }) => team === "red").length, 5);
  assert.equal(new Set(battle.fighters.map(({ id }) => id)).size, 10);
  const players = [battle.fighters[2], battle.fighters[7]];
  for (const player of players) orders.set(player.id, { ...IDLE, move: { x: 8, y: 0 } });
  const starts = players.map((player) => player.position.x);
  step(10);
  players.forEach((player, i) => assert.ok(Math.abs(player.position.x - starts[i] - recruit.speed / 6) < 1e-7));
  assert.deepEqual(validate({ ...IDLE, move: { x: NaN, y: 1 }, aim: { x: 0, y: 0 } }), IDLE);
  engine.dispose();
});

test("movement collides with Tilemap walls and route finds a detour with clearance", () => {
  const { engine, battle, orders, step } = match();
  const player = battle.fighters[2];
  Object.assign(player.position, { x: 320, y: 272 });
  orders.set(player.id, { ...IDLE, move: { x: 1, y: 0 } });
  step(90);
  assert.ok(Math.abs(player.position.x - (352 - RADIUS)) < 0.01, `wall contact x=${player.position.x}`);
  assert.ok(castTerrain(battle.collisions, { x: 320, y: 272 }, { x: 450, y: 272 }));
  const start = { x: 320, y: 272 };
  const goal = { x: 450, y: 272 };
  const path = route(start, goal);
  assert.ok(path.length > 1);
  assert.deepEqual(path.at(-1), goal);
  path.forEach((point, i) => assert.ok(hasClearance(i === 0 ? start : path[i - 1], point, RADIUS)));
  engine.dispose();
});

test("aim selects a valid single enemy, retains it across small changes and ignores allies, cover, dead and distant targets", () => {
  const { engine, battle, step } = match();
  const player = battle.fighters[2];
  const ally = battle.fighters[1];
  const [front, nearby, far, dead, behind] = battle.fighters.slice(5);
  Object.assign(player.position, { x: 320, y: 224 });
  Object.assign(ally.position, { x: 322, y: 230 });
  Object.assign(front.position, { x: 415, y: 223 });
  Object.assign(nearby.position, { x: 400, y: 232 });
  Object.assign(far.position, { x: 600, y: 224 });
  Object.assign(dead.position, { x: 325, y: 225 });
  Object.assign(behind.position, { x: 275, y: 224 });
  dead.hp = 0;
  dead.downUntil = Infinity;
  const right = { x: 1, y: 0 };
  assert.equal(selectTarget(battle.collisions, player, battle.fighters, right), nearby);
  player.target = front;
  assert.equal(selectTarget(battle.collisions, player, battle.fighters, right), front);
  assert.equal(selectTarget(battle.collisions, player, battle.fighters, { x: -1, y: 0 }), behind);
  Object.assign(player.position, { x: 320, y: 272 });
  Object.assign(front.position, { x: 425, y: 272 });
  Object.assign(nearby.position, { x: 450, y: 272 });
  assert.equal(selectTarget(battle.collisions, player, battle.fighters, right), undefined);
  step();
  assert.equal(battle.shots.length, 0);
  engine.dispose();
});

test("aim and attack are independent, shield absorbs damage before HP, and only shield recovers in the field", () => {
  const { engine, battle, orders, step } = match();
  const player = battle.fighters[2];
  const target = battle.fighters[7];
  Object.assign(player.position, { x: 480, y: 390 });
  Object.assign(target.position, { x: 480, y: 284 });
  target.shield = 10;
  target.hitAt = 0;
  const aim = { ...IDLE, aim: { x: 0, y: -1 } };
  orders.set(player.id, aim);
  step();
  assert.equal(player.target, target);
  assert.equal(target.shield, 10);
  orders.set(player.id, { ...aim, attack: true });
  step();
  assert.equal(target.shield, 0);
  assert.equal(target.hp, 100 - (recruit.damage - 10));
  orders.set(player.id, IDLE);
  step(recruit.shieldDelay);
  assert.equal(target.shield, 0);
  step(HZ);
  assert.ok(Math.abs(target.shield - 20) < 1e-8);
  step(4 * HZ);
  assert.ok(Math.abs(target.shield - recruit.shield) < 1e-8);
  assert.equal(target.hp, 92);
  Object.assign(target.position, HQ.red);
  step(HZ);
  assert.equal(target.hp, recruit.hp);
  engine.dispose();
});

test("held attacks use their cadence; lethal exchanges resolve together and respawn at HQ", () => {
  const { engine, battle, orders, step } = match();
  const blue = battle.fighters[2];
  const red = battle.fighters[7];
  Object.assign(blue.position, { x: 480, y: 344 });
  Object.assign(red.position, { x: 480, y: 232 });
  orders.set(blue.id, { ...IDLE, attack: true });
  orders.set(red.id, { ...IDLE, attack: true });
  step();
  assert.equal(red.shield, 82);
  step(recruit.attackTicks - 1);
  assert.equal(red.shield, 82);
  step();
  assert.equal(red.shield, 64);
  blue.hp = red.hp = 1;
  blue.shield = red.shield = 0;
  step(recruit.attackTicks);
  assert.deepEqual(battle.kills, { blue: 1, red: 1 });
  assert.deepEqual(battle.scores, { blue: 2, red: 2 });
  assert.equal(blue.actor.enabled, false);
  assert.equal(red.actor.enabled, false);
  orders.clear();
  step(red.downUntil - battle.tick - 1);
  assert.equal(red.hp, 0);
  step();
  assert.equal(red.hp, recruit.hp);
  assert.equal(red.shield, recruit.shield);
  assert.equal(red.actor.enabled, true);
  assert.equal(distance(red.position, HQ.red), 0);
  engine.dispose();
});

test("a contested device pauses, abandonment removes it, and completion flips ownership and begins accrual", () => {
  const { engine, battle, orders, step } = match();
  const blue = battle.fighters[2];
  const red = battle.fighters[7];
  const site = battle.sites[1];
  Object.assign(blue.position, site);
  step(15);
  assert.equal(site.owner, null);
  assert.equal(site.device, null);
  orders.set(blue.id, { ...IDLE, deploy: true });
  step();
  orders.clear();
  step(80);
  Object.assign(red.position, site);
  step(80);
  assert.equal(site.device!.contested, true);
  assert.equal(site.device!.progress, 80);
  Object.assign(blue.position, HQ.blue);
  step(ABANDON_TICKS);
  assert.equal(site.device, null);
  assert.equal(site.owner, null);
  orders.set(red.id, { ...IDLE, deploy: true });
  step(ACTIVATE_TICKS);
  assert.equal(site.owner, null);
  step();
  assert.equal(site.owner, "red");
  assert.equal(site.device, null);
  assert.ok(battle.scores.red >= 4);
  const redScore = battle.scores.red;
  step(HZ);
  assert.equal(battle.scores.red, redScore + 1);

  Object.assign(red.position, HQ.red);
  Object.assign(blue.position, site);
  orders.clear();
  orders.set(blue.id, { ...IDLE, deploy: true });
  step(ACTIVATE_TICKS);
  assert.equal(site.owner, "red");
  step();
  assert.equal(site.owner, "blue");
  engine.dispose();
});

test("round expiry locks the result, falls back to sites then knockouts, and allows exact draws", () => {
  for (const { lead, owner, kills, expected } of [
    { lead: 9, owner: "red", kills: 0, expected: "blue" },
    { lead: -1, owner: "blue", kills: 0, expected: "blue" },
    { lead: 0, owner: null, kills: 1, expected: "red" },
    { lead: 0, owner: null, kills: 0, expected: "draw" },
  ] as const) {
    const { engine, battle, step } = match(1);
    battle.scores.blue = lead;
    battle.sites[0].owner = owner;
    battle.kills.red = kills;
    step(HZ - 1);
    assert.equal(battle.result, null);
    step();
    assert.equal(battle.result, expected);
    const scores = { ...battle.scores };
    step(HZ);
    assert.deepEqual(battle.scores, scores);
    assert.equal(battle.remaining, 0);
    const oldScene = engine.scene;
    engine.activate(new Scene("rematch"));
    assert.equal(oldScene.disposed, true);
    assert.equal(oldScene.actors.length, 0);
    engine.dispose();
  }
});

test("a full fixed-step AI match fights, captures, ends, and repeats deterministically", () => {
  function play() {
    const engine = new Engine();
    const ai = createAI();
    const battle = new Battle(engine.scene, "terrain.svg", ROUND_SECONDS, ai);
    const owners = new Set<string>();
    let devices = 0;
    for (let tick = 0; tick < battle.duration; tick++) {
      engine.step(STEP);
      for (const site of battle.sites) {
        if (site.owner) owners.add(site.owner);
        if (site.device) devices++;
      }
    }
    const result = { winner: battle.result, ...battle.scores, kills: { ...battle.kills } };
    assert.equal(battle.remaining, 0);
    assert.ok(battle.result);
    assert.ok(devices > ACTIVATE_TICKS);
    assert.deepEqual([...owners].sort(), ["blue", "red"]);
    assert.ok(result.kills.blue > 0 && result.kills.red > 0);
    engine.dispose();
    return result;
  }
  assert.deepEqual(play(), play());
});
