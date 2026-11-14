import assert from "node:assert/strict";
import { test } from "node:test";
import { HZ, ROUND_SECONDS } from "../src/rules/battle.ts";
import { initialMatchSetup, MatchSeries, RoundPreparation } from "../src/web/game-flow.ts";

test("match setup accepts known maps and integer round durations", () => {
  const setup = initialMatchSetup(new URLSearchParams("map=training&round=12"));
  assert.equal(setup.arena.id, "training");
  assert.equal(setup.roundSeconds, 12);
  for (const round of ["", "4", "301", "5.5", " 5", "1e2"]) {
    assert.equal(initialMatchSetup(new URLSearchParams({ round })).roundSeconds, ROUND_SECONDS);
  }
});

test("a series counts decisive round wins and keeps a snapshot of the results", () => {
  const setup = initialMatchSetup(new URLSearchParams());
  const scores = { blue: 5, red: 3 };
  const single = new MatchSeries(setup);
  single.finishRound({ winner: "draw", scores, participants: [] });
  assert.equal(single.winner, "draw");

  const series = new MatchSeries({ ...setup, rule: "series" });
  for (const winner of ["blue", "draw", "red", "blue", "blue"] as const) {
    assert.equal(series.winner, null);
    series.finishRound({ winner, scores, participants: [] });
  }
  scores.blue = 0;
  assert.equal(series.rounds[0].scores.blue, 5);
  assert.deepEqual(series.wins, { blue: 3, red: 1 });
  assert.equal(series.winner, "blue");
  assert.throws(() => series.finishRound({ winner: "red", scores, participants: [] }));
});

test("preparation and countdown use fixed ticks and skipping keeps the full countdown", () => {
  const intro = new RoundPreparation(true);
  assert.equal(intro.remaining, 10);
  assert.equal(intro.phase, "preparation");
  for (let i = 0; i < 10 * HZ; i++) intro.advance();
  assert.equal(intro.phase, "countdown");
  assert.equal(intro.remaining, 3);
  for (let i = 0; i < 3 * HZ; i++) intro.advance();
  assert.equal(intro.advance(), "combat");
  assert.equal(intro.remaining, 0);

  const next = new RoundPreparation(false);
  assert.equal(next.remaining, 60);
  next.skipPreparation();
  assert.equal(next.phase, "countdown");
  assert.equal(next.remaining, 3);
  next.advance();
  next.skipPreparation();
  for (let i = 0; i < 3 * HZ - 1; i++) next.advance();
  assert.equal(next.phase, "combat");
});

test("series adds exact participant units and team scores without changing round snapshots", () => {
  const setup = initialMatchSetup(new URLSearchParams());
  const series = new MatchSeries({ ...setup, rule: "series" });
  const row = { id: "blue-2", team: "blue" as const, slot: 2, kills: 2, assists: 1, deaths: 1, captures: 1, installationUnits: 20_000, guardingUnits: 26_667 };
  series.finishRound({ winner: "blue", scores: { blue: 7, red: 2 }, participants: [row] });
  row.kills = 4;
  series.finishRound({ winner: "red", scores: { blue: 3, red: 9 }, participants: [row] });
  assert.equal(series.rounds[0].participants[0].kills, 2);
  assert.deepEqual(series.scoreTotals, { blue: 10, red: 11 });
  assert.deepEqual(series.participantTotals, [{ ...row, kills: 6, assists: 2, deaths: 2,
    captures: 2, installationUnits: 40_000, guardingUnits: 53_334 }]);
  const rematch = new MatchSeries(series.setup);
  assert.deepEqual(rematch.participantTotals, []);
  assert.deepEqual(rematch.scoreTotals, { blue: 0, red: 0 });
});
