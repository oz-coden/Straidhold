import { HZ } from "../rules/battle.ts";
import type { CombatEvent } from "../rules/combat-events.ts";

const HIT_TICKS = Math.round(0.28 * HZ);
const IMPACT_TICKS = Math.round(0.4 * HZ);
type Impact = "shield" | "hp" | "lethal";
const priority: Record<Impact, number> = { shield: 1, hp: 2, lethal: 3 };
const glyph: Record<Impact, string> = { shield: "◇", hp: "×", lethal: "✦" };

export function createHitFeedback(marker: HTMLElement, screenEdge: HTMLElement, vitals: HTMLElement, player: string) {
  let hit: { type: Impact; tick: number } | undefined;
  let impact: { type: Impact; tick: number } | undefined;
  let lastTick = 0;

  function paint(node: HTMLElement, effect: { type: Impact; tick: number } | undefined, tick: number, duration: number) {
    const opacity = effect ? Math.max(0, 1 - (tick - effect.tick) / duration) : 0;
    node.hidden = !opacity;
    if (effect && opacity) {
      node.dataset.impact = effect.type;
      node.style.opacity = String(opacity);
    } else {
      delete node.dataset.impact;
    }
  }

  return {
    update(events: readonly CombatEvent[], tick: number) {
      if (tick === lastTick) return;
      lastTick = tick;
      let outgoing: Impact | undefined;
      let incoming: Impact | undefined;
      for (const event of events) {
        if (event.kind !== "damage") continue;
        const type = event.lethal ? "lethal" : event.hp > 0 ? "hp" : "shield";
        if (event.attacker === player && (!outgoing || priority[type] > priority[outgoing])) outgoing = type;
        if (event.target === player && (!incoming || priority[type] > priority[incoming])) incoming = type;
      }
      if (outgoing) {
        hit = { type: outgoing, tick };
        marker.textContent = glyph[outgoing];
      }
      if (incoming && (!impact || tick - impact.tick >= IMPACT_TICKS || priority[incoming] > priority[impact.type])) {
        impact = { type: incoming, tick };
      }
      paint(marker, hit, tick, HIT_TICKS);
      paint(screenEdge, impact, tick, IMPACT_TICKS);
      if (screenEdge.dataset.impact) vitals.dataset.impact = screenEdge.dataset.impact;
      else delete vitals.dataset.impact;
    },
    dispose() {
      marker.hidden = screenEdge.hidden = true;
      delete marker.dataset.impact;
      delete screenEdge.dataset.impact;
      delete vitals.dataset.impact;
    },
  };
}
