import assert from "node:assert/strict";
import { test } from "node:test";
import type { CombatEvent } from "../src/rules/combat-events.ts";
import { createStreakPresentation, personalStreakNotices } from "../src/web/streak-presentation.ts";
import { createStreakQueue } from "../src/web/streak-queue.ts";

const player = "blue-2";
const defeat: Extract<CombatEvent, { kind: "defeat" }> = {
  kind: "defeat", attacker: player, target: "red-1", team: "blue",
  round: 1, tick: 1, sequence: 1, assists: [], streak: 3, stoppedStreak: 0,
};

test("only the player's milestone and shutdown generate banners, including both for one defeat", () => {
  for (const count of [3, 5, 10]) {
    assert.deepEqual(personalStreakNotices({ ...defeat, streak: count }, player), [{ kind: "milestone", count }]);
  }
  assert.deepEqual(personalStreakNotices({ ...defeat, streak: 4, stoppedStreak: 2 }, player), []);
  for (const event of [
    { ...defeat, attacker: "blue-1", assists: [player] },
    { ...defeat, attacker: "red-1", target: player, stoppedStreak: 5 },
  ]) {
    assert.deepEqual(personalStreakNotices(event, player), []);
  }
  assert.deepEqual(personalStreakNotices({ ...defeat, streak: 5, stoppedStreak: 7 }, player), [
    { kind: "milestone", count: 5 }, { kind: "shutdown", count: 7 },
  ]);
});

test("queued notices play FIFO and elapsed time advances only with battle ticks", () => {
  const queue = createStreakQueue(60);
  queue.enqueue({ kind: "milestone", count: 3 }, 7);
  assert.equal(queue.frame(7)?.notice.count, 3);
  queue.enqueue({ kind: "milestone", count: 5 }, 7);
  queue.enqueue({ kind: "shutdown", count: 8 }, 7);
  const frame = queue.frame(19);
  assert.equal(frame?.opacity, 1);
  assert.deepEqual(queue.frame(19), frame);
  assert.ok(queue.frame(98)!.opacity < 1);
  assert.equal(queue.frame(100)?.notice.count, 5);
  assert.equal(queue.frame(202)?.notice.kind, "shutdown");
  assert.equal(queue.frame(310), undefined);
});

test("a full waiting queue evicts its oldest lowest-priority notice only for a stronger one", () => {
  const queue = createStreakQueue(60);
  queue.enqueue({ kind: "milestone", count: 3 }, 0);
  queue.enqueue({ kind: "milestone", count: 5 }, 0);
  queue.enqueue({ kind: "milestone", count: 3 }, 0);
  queue.enqueue({ kind: "shutdown", count: 7 }, 0);
  queue.enqueue({ kind: "milestone", count: 3 }, 0);
  queue.enqueue({ kind: "milestone", count: 10 }, 0);
  assert.equal(queue.frame(92)?.notice.count, 3);
  assert.equal(queue.frame(93)?.notice.count, 5);
  assert.equal(queue.frame(195)?.notice.count, 7);
  assert.equal(queue.frame(303)?.notice.count, 10);
  assert.equal(queue.frame(420), undefined);
});

test("presentation consumes each battle event once and clears pending work at round end", () => {
  const children: unknown[] = [];
  const host = {
    hidden: true, dataset: {} as DOMStringMap, textContent: "",
    style: { opacity: "", setProperty() {} },
    replaceChildren(...nodes: unknown[]) { children.splice(0, children.length, ...nodes); },
  };
  const presentation = createStreakPresentation(host as unknown as HTMLElement, player, 60);
  presentation.update([defeat, defeat], 1);
  assert.equal(host.hidden, false);
  assert.equal(host.textContent, "3連続キル！");
  presentation.update([defeat], 94);
  assert.equal(host.hidden, true);
  presentation.update([{ ...defeat, sequence: 2, streak: 5 }, { ...defeat, sequence: 3, streak: 10 }], 100);
  assert.equal(host.dataset.count, "5");
  presentation.clear();
  assert.equal(host.hidden, true);
  presentation.update([], 500);
  assert.equal(host.hidden, true);
  const nextRound = createStreakPresentation(host as unknown as HTMLElement, player, 60);
  nextRound.update([defeat], 1);
  assert.equal(host.dataset.count, "3");
});
