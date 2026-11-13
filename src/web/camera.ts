import { CameraFollow, type Camera, type Point, type Viewport } from "@simpludify/web";
import { HEIGHT, WIDTH } from "../rules/arena.ts";

export const VISION_MARGIN = 1.10;
const MAX_ASPECT = 1.62;
const MIN_ASPECT = 1.02;
const EDGE_MARGIN = 68;
const bounds = { x: -EDGE_MARGIN, y: -EDGE_MARGIN, width: WIDTH + 2 * EDGE_MARGIN, height: HEIGHT + 2 * EDGE_MARGIN };

export function matchViewport(width: number, height: number): Viewport {
  const w = Math.min(width, height * MAX_ASPECT);
  const h = Math.min(height, width / MIN_ASPECT);
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export function followCamera(camera: Camera, viewport: Viewport, radius: number) {
  const { width, height } = viewport;
  const follow = new CameraFollow(camera, { resolution: viewport, bounds });
  const zoom = Math.max(
    Math.min(width, height) / (2 * radius * VISION_MARGIN),
    width / WIDTH,
    height / HEIGHT,
  );
  return (point: Point) => {
    camera.zoom = zoom;
    follow.update(point, 0);
  };
}
