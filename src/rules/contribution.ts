import type { Team } from "./arena.ts";

export const POINT_UNITS = 1000;
export const POINTS = { kill: 20, assist: 10, installation: 20, guarding: 80 } as const;

export interface Participant {
  readonly id: string;
  readonly team: Team;
  readonly slot: number;
}

interface Totals {
  kills: number;
  assists: number;
  deaths: number;
  captures: number;
  installationUnits: number;
  guardingUnits: number;
}

export type ParticipantStats = Readonly<Participant & Totals>;

export function contributionUnits(stats: ParticipantStats) {
  return (stats.kills * POINTS.kill + stats.assists * POINTS.assist) * POINT_UNITS
    + stats.installationUnits + stats.guardingUnits;
}

export class RoundStats {
  private readonly participants = new Map<string, Participant & Totals>();
  private readonly attackers = new Map<string, Set<string>>();

  constructor(roster: readonly Participant[]) {
    for (const { id, team, slot } of roster) {
      this.participants.set(id, { id, team, slot, kills: 0, assists: 0, deaths: 0, captures: 0, installationUnits: 0, guardingUnits: 0 });
    }
  }

  snapshot(): readonly ParticipantStats[] {
    return Array.from(this.participants.values(), (row) => ({ ...row }));
  }

  recordDamage(attacker: Participant, target: Participant) {
    if (attacker.team === target.team) return;
    let attackers = this.attackers.get(target.id);
    if (!attackers) this.attackers.set(target.id, attackers = new Set());
    attackers.add(attacker.id);
  }

  clearDamage(target: string) { this.attackers.delete(target); }

  recordDefeat(attacker: Participant, target: Participant): readonly string[] {
    this.participants.get(attacker.id)!.kills++;
    this.participants.get(target.id)!.deaths++;
    const assists = Array.from(this.attackers.get(target.id) ?? [])
      .filter((id) => id !== attacker.id && this.participants.get(id)?.team === attacker.team);
    for (const id of assists) this.participants.get(id)!.assists++;
    this.clearDamage(target.id);
    return assists;
  }
}
