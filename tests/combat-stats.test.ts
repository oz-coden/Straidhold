import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine } from "@simpludify/core";
import { ACTIVATE_TICKS, ABANDON_TICKS, Battle, HZ, recruit, STEP, type Fighter } from "../src/rules/battle.ts";
import { HQ } from "../src/rules/arena.ts";
import { IDLE, type Command } from "../src/rules/command.ts";
import { contributionUnits, POINT_UNITS } from "../src/rules/contribution.ts";

function fixture(seconds = 30) {
  const engine = new Engine();
  const orders = new Map<string, Command>();
  const battle = new Battle(engine.scene, "terrain.svg", seconds, (fighter) => orders.get(fighter.id) ?? IDLE, undefined, true, 2);
  const step = (ticks = 1) => {
    for (let i = 0; i < ticks; i++) engine.step(STEP);
  };
  const stats = (fighter: Fighter) => battle.participantStats().find(({ id }) => id === fighter.id)!;
  const hit = (attacker: Fighter) => {
    attacker.attackAt = battle.tick;
    orders.set(attacker.id, { ...IDLE, attack: true });
    step();
    orders.delete(attacker.id);
  };
  return { engine, orders, battle, step, stats, hit };
}

function attackers(battle: Battle) {
  const [a, b, c] = battle.fighters;
  const target = battle.fighters[7];
  for (const attacker of [a, b, c]) Object.assign(attacker.position, { x: 480, y: 344 });
  Object.assign(target.position, { x: 480, y: 232 });
  return { a, b, c, target };
}

test("accepted damage records exact shield and HP losses and the final same-tick attacker gets the kill", (t) => {
  const { engine, orders, battle, step, stats, hit } = fixture();
  t.after(() => engine.dispose());
  const { a, b, c, target } = attackers(battle);
  Object.assign(target.position, HQ.red);
  hit(a);
  assert.equal(battle.combatEvents.length, 0);
  Object.assign(target.position, { x: 480, y: 232 });
  target.shield = 20;
  target.hp = 20;
  hit(a);
  assert.deepEqual(battle.combatEvents.map((event) => ({
    kind: event.kind, round: event.round, tick: event.tick,
    ...(event.kind === "damage" ? { shield: event.shield, hp: event.hp, lethal: event.lethal } : {}),
  })), [{ kind: "damage", round: 2, tick: 2, shield: 18, hp: 0, lethal: false }]);
  hit(a);
  assert.ok(battle.combatEvents.some((event) => event.kind === "damage" && event.shield === 2 && event.hp === 16));
  for (const fighter of [a, b, c]) {
    fighter.attackAt = battle.tick;
    orders.set(fighter.id, { ...IDLE, attack: true });
  }
  step();
  assert.deepEqual(battle.combatEvents.map(({ kind }) => kind), ["damage", "defeat"]);
  const defeat = battle.combatEvents.find((event) => event.kind === "defeat")!;
  assert.equal(defeat.attacker, a.id);
  assert.equal(stats(a).kills, 1);
  assert.equal(stats(target).deaths, 1);
  assert.equal(stats(b).assists + stats(c).assists, 0);
  assert.equal(battle.scores.blue, 2);
});

test("two same-tick damage sources assist once and respawn starts a fresh history", (t) => {
  const { engine, orders, battle, step, stats, hit } = fixture();
  t.after(() => engine.dispose());
  const { a, b, c, target } = attackers(battle);
  target.shield = 0;
  target.hp = 90;
  hit(a);
  hit(a);
  step(recruit.shieldDelay - 1);
  for (const fighter of [b, c]) orders.set(fighter.id, { ...IDLE, attack: true });
  target.hp = 30;
  step();
  orders.clear();
  assert.deepEqual(battle.combatEvents.filter((event) => event.kind === "defeat").map((event) => [event.attacker, event.assists]), [
    [c.id, [a.id, b.id]],
  ]);
  assert.deepEqual([stats(a).assists, stats(b).assists, stats(c).kills], [1, 1, 1]);
  step(target.downUntil - battle.tick);
  Object.assign(target.position, { x: 480, y: 232 });
  target.shield = 0;
  target.hp = 10;
  hit(b);
  assert.equal(stats(a).assists, 1);
  assert.equal(stats(target).deaths, 2);
  assert.equal(stats(b).kills, 1);
});

for (const recovery of ["shield", "hq", "full", "last-tick"] as const) {
  test(`assist history tracks actual recovery: ${recovery}`, (t) => {
    const { engine, battle, step, stats, hit } = fixture();
    t.after(() => engine.dispose());
    const { a, b, target } = attackers(battle);
    target.shield = recovery === "hq" || recovery === "full" ? 0 : 100;
    target.hp = 70;
    hit(a);
    if (recovery === "hq" || recovery === "full") target.shield = 100;
    if (recovery === "hq") Object.assign(target.position, HQ.red);
    if (recovery === "full") target.hp = 100;
    step(recruit.shieldDelay + (recovery === "last-tick" ? 0 : 1));
    if (recovery === "shield") assert.ok(target.shield > 82);
    if (recovery === "hq") assert.ok(target.hp > 52);
    Object.assign(target.position, { x: 480, y: 232 });
    target.shield = 0;
    target.hp = 10;
    hit(b);
    assert.equal(stats(a).assists, recovery === "full" || recovery === "last-tick" ? 1 : 0);
    assert.equal(stats(b).kills, 1);
  });
}

for (const [mode, expected] of [
  ["solo", [80, 0, 0]],
  ["pair", [40, 40, 0]],
  ["late", [60, 20, 0]],
  ["thirds", [26.667, 26.667, 26.666]],
] as const) {
  test(`capture progress awards 100 points exactly: ${mode}`, (t) => {
    const { engine, orders, battle, step, stats } = fixture();
    t.after(() => engine.dispose());
    const [a, b, c] = battle.fighters;
    const red = battle.fighters[7];
    const site = battle.sites[1];
    site.owner = "red";
    Object.assign(a.position, site);
    if (mode === "pair" || mode === "thirds") Object.assign(b.position, site);
    if (mode === "thirds") Object.assign(c.position, site);
    orders.set(a.id, { ...IDLE, deploy: true });
    step();
    orders.clear();
    step(ACTIVATE_TICKS / 2);
    Object.assign(red.position, site);
    step(HZ);
    assert.equal(site.device!.progress, ACTIVATE_TICKS / 2);
    assert.equal(battle.participantStats().reduce((sum, row) => sum + contributionUnits(row), 0), 0);
    if (mode === "late") Object.assign(b.position, site);
    Object.assign(red.position, HQ.red);
    step(ACTIVATE_TICKS / 2);
    assert.equal(site.owner, "blue");
    assert.equal(battle.combatEvents.filter(({ kind }) => kind === "capture").length, 1);
    assert.equal(stats(a).captures, 1);
    assert.equal(stats(a).installationUnits, 20 * POINT_UNITS);
    assert.deepEqual([a, b, c].map((fighter) => stats(fighter).guardingUnits / POINT_UNITS), [...expected]);
    assert.equal(battle.participantStats().reduce((sum, row) => sum + contributionUnits(row), 0), 100 * POINT_UNITS);
    assert.equal(battle.scores.blue, 4);
  });
}

test("abandoned progress is discarded and a departed installer can still earn the completion bonus", (t) => {
  const { engine, orders, battle, step, stats } = fixture();
  t.after(() => engine.dispose());
  const [a, b, c] = battle.fighters;
  const site = battle.sites[1];
  const deploy = (fighter: Fighter) => {
    Object.assign(fighter.position, site);
    orders.set(fighter.id, { ...IDLE, deploy: true });
    step();
    orders.clear();
  };
  deploy(a);
  step(50);
  Object.assign(a.position, HQ.blue);
  step(ABANDON_TICKS);
  assert.equal(site.device, null);
  assert.equal(stats(a).captures, 0);
  assert.equal(stats(a).guardingUnits, 0);

  deploy(b);
  Object.assign(b.position, HQ.blue);
  Object.assign(c.position, site);
  step(ACTIVATE_TICKS);
  assert.equal(stats(b).installationUnits, 20 * POINT_UNITS);
  assert.equal(stats(b).guardingUnits, 0);
  assert.equal(stats(c).guardingUnits, 80 * POINT_UNITS);
  assert.equal(stats(a).guardingUnits, 0);
});

test("movement uses collision-resolved position changes and excludes spawn displacement", (t) => {
  const { engine, orders, battle, step, stats } = fixture();
  t.after(() => engine.dispose());
  const fighter = battle.fighters[2];
  step();
  assert.equal(stats(fighter).distanceMoved, 0);
  Object.assign(fighter.position, { x: 320, y: 272 });
  orders.set(fighter.id, { ...IDLE, move: { x: 1, y: 0 } });
  step(90);
  const atWall = stats(fighter).distanceMoved;
  assert.ok(Math.abs(atWall - (fighter.position.x - 320)) < 1e-8);
  assert.ok(atWall > 15 && atWall < 25);
  step(60);
  assert.equal(stats(fighter).distanceMoved, atWall);
  orders.clear();
  fighter.hp = 0;
  fighter.shield = 0;
  fighter.actor.enabled = false;
  fighter.downUntil = battle.tick + 2;
  step(2);
  assert.equal(fighter.hp, recruit.hp);
  assert.equal(stats(fighter).distanceMoved, atWall);
  assert.equal(stats(fighter).hpRecovered + stats(fighter).shieldRecovered, 0);
});

test("damage and recovery stats use actual capped changes in both pools", (t) => {
  const { engine, battle, step, stats, hit } = fixture();
  t.after(() => engine.dispose());
  const { a, target } = attackers(battle);
  hit(a);
  assert.equal(stats(target).shieldDamage, 18);
  assert.equal(stats(target).hpDamage, 0);
  target.hp = 93;
  Object.assign(target.position, HQ.red);
  step(recruit.shieldDelay + 3 * HZ);
  assert.equal(stats(target).shieldRecovered, 18);
  assert.equal(stats(target).hpRecovered, 7);
  Object.assign(target.position, { x: 480, y: 232 });
  target.shield = 2;
  target.hp = 5;
  hit(a);
  assert.equal(stats(target).shieldDamage, 20);
  assert.equal(stats(target).hpDamage, 5);
  step(target.downUntil - battle.tick);
  assert.equal(stats(target).shieldRecovered, 18);
  assert.equal(stats(target).hpRecovered, 7);
});

test("streak counts kills, records milestones and stops on death or the round boundary", (t) => {
  const { engine, battle, orders, step, stats, hit } = fixture(300);
  t.after(() => engine.dispose());
  const { a, b, target } = attackers(battle);
  const defeat = () => battle.combatEvents.find((event) => event.kind === "defeat")!;
  for (let kills = 1; kills <= 10; kills++) {
    target.shield = 0;
    target.hp = 30;
    Object.assign(target.position, { x: 480, y: 232 });
    hit(b);
    hit(a);
    assert.equal(defeat().streak, kills);
    assert.equal(stats(b).maxStreak, 0);
    assert.equal(stats(b).assists, kills);
    assert.equal(battle.currentStreak(a.id), kills);
    step(target.downUntil - battle.tick);
  }

  // Each simultaneous shot counts as a kill. Both surviving streak counters reset.
  Object.assign(target.position, { x: 480, y: 232 });
  Object.assign(b.position, HQ.blue);
  for (const fighter of [a, target]) {
    fighter.hp = 1;
    fighter.shield = 0;
    fighter.attackAt = battle.tick;
    orders.set(fighter.id, { ...IDLE, attack: true });
  }
  step();
  orders.clear();
  const exchanges = battle.combatEvents.filter((event) => event.kind === "defeat");
  assert.deepEqual(exchanges.map(({ streak, stoppedStreak }) => [streak, stoppedStreak]), [[11, 0], [1, 10]]);
  assert.equal(battle.currentStreak(a.id), 0);
  assert.equal(battle.currentStreak(target.id), 0);
  assert.equal(stats(a).maxStreak, 11);
  step(Math.max(a.downUntil, target.downUntil) - battle.tick);
  Object.assign(a.position, { x: 480, y: 344 });
  Object.assign(target.position, { x: 480, y: 232 });
  target.hp = 1;
  target.shield = 0;
  hit(a);
  assert.equal(battle.currentStreak(a.id), 1);
  step(battle.duration - battle.tick);
  assert.equal(battle.currentStreak(a.id), 0);
  assert.equal(stats(a).maxStreak, 11);
});
