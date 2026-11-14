import type { Team } from "./arena.ts";

type EventDetails =
  | { readonly kind: "damage"; readonly attacker: string; readonly target: string; readonly team: Team;
      readonly shield: number; readonly hp: number; readonly lethal: boolean }
  | { readonly kind: "defeat"; readonly attacker: string; readonly target: string; readonly team: Team;
      readonly assists: readonly string[] }
  | { readonly kind: "capture"; readonly site: string; readonly team: Team; readonly previous: Team | null;
      readonly installer: string; readonly guards: readonly string[] };

export type CombatEvent = EventDetails & { readonly round: number; readonly tick: number; readonly sequence: number };

export class CombatEvents {
  private readonly current: CombatEvent[] = [];
  private sequence = 0;
  private tick = 0;

  private readonly round: number;

  constructor(round: number) { this.round = round; }

  get events(): readonly CombatEvent[] { return this.current; }

  beginTick(tick: number) {
    this.tick = tick;
    this.current.length = 0;
  }

  record(details: EventDetails) {
    this.current.push({ ...details, round: this.round, tick: this.tick, sequence: ++this.sequence });
  }
}
