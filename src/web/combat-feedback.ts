import type { Team } from "../rules/arena.ts";
import { HZ } from "../rules/battle.ts";
import { STREAK_MILESTONES } from "../rules/contribution.ts";
import type { CombatEvent } from "../rules/combat-events.ts";

export const FEED_LIMIT = 5;
const FEED_TICKS = 5 * HZ;
const FADE_TICKS = HZ;
const CAPTURE_TICKS = 2 * HZ;
const teamName = { blue: "青", red: "赤" };

export function participantLabel(id: string) {
  const [team, slot] = id.split("-");
  return `${team.toUpperCase()} ${Number(slot) + 1}`;
}

export function feedMessage(event: Exclude<CombatEvent, { kind: "damage" }>, player: string, team: Team) {
  if (event.kind === "defeat") {
    const { attacker, target, assists, streak, stoppedStreak } = event;
    const killer = participantLabel(attacker);
    const defeated = participantLabel(target);
    const assisted = assists.includes(player);
    const personal = assisted || attacker === player || target === player;
    const milestone = STREAK_MILESTONES.some((count) => count === streak);
    const stopped = stoppedStreak >= STREAK_MILESTONES[0];
    const defeat = target === player ? `${killer} に撃破された`
      : attacker === player ? `${defeated} を撃破` : `${killer} が ${defeated} を撃破`;
    const text = stopped ? `${stoppedStreak}連続キル阻止！ ${killer} → ${defeated}`
      : milestone ? `${killer} が${streak}連続キル！ (${defeated} を撃破)` : defeat;
    const withMilestone = stopped && milestone ? `${text} · ${killer} が${streak}連続キル！` : text;
    return { text: assisted ? `${withMilestone}（アシスト）` : withMilestone, personal,
      highlight: stopped ? "shutdown" : milestone ? "streak" : undefined };
  }
  const personal = event.installer === player || event.guards.includes(player);
  if (personal) return { text: `拠点${event.site}の占領に成功`, personal };
  if (event.previous === team && event.team !== team) return { text: `拠点${event.site}を喪失`, personal };
  return { text: `${teamName[event.team]}チームが拠点${event.site}を占領`, personal };
}

export function createCombatFeed(host: HTMLElement, player: string, team: Team) {
  const visible: { node: HTMLElement; expires: number }[] = [];
  const captures = new Map<string, { text: string; expires: number }>();
  let sequence = 0;

  function update(events: readonly CombatEvent[], tick: number) {
    for (const event of events) {
      if (event.sequence <= sequence) continue;
      sequence = event.sequence;
      if (event.kind === "damage") continue;
      const { text, personal, highlight } = feedMessage(event, player, team);
      const node = document.createElement("li");
      node.textContent = text;
      node.title = text;
      node.dataset.team = event.team;
      node.dataset.kind = event.kind;
      if (highlight) node.dataset.highlight = highlight;
      node.dataset.sequence = String(event.sequence);
      node.dataset.personal = String(personal);
      host.append(node);
      visible.push({ node, expires: tick + FEED_TICKS });
      if (event.kind === "capture") {
        const status = event.previous === team && event.team !== team ? "喪失" : `${teamName[event.team]} 占領成功`;
        captures.set(event.site, { text: status, expires: tick + CAPTURE_TICKS });
      }
    }
    while (visible.length && (visible.length > FEED_LIMIT || visible[0].expires <= tick)) visible.shift()!.node.remove();
    for (const { node, expires } of visible) node.style.opacity = String(Math.min(1, (expires - tick) / FADE_TICKS));
    for (const [id, capture] of captures) if (capture.expires <= tick) captures.delete(id);
  }

  return {
    update,
    captureStatus: (id: string) => captures.get(id)?.text,
    dispose: () => host.replaceChildren(),
  };
}
