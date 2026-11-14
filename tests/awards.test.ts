import assert from "node:assert/strict";
import { test } from "node:test";
import { awardBonusUnits, awardUnits, selectAwards } from "../src/rules/awards.ts";
import { contributionUnits, emptyStats, type ParticipantStats } from "../src/rules/contribution.ts";
import { initialMatchSetup, MatchSeries } from "../src/web/game-flow.ts";
import { displayPoints } from "../src/web/match-results.ts";

function row(id: string, stats: Partial<ParticipantStats> = {}): ParticipantStats {
  return { ...emptyStats(), id, team: id.startsWith("blue") ? "blue" : "red", slot: Number(id.at(-1)), ...stats };
}

test("an exact base score selects a losing-team MVP even when bonuses change the final order", () => {
  const red = row("red-0", { guardingUnits: 100_002 });
  const blue = row("blue-0", { guardingUnits: 100_001, kills: 0, distanceMoved: 10, hpDamage: 10, hpRecovered: 10, shieldDamage: 3, maxStreak: 1 });
  const redPeer = row("red-1", { distanceMoved: 0.01, hpDamage: 0.01, hpRecovered: 0.01 });
  const match = new MatchSeries(initialMatchSetup(new URLSearchParams()));
  match.finishRound({ winner: "blue", scores: { blue: 9, red: 3 }, participants: [blue, red, redPeer] });
  const awards = match.awards!;
  const bonus = (id: string) => awardBonusUnits(awards.filter(({ participants }) => participants.includes(id)));
  assert.deepEqual(awards.find(({ id }) => id === "mvp")?.participants, [red.id]);
  assert.deepEqual(awards.filter(({ id }) => id === "team-mvp").map(awardUnits), [0, 0]);
  assert.equal(bonus(blue.id), 135_000);
  assert.equal(bonus(red.id), 130_000);
  assert.ok(contributionUnits(blue) + bonus(blue.id) > contributionUnits(red) + bonus(red.id));
  assert.equal(displayPoints(contributionUnits(blue)), displayPoints(contributionUnits(red)));
  assert.equal(match.winner, "blue");
  assert.deepEqual(match.scoreTotals, { blue: 9, red: 3 });
  assert.equal(match.awards, awards);
});

test("competition ranking handles tied first, tied second, streak first only, and zero categories", () => {
  const awards = selectAwards([
    row("red-0", { kills: 4, assists: 3, maxStreak: 3 }),
    row("blue-0", { kills: 4, assists: 1, maxStreak: 3 }),
    row("blue-1", { kills: 2, assists: 1, maxStreak: 2 }),
    row("red-1", { kills: 0, maxStreak: 0 }),
  ]);
  const groups = (key: string) => awards.filter(({ id }) => id === key)
    .map(({ rank, participants, ...award }) => [rank, participants, awardUnits({ rank, participants, ...award })]);
  assert.deepEqual(groups("kills"), [[1, ["blue-0", "red-0"], 30_000]]);
  assert.deepEqual(groups("assists"), [[1, ["red-0"], 30_000], [2, ["blue-0", "blue-1"], 15_000]]);
  assert.deepEqual(groups("streak"), [[1, ["blue-0", "red-0"], 30_000]]);
  assert.deepEqual(groups("captures"), []);
  assert.deepEqual(groups("damage"), []);
  assert.deepEqual(groups("recovery"), []);
  const tie = selectAwards([row("blue-0", { kills: 2 }), row("red-0", { assists: 4 })]);
  const mvp = tie.find(({ id }) => id === "mvp")!;
  assert.deepEqual(mvp.participants, ["blue-0", "red-0"]);
  assert.equal(awardUnits(mvp), 100_000);
  assert.deepEqual(selectAwards([row("blue-0"), row("red-0")]).map(({ id }) => id), ["mvp", "team-mvp", "team-mvp"]);
});

test("series awards only after the last round and takes the maximum streak, not the sum", () => {
  const setup = initialMatchSetup(new URLSearchParams());
  const match = new MatchSeries({ ...setup, rule: "series" });
  for (const maxStreak of [2, 5, 3]) {
    assert.equal(match.awards, undefined);
    match.finishRound({ winner: "red", scores: { red: 2, blue: 0 }, participants: [
      row("blue-0", { maxStreak, distanceMoved: 3.5, shieldDamage: 1.5, hpRecovered: 2 }),
      row("red-0"),
    ] });
  }
  const blue = match.participantTotals[0];
  assert.equal(blue.maxStreak, 5);
  assert.equal(blue.currentStreak, 0);
  assert.equal(blue.distanceMoved, 10.5);
  assert.equal(blue.shieldDamage, 4.5);
  assert.equal(blue.hpRecovered, 6);
  assert.deepEqual(match.awards?.find(({ id }) => id === "streak")?.participants, [blue.id]);
  assert.equal(new MatchSeries(match.setup).awards, undefined);
  assert.deepEqual([1_563_867, 1_528_889, 552_621, 500].map(displayPoints), ["1,564 pt", "1,529 pt", "553 pt", "1 pt"]);
});
