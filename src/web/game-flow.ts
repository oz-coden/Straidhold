import { ROUND_SECONDS } from "../rules/battle.ts";
import type { Arena, Team } from "../rules/arena.ts";
import { arenas } from "../rules/maps.ts";

export const RULES = {
  single: { label: "1ラウンド", winsToFinish: 1 },
  series: { label: "3ラウンド先取", winsToFinish: 3 },
} as const;
export type RuleId = keyof typeof RULES;

export const CHARACTERS = {
  assassin: "アサシン",
  tank: "タンク",
  recon: "リコン",
  control: "コントロール",
  support: "サポート",
} as const;
export type CharacterId = keyof typeof CHARACTERS;
export const PLAYER_ID = "blue-2";

export interface MatchSetup {
  readonly arena: Arena;
  readonly rule: RuleId;
  readonly character: CharacterId;
  readonly roundSeconds: number;
}

export type RoundWinner = Team | "draw";
export interface RoundResult {
  readonly winner: RoundWinner;
  readonly scores: Readonly<Record<Team, number>>;
}

export class MatchSeries {
  readonly setup: MatchSetup;
  private readonly completed: RoundResult[] = [];

  constructor(setup: MatchSetup) {
    this.setup = { ...setup };
  }

  get rounds(): readonly RoundResult[] { return this.completed; }

  get wins(): Record<Team, number> {
    const wins = { blue: 0, red: 0 };
    for (const { winner } of this.completed) {
      if (winner !== "draw") wins[winner]++;
    }
    return wins;
  }

  get winner(): RoundWinner | null {
    const last = this.completed.at(-1);
    if (!last) return null;
    if (this.setup.rule === "single") return last.winner;
    const { blue, red } = this.wins;
    const goal = RULES[this.setup.rule].winsToFinish;
    return blue === goal ? "blue" : red === goal ? "red" : null;
  }

  finishRound(result: RoundResult) {
    if (this.winner !== null) throw new Error("Match is already complete");
    this.completed.push({ winner: result.winner, scores: { ...result.scores } });
  }
}

export function initialMatchSetup(query: URLSearchParams): MatchSetup {
  const duration = query.get("round") ?? "";
  const seconds = Number(duration);
  return {
    arena: arenas.find(({ id }) => id === query.get("map")) ?? arenas[0],
    rule: "single",
    character: "recon",
    roundSeconds: /^\d{1,3}$/.test(duration) && seconds >= 5 && seconds <= ROUND_SECONDS
      ? seconds
      : ROUND_SECONDS,
  };
}

export type Screen = "title" | "setup" | "character" | "lobby" | "battle" | "result";

export function showScreen<T extends Screen>(screens: Readonly<Record<T, HTMLElement>>, screen: T) {
  for (const id of Object.keys(screens) as T[]) screens[id].hidden = id !== screen;
  screens[screen].querySelector<HTMLElement>("[data-screen-focus]")?.focus({ preventScroll: true });
}
