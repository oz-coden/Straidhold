import type { CombatEvent } from "../rules/combat-events.ts";
import { STREAK_MILESTONES } from "../rules/contribution.ts";
import { createStreakBanner, type StreakNotice } from "./streak-banner.ts";
import { createStreakQueue } from "./streak-queue.ts";

export function personalStreakNotices(event: CombatEvent, player: string): readonly StreakNotice[] {
  if (event.kind !== "defeat" || event.attacker !== player) return [];
  const notices: StreakNotice[] = [];
  const milestone = STREAK_MILESTONES.find((count) => count === event.streak);
  if (milestone) notices.push({ kind: "milestone", count: milestone });
  if (event.stoppedStreak >= STREAK_MILESTONES[0]) notices.push({ kind: "shutdown", count: event.stoppedStreak });
  return notices;
}

export function createStreakPresentation(host: HTMLElement, player: string, ticksPerSecond: number) {
  const queue = createStreakQueue(ticksPerSecond);
  const banner = createStreakBanner(host);
  // The battle issues monotonically increasing sequences within this scene.
  let lastSequence = 0;
  return {
    update(events: readonly CombatEvent[], tick: number) {
      for (const event of events) {
        if (event.sequence <= lastSequence) continue;
        lastSequence = event.sequence;
        for (const notice of personalStreakNotices(event, player)) queue.enqueue(notice);
      }
      const frame = queue.frame(tick);
      banner.paint(frame?.notice, frame?.opacity, frame?.scale);
    },
    clear() {
      queue.clear();
      banner.paint(undefined);
    },
  };
}
