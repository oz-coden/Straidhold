import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine, type Point } from "@simpludify/core";
import { TILE, type Arena } from "../src/rules/arena.ts";
import { createAI } from "../src/rules/ai.ts";
import { chooseSkill } from "../src/rules/ai-skills.ts";
import { Battle, HZ, recruit, selectTarget, STEP, type Fighter } from "../src/rules/battle.ts";
import { CLASS_IDS, CLASSES, soloLineup, STANDARD_LINEUP, type Lineup } from "../src/rules/classes.ts";
import { IDLE, type Command, type SkillOrder } from "../src/rules/command.ts";
import { tacticalMaps } from "../src/rules/maps.ts";
import { StatusEffects } from "../src/rules/status.ts";
import { Supply } from "../src/rules/supply.ts";
import { seesUnit } from "../src/rules/vision.ts";
const [forks, , line] = tacticalMaps;

const self = { kind: "self" } as const;
const ally = (fighter: Fighter): SkillOrder => ({ kind: "ally", id: fighter.id });
const point = (x: number, y: number): SkillOrder => ({ kind: "point", point: { x, y } });
const moveTo = (fighter: Fighter, x: number, y: number) => Object.assign(fighter.position, { x, y });
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

function setup(lineup = STANDARD_LINEUP, arena?: Arena, duration = 65) {
  const engine = new Engine();
  const commands = new Map<string, Command>();
  const battle = new Battle(engine.scene, "terrain.svg", duration, (fighter) => commands.get(fighter.id) ?? IDLE,
    arena, true, 1, lineup);
  function step(ticks = 1) { for (let i = 0; i < ticks; i++) engine.step(STEP); }
  function act(...orders: readonly (readonly [Fighter, Command])[]) {
    for (const [fighter, order] of orders) commands.set(fighter.id, order);
    step();
    commands.clear();
  }
  function cast(fighter: Fighter, skill: SkillOrder) { act([fighter, { ...IDLE, skill }]); }
  function shoot(fighter: Fighter) {
    fighter.attackAt = battle.tick;
    act([fighter, { ...IDLE, attack: true }]);
  }
  const stats = (fighter: Fighter) => battle.participantStats().find(({ id }) => id === fighter.id)!;
  return { engine, battle, step, act, cast, shoot, stats };
}

test("the solo lineup is deterministic and reserves the player's class exactly once", () => {
  for (const selected of CLASS_IDS) {
    const lineup = soloLineup(selected);
    assert.equal(lineup.blue[2], selected);
    for (const team of ["blue", "red"] as const) assert.deepEqual(new Set(lineup[team]), new Set(CLASS_IDS));
    assert.deepEqual(lineup, soloLineup(selected));
  }
});

test("status identity, source exclusion, strength, and expiry select the correct modifiers", () => {
  const status = new StatusEffects();
  const subject = { id: "source", team: "blue", position: { x: 0, y: 0 } } as const;
  status.add({ id: "zone", sourceId: "a", target: subject.id, modifier: "movementSlow", strength: 0.25, endsAt: 20 });
  status.add({ id: "zone", sourceId: "b", target: subject.id, modifier: "movementSlow", strength: 0.30, endsAt: 10 });
  status.add({ id: "web", sourceId: "c", target: subject.id, modifier: "movementSlow", strength: 0.80, endsAt: 30 });
  status.add({ id: "team", sourceId: subject.id, target: { team: subject.team, excludeSource: true },
    modifier: "buffPower", strength: 0.2, endsAt: Infinity });
  close(status.total(subject, "movementSlow"), 1.1);
  assert.equal(status.total(subject, "buffPower"), 0);
  assert.equal(status.total({ ...subject, id: "ally" }, "buffPower"), 0.2);
  status.expire(10);
  close(status.total(subject, "movementSlow"), 1.05);
  status.expire(20);
  close(status.total(subject, "movementSlow"), 0.8);
  status.expire(30);
  assert.equal(status.total(subject, "movementSlow"), 0);
});

test("assassin movement, supply ramp and recovery use the class coefficients", (t) => {
  const { battle, engine, act } = setup();
  t.after(() => engine.dispose());
  const [assassin, tank, recon] = battle.fighters;
  act([assassin, { ...IDLE, move: { x: 0, y: -1 } }]);
  close(assassin.motion.speed, recruit.speed * 1.1);
  close(tank.motion.speed, recruit.speed);
  assert.equal(recon.profile.vision, 282);

  const supply = new Supply(line);
  supply.rebuild(line.sites.map(({ id }) => ({ id, owner: id === "D" || id === "B" ? "blue" : null })));
  const hq = line.hq.blue;
  const outside = { x: hq.x, y: hq.y + 5 * TILE };
  const normal = { boost: 0, slow: 0 }, fast = { boost: 0, slow: 0 };
  close(supply.speed(normal, "blue", hq, 12, true, 1.2), 1.14);
  close(supply.speed(fast, "blue", hq, 12, true, 1.2, CLASSES.assassin), 1.28);
  const normalInvading = supply.speed(normal, "red", hq, 12, true, STEP);
  const fastInvading = supply.speed(fast, "red", hq, 12, true, STEP, CLASSES.assassin);
  close(1 - fastInvading, (1 - normalInvading) / 2);
  normal.slow = 0.24;
  fast.slow = 0.12;
  close(supply.speed(fast, "red", outside, 12, true, 0.8, CLASSES.assassin), 1);
  assert.ok(supply.speed(normal, "red", outside, 12, true, 0.8) < 1);
});

test("assassin boost is applied to shots fired on the cast tick, expires before its deadline tick, and keeps its CD", (t) => {
  const lineup: Lineup = { ...STANDARD_LINEUP, blue: ["assassin", "tank", "recon", "control", "control"] };
  const { battle, engine, act, cast, shoot, step, stats } = setup(lineup);
  t.after(() => engine.dispose());
  const fighter = battle.fighters[0], target = battle.fighters[7];
  moveTo(fighter, 480, 344);
  moveTo(target, 480, 232);
  cast(fighter, point(480, 232));
  assert.equal(stats(fighter).skillUses, 0);
  assert.equal(battle.abilities.cooldown(fighter), 0);
  act([fighter, { ...IDLE, skill: self, attack: true }]);
  close(target.shield, 88);
  assert.equal(battle.abilities.cooldown(fighter), 30 * HZ);
  cast(fighter, self);
  assert.equal(stats(fighter).skillUses, 1);
  step(5 * HZ - 2);
  assert.equal(battle.abilities.effects.total(fighter, "outgoingDamage"), 0.2);
  shoot(fighter);
  assert.equal(battle.abilities.effects.total(fighter, "outgoingDamage"), 0);
  assert.equal(stats(fighter).damageDealt, 22);
  step(25 * HZ - 1);
  cast(fighter, self);
  assert.equal(stats(fighter).skillUses, 2);
  step(battle.duration - battle.tick);
  assert.equal(battle.abilities.cooldown(fighter), 0);
  assert.deepEqual(battle.abilities.effects.all(), []);
});

test("two tank links split the same primary damage, reject a third, and never redirect a transfer", (t) => {
  const lineup: Lineup = { ...STANDARD_LINEUP, blue: ["tank", "tank", "tank", "tank", "recon"] };
  const { battle, engine, cast, shoot, stats } = setup(lineup);
  t.after(() => engine.dispose());
  const [first, second, third, chained, target] = battle.fighters;
  const attacker = battle.fighters[7];
  moveTo(target, 480, 344);
  moveTo(first, 510, 370);
  moveTo(second, 520, 376);
  moveTo(third, 470, 382);
  moveTo(chained, 490, 392);
  moveTo(attacker, 480, 232);
  cast(chained, ally(first));
  cast(first, ally(target));
  cast(second, ally(target));
  cast(third, ally(target));
  assert.equal(battle.abilities.cooldown(third), 0);
  assert.equal(stats(third).skillUses, 0);
  shoot(attacker);
  assert.equal(target.shield, 100);
  assert.equal(first.shield, 96);
  assert.equal(second.shield, 96);
  assert.equal(chained.shield, 100);
  assert.equal(stats(attacker).damageDealt, 8);
  assert.deepEqual(battle.combatEvents.map((event) => event.kind === "damage"
    && [event.attackId, event.attacker, event.originalTarget, event.target]), [
    [`${battle.tick}:0`, attacker.id, target.id, first.id],
    [`${battle.tick}:0`, attacker.id, target.id, second.id],
  ]);
  first.shield = 0;
  first.hp = 2;
  shoot(attacker);
  assert.equal(first.hp, 0);
  assert.equal(stats(attacker).damageDealt, 14);
  assert.equal(stats(attacker).kills, 1);
  assert.equal(stats(first).deaths, 1);
  assert.equal(stats(first).hpDamage, 2);
  assert.equal(battle.abilities.protectors(target).length, 1);
  cast(third, ally(target));
  assert.equal(stats(third).skillUses, 1);
});

test("a barrier blocks a whole blow, counts actual absorption, resets shield recovery, and precedes the link", (t) => {
  const { battle, engine, cast, shoot, step, stats } = setup({
    ...STANDARD_LINEUP, blue: ["support", "tank", "recon", "support", "support"],
  });
  t.after(() => engine.dispose());
  const [support, tank, target, peer, reserve] = battle.fighters;
  const attacker = battle.fighters[7];
  moveTo(support, 505, 374);
  moveTo(peer, 515, 390);
  moveTo(reserve, 490, 382);
  moveTo(tank, 510, 365);
  moveTo(target, 480, 315);
  moveTo(attacker, 480, 232);
  const { abilities } = battle;
  assert.equal(abilities.effects.total(support, "buffPower"), 0.2);
  cast(tank, ally(target));
  cast(support, ally(target));
  assert.equal(abilities.barrier(target)?.capacity, 120);
  cast(peer, ally(target));
  assert.equal(abilities.cooldown(peer), 0);
  assert.equal(stats(peer).skillUses, 0);
  target.shield = 30;
  for (let i = 0; i < 11; i++) shoot(attacker);
  assert.equal(abilities.barrier(target)?.capacity, 10);
  // A 10.0 shield-breaking blow would leave no overflow. Amplify just this blow.
  abilities.effects.add({ id: "test-buff", sourceId: attacker.id, target: attacker.id,
    modifier: "outgoingDamage", strength: 2, endsAt: battle.tick + 2 });
  shoot(attacker);
  assert.equal(abilities.barrier(target), undefined);
  assert.equal(stats(attacker).damageDealt, 120);
  assert.equal(stats(target).barrierDamage, 120);
  assert.ok(target.shield < 32);
  assert.equal(tank.shield, 100);
  assert.equal(target.hitAt, battle.tick);
  step();
  shoot(attacker);
  close(stats(attacker).damageDealt, 129);
  assert.equal(tank.shield, 96);
  cast(peer, ally(target));
  assert.equal(stats(peer).skillUses, 1);
  step(15 * HZ);
  assert.equal(abilities.barrier(target), undefined);
  cast(reserve, ally(target));
  assert.equal(stats(reserve).skillUses, 1);
});

test("only the recipient's defense modifiers apply to a transferred hit, including its barrier", (t) => {
  const { battle, engine, act, cast, stats } = setup();
  t.after(() => engine.dispose());
  const tank = battle.fighters[1], target = battle.fighters[2], support = battle.fighters[4], assassin = battle.fighters[5];
  moveTo(assassin, 480, 232);
  moveTo(target, 480, 344);
  moveTo(tank, 510, 371);
  moveTo(support, 514, 390);
  cast(support, ally(tank));
  cast(tank, ally(target));
  act([assassin, { ...IDLE, attack: true, skill: self }]);
  close(100 - target.shield, 6.2);
  close(100 - battle.abilities.barrier(tank)!.capacity, 4.96);
  close(stats(assassin).damageDealt, 11.16);
  close(stats(tank).barrierDamage, 4.96);
});

test("a lethal same-tick exchange retains both shots and clears the assassin effect but keeps CD through respawn", (t) => {
  const { battle, engine, act, stats, step } = setup();
  t.after(() => engine.dispose());
  const assassin = battle.fighters[0], enemy = battle.fighters[7];
  moveTo(assassin, 480, 344);
  moveTo(enemy, 480, 232);
  assassin.hp = 10;
  enemy.hp = 12;
  assassin.shield = enemy.shield = 0;
  act([assassin, { ...IDLE, skill: self, attack: true }], [enemy, { ...IDLE, attack: true }]);
  assert.deepEqual(battle.kills, { blue: 1, red: 1 });
  assert.equal(stats(assassin).damageDealt, 12);
  assert.equal(stats(enemy).damageDealt, 10);
  assert.equal(battle.abilities.effects.total(assassin, "outgoingDamage"), 0);
  step(assassin.downUntil - battle.tick);
  assert.equal(assassin.hp, recruit.hp);
  assert.ok(battle.abilities.cooldown(assassin) > 0);
});

test("recon sees farther and scans wall and bush contacts without tracking them or granting an attack", (t) => {
  const wall = setup();
  const bush = setup(STANDARD_LINEUP, forks);
  t.after(() => { wall.engine.dispose(); bush.engine.dispose(); });
  for (const { fixture, start, concealed } of [
    { fixture: wall, start: { x: 320, y: 272 }, concealed: { x: 425, y: 272 } },
    { fixture: bush, start: { x: (forks.bushes[0].x + forks.bushes[0].w + 1) * TILE, y: (forks.bushes[0].y + 1.5) * TILE },
      concealed: { x: (forks.bushes[0].x + 2) * TILE, y: (forks.bushes[0].y + 1.5) * TILE } },
  ]) {
    const { battle, cast, step, stats } = fixture;
    const recon = battle.fighters[2], enemy = battle.fighters[7];
    Object.assign(recon.position, start);
    Object.assign(enemy.position, concealed);
    assert.equal(seesUnit(battle.collisions, battle.arena, battle.tick, recon, enemy), false);
    cast(recon, self);
    const contact = battle.abilities.recon("blue").get(enemy.id)!;
    assert.deepEqual(contact.position, concealed);
    assert.equal(battle.abilities.recon("red").size, 0);
    assert.equal(selectTarget(battle.collisions, recon, [enemy], null, battle.arena, battle.tick), undefined);
    assert.equal(battle.abilities.cooldown(recon), 25 * HZ);
    enemy.position.x += 4;
    step(5 * HZ - 1);
    assert.deepEqual(battle.abilities.recon("blue").get(enemy.id)?.position, concealed);
    step();
    assert.equal(battle.abilities.recon("blue").size, 0);
    assert.equal(stats(recon).skillUses, 1);
  }
});

test("control placement validates terrain, lasts six seconds, and applies only the strongest same-name slow", (t) => {
  const normal = setup();
  const boosted = setup({ ...STANDARD_LINEUP, blue: ["control", "control", "recon", "control", "support"] });
  t.after(() => { normal.engine.dispose(); boosted.engine.dispose(); });
  for (const [fixture, expected] of [[normal, 0.25], [boosted, 0.3]] as const) {
    const { battle, cast, step, stats } = fixture;
    const control = battle.fighters[3], peer = battle.fighters[0], target = battle.fighters[7];
    moveTo(control, 320, 272);
    cast(control, point(415, 272));
    cast(control, point(700, 80));
    assert.equal(stats(control).skillUses, 0);
    moveTo(control, 480, 344);
    moveTo(target, 480, 232);
    cast(control, point(480, 232));
    close(battle.abilities.effects.total(target, "movementSlow"), expected);
    close(target.motion.speed, recruit.speed * (1 - expected));
    if (expected === 0.3) {
      moveTo(peer, 480, 344);
      cast(peer, point(480, 240));
      close(battle.abilities.effects.total(target, "movementSlow"), 0.3);
    }
    moveTo(target, 480, 97);
    step();
    assert.equal(target.motion.speed, recruit.speed);
    moveTo(target, 480, 232);
    step(6 * HZ);
    assert.equal(target.motion.speed, recruit.speed);
    assert.equal(stats(control).skillUses, 1);
    assert.ok(battle.abilities.cooldown(control) > 0);
  }
});

test("AI uses public snapshots for control placement and fires no hidden normal attack", (t) => {
  const { battle, engine, cast } = setup();
  t.after(() => engine.dispose());
  const recon = battle.fighters[2], controller = battle.fighters[3], enemy = battle.fighters[7];
  moveTo(recon, 320, 272);
  moveTo(controller, 425, 250);
  moveTo(enemy, 425, 340);
  cast(recon, self);
  const snapshot: Point = { x: enemy.position.x, y: enemy.position.y };
  moveTo(controller, 425, 320);
  // Move the live opponent out of sight without changing the published position.
  moveTo(enemy, 320, 272);
  for (const fighter of battle.fighters) {
    if (fighter.team === "blue" && fighter !== controller) moveTo(fighter, 64, 460);
    if (fighter.team === "red" && fighter !== enemy) moveTo(fighter, 888, 80);
  }
  const ai = createAI();
  const site = battle.sites[1];
  const first = chooseSkill(controller, battle, site, false);
  assert.deepEqual(first, { kind: "point", point: snapshot });
  moveTo(enemy, 310, 269);
  assert.deepEqual(chooseSkill(controller, battle, site, false), first);
  assert.equal(ai(controller, battle).attack, false);
});

test("headless opponents on both teams successfully activate every class", (t) => {
  const engine = new Engine();
  t.after(() => engine.dispose());
  const battle = new Battle(engine.scene, "terrain.svg", 120, createAI(), line);
  for (let i = 0; i < battle.duration; i++) engine.step(STEP);
  assert.equal(battle.participantStats().length, 10);
  for (const row of battle.participantStats()) assert.ok(row.skillUses > 0, row.id);
});
