import assert from "node:assert/strict";
import test from "node:test";
import { ZERO } from "../src/rules/command.ts";
import { manualTouchAim } from "../src/web/touch-attack.ts";

test("touch attack requires both a held stick and a nonzero axis", () => {
  assert.equal(manualTouchAim(false, ZERO), null);
  assert.equal(manualTouchAim(true, ZERO), null);
  assert.equal(manualTouchAim(false, { x: 0, y: -1 }), null);
  assert.deepEqual(manualTouchAim(true, { x: 0, y: -1 }), { x: 0, y: -1 });
  assert.deepEqual(manualTouchAim(true, { x: 0.4, y: 0 }), { x: 0.4, y: 0 });
});
