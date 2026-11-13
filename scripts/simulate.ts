import { Engine } from "@simpludify/core";
import { createAI, type Strategy } from "../src/rules/ai.ts";
import { TEAMS, type Arena, type Team } from "../src/rules/arena.ts";
import { Battle, HZ, ROUND_SECONDS, STEP } from "../src/rules/battle.ts";
import { tacticalMaps } from "../src/rules/maps.ts";
import { measureTravel } from "./travel.ts";

const pairs = [
  { blue: "balanced", red: "balanced", seed: 0 },
  { blue: "flank", red: "center", seed: 1 },
  { blue: "center", red: "flank", seed: 1 },
  { blue: "balanced", red: "balanced", seed: 2 },
] as const satisfies readonly { blue: Strategy; red: Strategy; seed: number }[];

function play(arena: Arena, strategies: typeof pairs[number], travel: ReturnType<typeof measureTravel>) {
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
  let engagements = 0;
  let hitTick = 0;
  const hitGaps: number[] = [];
  const shotsPerMinute = Array.from({ length: 5 }, () => 0);
  const pairHits = new Map<string, number>();

  for (let i = 0; i < battle.duration; i++) {
    engine.step(STEP);
    for (let j = battle.shots.length - 1; j >= 0 && battle.shots[j].tick === battle.tick; j--) {
      const { from, to, impact } = battle.shots[j];
      const key = from.team === "blue" ? `${from.slot}:${to.slot}` : `${to.slot}:${from.slot}`;
      if (battle.tick - (pairHits.get(key) ?? -Infinity) >= HZ * 3) engagements++;
      pairHits.set(key, battle.tick);
      if (hitTick !== battle.tick) {
        if (hitTick) hitGaps.push(battle.tick - hitTick);
        hitTick = battle.tick;
      }
      shotsPerMinute[Math.floor((battle.tick - 1) / (HZ * 60))]++;
      firstHit ??= battle.tick / HZ;
      shots++;
      if (battle.supply.laneAt(impact) < 0) jungleShots++;
      const col = Math.min(4, Math.floor(5 * impact.x / arena.width)) + 1;
      const row = Math.min(2, Math.floor(3 * impact.y / arena.height)) + 1;
      const sector = `${col},${row}`;
      sectors[sector] = (sectors[sector] ?? 0) + 1;
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
  hitGaps.sort((a, b) => a - b);
  const p90Gap = (hitGaps[Math.ceil(hitGaps.length * 0.9) - 1] ?? 0) / HZ;
  const result = {
    map: arena.id, strategies, winner: battle.result, scores: battle.scores, kills: battle.kills,
    scoreGap: Math.abs(battle.scores.blue - battle.scores.red), firstHit, shots, jungleShots, sectors,
    captures, activated, cut, laneChanges,
    jungleMovePercent: Object.fromEntries(TEAMS.map((team) => [team, jungleShare(team)])),
    engagements, p90HitGapSeconds: p90Gap, shotsPerMinute,
    longestQuietAfterFirstHitSeconds: Math.max(hitGaps.at(-1) ?? 0, battle.duration - hitTick) / HZ,
    travel,
  };
  engine.dispose();
  return result;
}

const only = process.argv[2];
const selected = tacticalMaps.filter(({ id }) => !only || id === only);
if (!selected.length) throw new Error(`Unknown tactical map: ${only}`);
for (const arena of selected) {
  const travel = measureTravel(arena);
  for (const pair of pairs) console.log(JSON.stringify(play(arena, pair, travel)));
}
