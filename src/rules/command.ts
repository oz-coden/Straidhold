import type { Point } from "@simpludify/core";

export interface Command {
  readonly move: Point;
  readonly aim: Point | null;
  readonly attack: boolean;
  readonly deploy: boolean;
}

export const ZERO: Point = Object.freeze({ x: 0, y: 0 });
export const IDLE: Command = Object.freeze({ move: ZERO, aim: null, attack: false, deploy: false });

function direction(point: Point, normalize: boolean): Point {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return ZERO;
  const x = Math.max(-1e6, Math.min(1e6, point.x));
  const y = Math.max(-1e6, Math.min(1e6, point.y));
  const length = Math.hypot(x, y);
  if (length === 0) return ZERO;
  const divisor = normalize ? length : Math.max(1, length);
  return { x: x / divisor, y: y / divisor };
}

export function validate(command: Command): Command {
  const aim = command.aim ? direction(command.aim, true) : ZERO;
  return {
    move: direction(command.move, false),
    aim: aim === ZERO ? null : aim,
    attack: command.attack === true,
    deploy: command.deploy === true,
  };
}
