import assert from "node:assert/strict";
import { test } from "node:test";
import type { CombatEvent } from "../src/rules/combat-events.ts";
import { feedMessage } from "../src/web/combat-feedback.ts";

const defeat: Extract<CombatEvent, { kind: "defeat" }> = {
  kind: "defeat", attacker: "red-1", target: "blue-2", team: "red",
  round: 1, tick: 100, sequence: 1, assists: [], streak: 1, stoppedStreak: 0,
};

test("only the 3, 5, and 10 kill milestones replace the ordinary defeat message", () => {
  const messages = Array.from({ length: 11 }, (_, index) => {
    const streak = index + 1;
    return [streak, feedMessage({ ...defeat, streak }, "blue-1", "blue")] as const;
  });
  assert.deepEqual(messages.filter(([, notice]) => notice.highlight).map(([streak]) => streak), [3, 5, 10]);
  for (const [streak, notice] of messages) {
    if (notice.highlight === "streak") assert.match(notice.text, new RegExp(`RED 2 が${streak}連続キル`));
  }
  assert.match(messages[0][1].text, /RED 2 が BLUE 3 を撃破/);
});

test("a shutdown and killer milestone share the defeat row and retain player emphasis", () => {
  const stopped = feedMessage({ ...defeat, streak: 5, stoppedStreak: 7 }, "blue-2", "blue");
  assert.equal(stopped.highlight, "shutdown");
  assert.equal(stopped.personal, true);
  assert.match(stopped.text, /7連続キル阻止！ RED 2 → BLUE 3.*RED 2 が5連続キル/);
  assert.equal(feedMessage({ ...defeat, stoppedStreak: 2 }, "blue-2", "blue").highlight, undefined);
});
