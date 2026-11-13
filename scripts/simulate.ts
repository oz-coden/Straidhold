import { Engine } from "@simpludify/core";
import { createAI, type Strategy } from "../src/rules/ai.ts";
import { distance, TEAMS, TILE, type Arena, type Team } from "../src/rules/arena.ts";
import { Battle, HZ, ROUND_SECONDS, STEP } from "../src/rules/battle.ts";
import { tacticalMaps } from "../src/rules/maps.ts";

const pairs = [
  { blue: "balanced", red: "balanced", seed: 0 },
  { blue: "flank", red: "center", seed: 1 },
  { blue: "center", red: "flank", seed: 1 },
  { blue: "balanced", red: "balanced", seed: 2 },
] as const satisfies readonly { blue: Strategy; red: Strategy; seed: number }[];

function play(arena: Arena, strategies: typeof pairs[number]) {
  const engine = new Engine();
  const ai = createAI(strategies, strategies.seed);
  const battle = new Battle(engine.scene, "terrain.svg", ROUND_SECONDS, ai, arena);
  const captures = battle.sites.map(({ id }) => ({ id, first: 0, repeat: 0 }));
  const lastOwners = battle.sites.map(({ owner }) => owner);
  const lastSupply = battle.supply.lanes.slice();
  const lastLane = battle.fighters.map(() => -1);
  const jungle = { blue: 0, red: 0 };
  const movement = { blue: 0, red: 0 };
  const laneChanges = { blue: 0, red: 0 };
  const sectors: Record<string, number> = {};
  let firstHit: number | null = null;
  let activated = 0;
  let cut = 0;
  let shots = 0;
  let jungleShots = 0;

  for (let i = 0; i < battle.duration; i++) {
    engine.step(STEP);
    for (let j = battle.shots.length - 1; j >= 0 && battle.shots[j].tick === battle.tick; j--) {
      const { impact } = battle.shots[j];
      firstHit ??= battle.tick / HZ;
      shots++;
      if (battle.supply.laneAt(impact) < 0) jungleShots++;
      const col = Math.min(4, Math.floor(5 * impact.x / arena.width)) + 1;
      const row = Math.min(2, Math.floor(3 * impact.y / arena.height)) + 1;
      const key = `${col},${row}`;
      sectors[key] = (sectors[key] ?? 0) + 1;
    }
    battle.sites.forEach(({ owner }, j) => {
      if (owner === lastOwners[j]) return;
      if (lastOwners[j]) captures[j].repeat++;
      else captures[j].first++;
      lastOwners[j] = owner;
    });
    battle.supply.lanes.forEach((owner, j) => {
      if (owner === lastSupply[j]) return;
      if (lastSupply[j]) cut++;
      if (owner) activated++;
      lastSupply[j] = owner;
    });
    if (battle.tick % 6 === 0) battle.fighters.forEach((fighter, j) => {
      if (!fighter.hp) { lastLane[j] = -1; return; }
      const { team, position, command } = fighter;
      if (command.move.x === 0 && command.move.y === 0) return;
      const lane = battle.supply.laneAt(position);
      movement[team]++;
      if (lane < 0) { jungle[team]++; return; }
      if (lastLane[j] >= 0 && lastLane[j] !== lane) laneChanges[team]++;
      lastLane[j] = lane;
    });
  }

  const jungleShare = (team: Team) => Number((100 * jungle[team] / Math.max(1, movement[team])).toFixed(1));
  const fastestAdjacent = Math.min(...arena.sites.flatMap((a, i) => arena.sites.slice(i + 1)
    .filter((b) => Math.abs(a.x - b.x) < TILE).map((b) => distance(a, b)))) / battle.fighters[0].profile.speed;
  const firstLeg = Math.min(...arena.lanes.filter(({ from }) => from === "blue").map(({ length }) => length)) / battle.fighters[0].profile.speed;
  const hqDistance = distance(arena.hq.blue, arena.hq.red) / battle.fighters[0].profile.speed;
  const result = {
    map: arena.id, strategies, winner: battle.result, scores: battle.scores, kills: battle.kills,
    scoreGap: Math.abs(battle.scores.blue - battle.scores.red), firstHit, shots, jungleShots, sectors,
    captures, activated, cut, laneChanges,
    jungleMovePercent: Object.fromEntries(TEAMS.map((team) => [team, jungleShare(team)])),
    straightLineSeconds: [firstLeg, fastestAdjacent, hqDistance].map((value) => Number(value.toFixed(1))),
  };
  engine.dispose();
  return result;
}

const only = process.argv[2];
const selected = tacticalMaps.filter(({ id }) => !only || id === only);
if (!selected.length) throw new Error(`Unknown tactical map: ${only}`);
for (const arena of selected) for (const pair of pairs) console.log(JSON.stringify(play(arena, pair)));
