import type { Team } from "./arena.ts";

export const CLASSES = {
  assassin: { name: "アサシン", icon: "⚔", active: "戦闘昂揚", target: "self", duration: 5, cooldown: 30,
    damageBoost: 0.2, speedBoost: 0.1, supplyRamp: 0.5, supplySlow: 0.5, supplyRecovery: 0.5 },
  tank: { name: "タンク", icon: "◆", active: "護衛リンク", target: "ally", duration: 5, cooldown: 35,
    range: 180, reduction: 0.2, share: 0.5, maxLinks: 2 },
  recon: { name: "リコン", icon: "◎", active: "索敵パルス", target: "self", duration: 5, cooldown: 25,
    radius: 320, visionBoost: 0.2 },
  control: { name: "コントロール", icon: "▧", active: "減速領域", target: "point", duration: 6, cooldown: 30,
    range: 180, radius: 96, slow: 0.25, debuffBoost: 0.2 },
  support: { name: "サポート", icon: "✚", active: "特殊バリア", target: "ally", duration: 15, cooldown: 35,
    range: 180, capacity: 100, buffBoost: 0.2 },
} as const;

export type ClassId = keyof typeof CLASSES;
export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];
export const PLAYER_ID = "blue-2";

export type Lineup = Readonly<Record<Team, readonly ClassId[]>>;

export const STANDARD_LINEUP: Lineup = { blue: CLASS_IDS, red: CLASS_IDS };

export function soloLineup(selected: ClassId): Lineup {
  const allies = CLASS_IDS.filter((id) => id !== selected);
  allies.splice(2, 0, selected);
  return { blue: allies, red: CLASS_IDS };
}
