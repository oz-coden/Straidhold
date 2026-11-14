import { TEAMS, type Team } from "./arena.ts";
import { contributionUnits, POINT_UNITS, type ParticipantStats } from "./contribution.ts";

export const AWARD_POINTS = { mvp: 100, first: 30, second: 15, streak: 30 } as const;

export type AwardId = "mvp" | "team-mvp" | "kills" | "assists" | "captures" | "guarding"
  | "movement" | "damage" | "recovery" | "streak";

export interface Award {
  readonly id: AwardId;
  readonly title: string;
  readonly rank: number;
  readonly participants: readonly string[];
  readonly team?: Team;
}

const rankings = [
  { id: "kills", title: "最多キル", metric: (row: ParticipantStats) => row.kills },
  { id: "assists", title: "最多アシスト", metric: (row: ParticipantStats) => row.assists },
  { id: "captures", title: "最多占領", metric: (row: ParticipantStats) => row.captures },
  { id: "guarding", title: "占領維持の達人", metric: (row: ParticipantStats) => row.guardingUnits },
  { id: "movement", title: "最多移動", metric: (row: ParticipantStats) => row.distanceMoved },
  { id: "damage", title: "最多被ダメージ", metric: (row: ParticipantStats) => row.shieldDamage + row.hpDamage },
  { id: "recovery", title: "最多自己回復", metric: (row: ParticipantStats) => row.shieldRecovered + row.hpRecovered },
  { id: "streak", title: "最多キルストリーク", metric: (row: ParticipantStats) => row.maxStreak },
] as const;

function place(rows: readonly ParticipantStats[], metric: (row: ParticipantStats) => number, limit: number) {
  const sorted = rows.map((row) => ({ id: row.id, value: metric(row) }))
    .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups: { rank: number; value: number; participants: string[] }[] = [];
  for (const [index, row] of sorted.entries()) {
    const previous = groups.at(-1);
    if (previous?.value === row.value) previous.participants.push(row.id);
    else if (index < limit) groups.push({ rank: index + 1, value: row.value, participants: [row.id] });
    else break;
  }
  return groups;
}

export function selectAwards(rows: readonly ParticipantStats[]): readonly Award[] {
  const awards: Award[] = [];
  for (const { rank, participants } of place(rows, contributionUnits, 1)) {
    awards.push({ id: "mvp", title: "試合MVP", rank, participants });
  }
  for (const team of TEAMS) {
    for (const { rank, participants } of place(rows.filter((row) => row.team === team), contributionUnits, 1)) {
      awards.push({ id: "team-mvp", title: team === "blue" ? "青チームMVP" : "赤チームMVP", rank, participants, team });
    }
  }
  for (const { id, title, metric } of rankings) {
    const groups = place(rows, metric, id === "streak" ? 1 : 2);
    if (!groups.length || groups[0].value === 0) continue;
    for (const { rank, participants } of groups) {
      awards.push({ id, title, rank, participants });
    }
  }
  return awards;
}

export function awardUnits(award: Award) {
  if (award.id === "team-mvp") return 0;
  if (award.id === "mvp") return AWARD_POINTS.mvp * POINT_UNITS;
  if (award.id === "streak") return AWARD_POINTS.streak * POINT_UNITS;
  return (award.rank === 1 ? AWARD_POINTS.first : AWARD_POINTS.second) * POINT_UNITS;
}

export function awardBonusUnits(awards: readonly Award[]) {
  return awards.reduce((total, award) => total + awardUnits(award), 0);
}
