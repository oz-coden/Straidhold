import type { StreakNotice } from "./streak-banner.ts";

export const STREAK_QUEUE_LIMIT = 3;
const presentation = {
  3: { seconds: 1.55, scale: 0.025 },
  5: { seconds: 1.7, scale: 0.035 },
  10: { seconds: 1.95, scale: 0.045 },
  shutdown: { seconds: 1.8, scale: 0.035 },
};

function priority(notice: StreakNotice) {
  if (notice.kind === "shutdown") return 3;
  return notice.count === 10 ? 4 : notice.count === 5 ? 2 : 1;
}

export function createStreakQueue(ticksPerSecond: number) {
  const pending: StreakNotice[] = [];
  let active: { notice: StreakNotice; start: number } | undefined;

  function advance(tick: number) {
    if (active) {
      const { seconds } = active.notice.kind === "shutdown" ? presentation.shutdown : presentation[active.notice.count];
      if (tick - active.start >= Math.round(seconds * ticksPerSecond)) active = undefined;
    }
    if (!active) {
      const notice = pending.shift();
      if (notice) active = { notice, start: tick };
    }
  }

  return {
    enqueue(notice: StreakNotice, tick: number) {
      advance(tick);
      if (!active) {
        active = { notice, start: tick };
        return;
      }
      if (pending.length >= STREAK_QUEUE_LIMIT) {
        const lowest = Math.min(...pending.map(priority));
        if (priority(notice) <= lowest) return;
        pending.splice(pending.findIndex((item) => priority(item) === lowest), 1);
      }
      pending.push(notice);
    },
    frame(tick: number) {
      advance(tick);
      if (!active) return;
      const { notice, start } = active;
      const { seconds, scale } = notice.kind === "shutdown" ? presentation.shutdown : presentation[notice.count];
      const elapsed = (tick - start) / ticksPerSecond;
      const entry = Math.min(1, elapsed / 0.16);
      const exit = Math.max(0, Math.min(1, (seconds - elapsed) / 0.28));
      return { notice, opacity: entry * exit, scale: 1 - scale * (1 - entry) };
    },
    clear() {
      pending.length = 0;
      active = undefined;
    },
  };
}
