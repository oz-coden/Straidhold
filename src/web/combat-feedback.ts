import type { Team } from "../rules/arena.ts";
import { HZ } from "../rules/battle.ts";
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

function feedMessage(event: Exclude<CombatEvent, { kind: "damage" }>, player: string, team: Team) {
  if (event.kind === "defeat") {
    const { attacker, target, assists } = event;
    if (target === player) return { text: `${participantLabel(attacker)} に撃破された`, personal: true };
    if (attacker === player) return { text: `${participantLabel(target)} を撃破`, personal: true };
    const assisted = assists.includes(player);
    const text = `${participantLabel(attacker)} が ${participantLabel(target)} を撃破`;
    return { text: assisted ? `${text}（アシスト）` : text, personal: assisted };
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
      const { text, personal } = feedMessage(event, player, team);
      const node = document.createElement("li");
      node.textContent = text;
      node.title = text;
      node.dataset.team = event.team;
      node.dataset.kind = event.kind;
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
