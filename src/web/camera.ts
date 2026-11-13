import { CameraFollow, type Camera, type Point, type Viewport } from "@simpludify/web";
import type { Arena } from "../rules/arena.ts";

export const VISION_MARGIN = 1.10;
const MAX_ASPECT = 1.62;
const MIN_ASPECT = 1.02;
const EDGE_MARGIN = 68;

export function matchViewport(width: number, height: number): Viewport {
  const w = Math.min(width, height * MAX_ASPECT);
  const h = Math.min(height, width / MIN_ASPECT);
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export function followCamera(camera: Camera, viewport: Viewport, radius: number, arena: Arena) {
  const bounds = { x: -EDGE_MARGIN, y: -EDGE_MARGIN, width: arena.width + 2 * EDGE_MARGIN, height: arena.height + 2 * EDGE_MARGIN };
  const { width, height } = viewport;
  const follow = new CameraFollow(camera, { resolution: viewport, bounds });
  const zoom = Math.max(
    Math.min(width, height) / (2 * radius * VISION_MARGIN),
    width / arena.width,
    height / arena.height,
  );
  return (point: Point) => {
    camera.zoom = zoom;
    follow.update(point, 0);
  };
}
