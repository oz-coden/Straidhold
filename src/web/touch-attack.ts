import type { Command } from "../rules/command.ts";

export function manualTouchAim(pressed: boolean, direction: NonNullable<Command["aim"]>): Command["aim"] {
  return pressed && (direction.x !== 0 || direction.y !== 0) ? direction : null;
}
