import assert from "node:assert/strict";
import test from "node:test";
import { Engine } from "@simpludify/core";
import { createAI } from "../src/rules/ai.ts";
import { bushAt, distance, hasClearance, RADIUS, route, TEAMS, TILE, type Arena } from "../src/rules/arena.ts";
import { ACTIVATE_TICKS, Battle, HZ, selectTarget, SITE_RADIUS, STEP } from "../src/rules/battle.ts";
import { IDLE } from "../src/rules/command.ts";
import { tacticalMaps } from "../src/rules/maps.ts";
import { Supply } from "../src/rules/supply.ts";
import { seesUnit, TeamVision } from "../src/rules/vision.ts";

const [forks, crossings, line, split, cross] = tacticalMaps;

test("each map starts neutral with mirrored spawn and terrain, traversable lanes and off-lane jungle", () => {
  assert.deepEqual(tacticalMaps.map((map) => map.sites.length), [7, 7, 5, 4, 7]);
  for (const arena of tacticalMaps) {
    assert.ok(arena.cols >= 76 && arena.cols <= 82 && arena.rows >= 36 && arena.rows <= 42);
    assert.ok(arena.sites.every((site) => hasClearance(site, site, SITE_RADIUS, arena)));
    assert.ok(arena.sites.every((a, i) => arena.sites.slice(i + 1).every((b) => distance(a, b) > 2 * SITE_RADIUS)));
    assert.ok(arena.sites.every((site) => TEAMS.every((team) => distance(site, arena.hq[team]) > 4 * SITE_RADIUS)));
    // Both outer edges allow a full crossing through jungle with collider clearance.
    for (const row of [2, arena.rows - 2]) {
      const from = { x: 2 * TILE, y: row * TILE };
      const to = { x: (arena.cols - 2) * TILE, y: from.y };
      assert.ok(hasClearance(from, to, RADIUS, arena), arena.id);
      assert.ok(arena.laneCells.slice(row * arena.cols, (row + 1) * arena.cols).every((lanes) => !lanes.length), arena.id);
    }
    const engine = new Engine();
    try {
      const battle = new Battle(engine.scene, "terrain.svg", 60, () => IDLE, arena);
      assert.ok(battle.sites.every(({ owner }) => owner === null));
      assert.ok(battle.supply.lanes.every((owner) => owner === null));
      assert.equal(battle.fighters.length, 10);
      assert.ok(arena.bushes.length > 0);
      assert.ok(arena.bushCells.every((bush, i) => !bush || !arena.laneCells[i].length));
      assert.ok(arena.laneCells.filter((lanes) => lanes.length === 0).length > arena.cols * arena.rows / 2);
      arena.terrain.forEach((tile, x, y) => {
        const mirror = arena.terrain.get(arena.cols - 1 - x, y);
        assert.equal(tile <= 4 ? tile : 5, mirror <= 4 ? mirror : 5);
      });
      for (const { a, b } of arena.lanes) assert.ok(hasClearance(a, b, RADIUS + 6, arena), arena.id);
      for (const slot of [0, 1, 2, 3, 4]) {
        const a = arena.spawns.blue[slot];
        const b = arena.spawns.red[slot];
        assert.equal(a.x + b.x, arena.width);
        assert.equal(a.y, b.y);
        assert.ok(hasClearance(a, a, RADIUS, arena));
      }
      assert.ok(arena.plans?.blue.every((plan) => plan.length >= 2));
    } finally {
      engine.dispose();
    }
  }
});

test("compact-map navigation can detour through passable jungle around cover", () => {
  const from = { x: 25 * TILE, y: 18 * TILE };
  const to = { x: 32 * TILE, y: 18 * TILE };
  assert.equal(hasClearance(from, to, RADIUS, split), false);
  const path = route(from, to, split);
  assert.ok(path.length > 2);
  assert.deepEqual(path.at(-1), to);
  assert.ok(path.every((point, i) => hasClearance(path[i - 1] ?? from, point, RADIUS, split)));
});

test("crossing supply activates alternate links and a cut isolates ownership without closing the lane", () => {
  const supply = new Supply(cross);
  const sites = cross.sites.map(({ id }) => ({ id, owner: ["D", "A", "B", "C"].includes(id) ? "blue" as const : null }));
  supply.rebuild(sites);
  assert.deepEqual([...supply.connected.blue].sort(), ["A", "B", "C", "D", "blue"]);
  supply.rebuild(sites.map((site) => site.id === "B" ? { ...site, owner: "red" } : site));
  assert.equal(supply.connected.blue.has("C"), false);
  assert.equal(supply.connected.red.has("B"), false);
  assert.equal(sites.find(({ id }) => id === "C")?.owner, "blue");
  const lane = cross.lanes.findIndex(({ from, to }) => from === "B" && to === "C");
  assert.equal(supply.lanes[lane], null);
  assert.ok(hasClearance(cross.lanes[lane].a, cross.lanes[lane].b, RADIUS, cross));
  supply.rebuild(sites.map((site) => site.id === "E" ? { ...site, owner: "blue" } : site.id === "B" ? { ...site, owner: "red" } : site));
  assert.equal(supply.connected.blue.has("C"), true);
  assert.equal(supply.lanes[lane], null);
});

test("supply speed ramps, breaks on hit or exit, and enemy slowdown follows graph depth", () => {
  const supply = new Supply(line);
  supply.rebuild(line.sites.map(({ id }) => ({ id, owner: id === "D" || id === "B" ? "blue" : null })));
  const blueHQ = line.hq.blue;
  const mid = { x: 13 * TILE, y: blueHQ.y };
  const jungle = { x: 13 * TILE, y: blueHQ.y + 5 * TILE };
  const neutral = { x: 32 * TILE, y: line.hq.red.y + 7.5 * TILE };
  const state = { boost: 0, slow: 0 };
  assert.ok(supply.speed(state, "blue", mid, 10, true, 1) > 1);
  assert.equal(supply.speed(state, "blue", mid, 10, true, 2), 1.28);
  assert.equal(supply.speed(state, "blue", mid, 0.1, true, STEP), 1);
  assert.equal(supply.speed(state, "blue", mid, 1.4, true, STEP), 1);
  assert.ok(supply.speed(state, "blue", mid, 1.6, true, STEP) > 1);
  assert.equal(supply.speed(state, "blue", jungle, 2, true, STEP), 1);
  assert.equal(state.boost, 0);
  const middleSpeed = supply.speed(state, "red", mid, 5, true, STEP);
  assert.ok(supply.speed(state, "red", blueHQ, 5, true, STEP) < middleSpeed);
  assert.equal(supply.speed(state, "red", jungle, 5, true, STEP), 1);
  assert.ok(state.slow > 0);
  assert.equal(supply.speed(state, "red", neutral, 5, true, 2), 1);
  assert.equal(state.slow, 0);
});

test("capture changes supply only on activation, without changing the score rule", () => {
  const engine = new Engine();
  const battle = new Battle(engine.scene, "terrain.svg", 60,
    (fighter) => ({ ...IDLE, deploy: fighter.id === "blue-2" }), forks);
  try {
    const site = battle.sites.find(({ id }) => id === "D")!;
    Object.assign(battle.fighters[2].position, site);
    engine.step(STEP);
    assert.equal(site.device?.team, "blue");
    assert.equal(site.owner, null);
    assert.equal(battle.supply.connected.blue.has(site.id), false);
    for (let i = 0; i < ACTIVATE_TICKS; i++) engine.step(STEP);
    assert.equal(site.owner, "blue");
    assert.equal(battle.supply.connected.blue.has(site.id), true);
    assert.ok(battle.scores.blue >= 4);
  } finally {
    engine.dispose();
  }
});

test("concealment uses the same contacts for team visibility, attack selection and AI", () => {
  const engine = new Engine();
  const ai = createAI();
  const battle = new Battle(engine.scene, "terrain.svg", 60, (fighter) => ({ ...IDLE, attack: fighter.team === "red" }), forks);
  const blue = battle.fighters[2];
  const ally = battle.fighters[1];
  const red = battle.fighters[7];
  const bush = forks.bushes[0];
  const center = { x: (bush.x + 2) * TILE, y: (bush.y + 1.5) * TILE };
  const outside = { x: (bush.x + bush.w + 1) * TILE, y: center.y };
  const sight = new TeamVision(battle.collisions, "blue", battle.fighters, forks);
  try {
    Object.assign(red.position, center);
    Object.assign(blue.position, outside);
    assert.ok(bushAt(forks, red.position));
    assert.equal(bushAt(forks, blue.position), 0);
    sight.update(0);
    assert.equal(sight.sees(center), true);
    assert.equal(sight.shows(red), false);
    assert.equal(ai(blue, battle).aim, null);
    assert.equal(selectTarget(battle.collisions, blue, [red], null, forks, 0), undefined);

    Object.assign(ally.position, { x: center.x + TILE, y: center.y });
    sight.update(0);
    assert.equal(sight.shows(red), true);
    assert.equal(selectTarget(battle.collisions, blue, [red], null, forks, 0), undefined);
    ally.hp = 0;
    ally.downUntil = HZ * 10;
    sight.update(0);
    assert.equal(sight.shows(red), false);
    Object.assign(blue.position, { x: center.x - 40, y: center.y });
    assert.equal(seesUnit(battle.collisions, forks, 0, blue, red), true);
    Object.assign(blue.position, outside);
    engine.step(STEP);
    sight.update(battle.tick);
    assert.ok(red.revealedUntil > battle.tick);
    assert.equal(sight.shows(red), true);
    assert.equal(selectTarget(battle.collisions, blue, [red], null, forks, battle.tick), red);
    sight.update(red.revealedUntil);
    assert.equal(sight.shows(red), false);
  } finally {
    engine.dispose();
  }
});

function match(arena: Arena) {
  const engine = new Engine();
  const battle = new Battle(engine.scene, "terrain.svg", 70, createAI({ blue: "flank", red: "center" }, 1), arena);
  let hits = 0;
  let firstHit = 0;
  let lateHits = 0;
  try {
    for (let i = 0; i < battle.duration; i++) {
      engine.step(STEP);
      const newHits = battle.shots.filter(({ tick }) => tick === battle.tick).length;
      if (!firstHit && newHits) firstHit = battle.tick / HZ;
      if (battle.tick > HZ * 45) lateHits += newHits;
      hits += newHits;
    }
    assert.ok(firstHit > 0 && firstHit < 18, arena.id);
    assert.ok(lateHits > 0, arena.id);
    for (const team of TEAMS) assert.ok(battle.scores[team] > 0, arena.id);
    return {
      hits, scores: battle.scores, result: battle.result, supply: battle.supply.lanes, kills: battle.kills,
      fighters: battle.fighters.map(({ position, hp, shield, downUntil, attackAt }) => [position.x, position.y, hp, shield, downUntil, attackAt]),
      sites: battle.sites.map(({ owner, device }) => [owner, device]),
    };
  } finally {
    engine.dispose();
  }
}

test("all tactical maps fight and score headlessly; fixed-step replays reproduce the resolved state", () => {
  const runs = tacticalMaps.map(match);
  assert.deepEqual(match(crossings), runs[1]);
  assert.ok(runs.some(({ kills }) => kills.blue > 0 && kills.red > 0));
});
