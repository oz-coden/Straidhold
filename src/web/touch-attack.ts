import type { Command } from "../rules/command.ts";

export function touchAttack(pressed: boolean, direction: NonNullable<Command["aim"]>): Pick<Command, "aim" | "attack"> {
  return {
    aim: pressed && (direction.x !== 0 || direction.y !== 0) ? direction : null,
    attack: pressed,
  };
}
