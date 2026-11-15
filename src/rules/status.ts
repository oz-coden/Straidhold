import type { Point } from "@simpludify/core";
import { distance, type Team } from "./arena.ts";

export type Modifier = "outgoingDamage" | "damageReduction" | "movementSlow" | "buffPower" | "debuffPower";

type EffectTarget = string
  | { readonly team: Team; readonly excludeSource: true }
  | { readonly team: Team; readonly center: Point; readonly radius: number };

interface Subject {
  readonly id: string;
  readonly team: Team;
  readonly position: Point;
}

export interface StatusEffect {
  readonly id: string;
  readonly sourceId: string;
  readonly target: EffectTarget;
  readonly modifier: Modifier;
  readonly strength: number;
  readonly endsAt: number;
}

export class StatusEffects {
  private entries: StatusEffect[] = [];

  add(effect: StatusEffect) { this.entries.push(effect); }

  expire(tick: number) {
    if (this.entries.some((effect) => effect.endsAt <= tick)) {
      this.entries = this.entries.filter((effect) => effect.endsAt > tick);
    }
  }

  clearTarget(id: string) {
    this.entries = this.entries.filter(({ target, endsAt }) => target !== id || endsAt === Infinity);
  }

  clear() { this.entries.length = 0; }

  all(): readonly StatusEffect[] { return this.entries; }

  effective(subject: Subject, modifier?: Modifier): readonly StatusEffect[] {
    const strongest = new Map<string, StatusEffect>();
    for (const effect of this.entries) {
      if (modifier && modifier !== effect.modifier) continue;
      const { target } = effect;
      const applies = typeof target === "string" ? target === subject.id
        : target.team === subject.team && ("center" in target
          ? distance(target.center, subject.position) <= target.radius
          : effect.sourceId !== subject.id);
      if (!applies) continue;
      const previous = strongest.get(effect.id);
      if (!previous || effect.strength > previous.strength
        || (effect.strength === previous.strength && effect.endsAt > previous.endsAt)) strongest.set(effect.id, effect);
    }
    return [...strongest.values()];
  }

  total(subject: Subject, modifier: Modifier): number {
    return this.effective(subject, modifier).reduce((sum, { strength }) => sum + strength, 0);
  }
}
