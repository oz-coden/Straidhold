import type { Game, Point, ViewTransform } from "@simpludify/web";
import { HEIGHT, WIDTH } from "../rules/arena.ts";
import type { TeamVision, VisionUnit } from "../rules/vision.ts";

const MASK_SCALE = 0.5;
const MASK_WIDTH = WIDTH * MASK_SCALE;
const MASK_HEIGHT = HEIGHT * MASK_SCALE;
const fogColor = "rgba(4, 9, 17, .73)";

export function createFog<T extends VisionUnit>(game: Game<"briefing" | "match">, container: HTMLElement, vision: TeamVision<T>) {
  const overlay = document.createElement("canvas");
  overlay.className = "fog";
  overlay.setAttribute("aria-hidden", "true");
  const mask = document.createElement("canvas");
  mask.width = MASK_WIDTH;
  mask.height = MASK_HEIGHT;
  const maskContext = mask.getContext("2d")!;
  const context = overlay.getContext("2d")!;
  let previous: ViewTransform | undefined;
  let revision = -1;

  function paint() {
    const maskChanged = revision !== vision.outlineRevision;
    if (maskChanged) {
      revision = vision.outlineRevision;
      redrawMask();
      // Erase the union of the openings. The same mask also sits over the minimap.
      vision.visitOutlines((outline) => {
        maskContext.beginPath();
        outline.forEach((point: Point, i) => {
          if (i === 0) maskContext.moveTo(point.x, point.y);
          else maskContext.lineTo(point.x, point.y);
        });
        maskContext.closePath();
        maskContext.fill();
      });
    }

    const view = game.view;
    if (!maskChanged && view === previous) return;
    previous = view;
    const { clip, scale, x, y } = view;
    const width = Math.ceil(clip.width * MASK_SCALE);
    const height = Math.ceil(clip.height * MASK_SCALE);
    if (width <= 0 || height <= 0) return;
    if (overlay.width !== width) overlay.width = width;
    if (overlay.height !== height) overlay.height = height;
    overlay.style.left = `${clip.x}px`;
    overlay.style.top = `${clip.y}px`;
    overlay.style.width = `${clip.width}px`;
    overlay.style.height = `${clip.height}px`;
    context.setTransform(width / clip.width, 0, 0, height / clip.height, 0, 0);
    context.clearRect(0, 0, clip.width, clip.height);
    context.drawImage(mask, x - clip.x, y - clip.y, WIDTH * scale, HEIGHT * scale);
  }

  function redrawMask() {
    maskContext.setTransform(1, 0, 0, 1, 0, 0);
    maskContext.globalCompositeOperation = "source-over";
    maskContext.clearRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
    maskContext.fillStyle = fogColor;
    maskContext.fillRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
    maskContext.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
    maskContext.globalCompositeOperation = "destination-out";
    maskContext.fillStyle = "#000";
  }

  // Both views use the exact same mask. Refresh the base only before changed outlines.
  return {
    mask,
    mount() { container.append(overlay); },
    paint,
    dispose() {
      overlay.remove();
      mask.width = mask.height = overlay.width = overlay.height = 0;
    },
  };
}
