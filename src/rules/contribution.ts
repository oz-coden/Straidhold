import type { Team } from "./arena.ts";

export const POINT_UNITS = 1000;
export const POINTS = { kill: 20, assist: 10, installation: 20, guarding: 80 } as const;

export interface Participant {
  readonly id: string;
  readonly team: Team;
  readonly slot: number;
}

export const STREAK_MILESTONES: readonly number[] = [3, 5, 10];

const additiveStats = [
  "kills", "assists", "deaths", "captures", "installationUnits", "guardingUnits",
  "distanceMoved", "shieldDamage", "hpDamage", "shieldRecovered", "hpRecovered",
] as const;

export function emptyStats() {
  return {
    kills: 0, assists: 0, deaths: 0, captures: 0, installationUnits: 0, guardingUnits: 0,
    distanceMoved: 0, shieldDamage: 0, hpDamage: 0, shieldRecovered: 0, hpRecovered: 0,
    currentStreak: 0, maxStreak: 0,
  };
}

type Totals = ReturnType<typeof emptyStats>;
export type ParticipantStats = Readonly<Participant & Totals>;

export function contributionUnits(stats: ParticipantStats) {
  return (stats.kills * POINTS.kill + stats.assists * POINTS.assist) * POINT_UNITS
    + stats.installationUnits + stats.guardingUnits;
}

// Every possible number of guards on a five-person team divides 60.
const SHARE_PER_TICK = 60;

export class CaptureContribution {
  private readonly shares = new Map<string, number>();

  readonly installer: string;

  constructor(installer: string) { this.installer = installer; }

  advance(guards: readonly Participant[]) {
    const share = SHARE_PER_TICK / guards.length;
    for (const { id } of guards) this.shares.set(id, (this.shares.get(id) ?? 0) + share);
  }

  distribute(): readonly { id: string; units: number }[] {
    const total = Array.from(this.shares.values()).reduce((sum, share) => sum + share, 0);
    const pool = POINTS.guarding * POINT_UNITS;
    const awards = Array.from(this.shares, ([id, share]) => ({
      id,
      units: Math.floor(pool * share / total),
      remainder: pool * share % total,
    }));
    awards.sort((a, b) => b.remainder - a.remainder || (a.id < b.id ? -1 : a.id === b.id ? 0 : 1));
    const remaining = pool - awards.reduce((sum, { units }) => sum + units, 0);
    for (let i = 0; i < remaining; i++) awards[i].units++;
    return awards;
  }
}

export class RoundStats {
  private readonly participants = new Map<string, Participant & Totals>();
  private readonly attackers = new Map<string, Set<string>>();

  constructor(roster: readonly Participant[]) {
    for (const { id, team, slot } of roster) {
      this.participants.set(id, { id, team, slot, ...emptyStats() });
    }
  }

  snapshot(): readonly ParticipantStats[] {
    return Array.from(this.participants.values(), (row) => ({ ...row }));
  }

  recordCapture(contribution: CaptureContribution) {
    // Even a defeated installer retains their roster slot until the round ends.
    const installer = this.participants.get(contribution.installer);
    if (!installer) throw new Error("Capture installer must belong to the round roster");
    installer.captures++;
    installer.installationUnits += POINTS.installation * POINT_UNITS;
    const awards = contribution.distribute();
    for (const { id, units } of awards) this.participants.get(id)!.guardingUnits += units;
    return awards.map(({ id }) => id);
  }

  recordMovement(id: string, amount: number) {
    this.participants.get(id)!.distanceMoved += amount;
  }

  recordRecovery(id: string, shield: number, hp: number) {
    const row = this.participants.get(id)!;
    row.shieldRecovered += shield;
    row.hpRecovered += hp;
    this.clearDamage(id);
  }

  currentStreak(id: string) { return this.participants.get(id)!.currentStreak; }

  resetStreak(id: string) { this.participants.get(id)!.currentStreak = 0; }

  finishRound() {
    for (const row of this.participants.values()) row.currentStreak = 0;
  }

  recordDamage(attacker: Participant, target: Participant, shield: number, hp: number) {
    const row = this.participants.get(target.id)!;
    row.shieldDamage += shield;
    row.hpDamage += hp;
    if (attacker.team === target.team) return;
    let attackers = this.attackers.get(target.id);
    if (!attackers) this.attackers.set(target.id, attackers = new Set());
    attackers.add(attacker.id);
  }

  clearDamage(target: string) { this.attackers.delete(target); }

  recordDefeat(attacker: Participant, target: Participant) {
    const row = this.participants.get(attacker.id)!;
    row.kills++;
    row.currentStreak++;
    row.maxStreak = Math.max(row.maxStreak, row.currentStreak);
    this.participants.get(target.id)!.deaths++;
    const assists = Array.from(this.attackers.get(target.id) ?? [])
      .filter((id) => id !== attacker.id && this.participants.get(id)?.team === attacker.team);
    for (const id of assists) this.participants.get(id)!.assists++;
    this.clearDamage(target.id);
    return { assists, streak: row.currentStreak };
  }
}

export function totalParticipants(rounds: readonly (readonly ParticipantStats[])[]): readonly ParticipantStats[] {
  const totals = new Map<string, Participant & Totals>();
  for (const round of rounds) {
    for (const row of round) {
      const total = totals.get(row.id);
      if (!total) {
        totals.set(row.id, { ...row, currentStreak: 0 });
        continue;
      }
      for (const key of additiveStats) total[key] += row[key];
      total.maxStreak = Math.max(total.maxStreak, row.maxStreak);
    }
  }
  return [...totals.values()];
}
