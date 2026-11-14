import assert from "node:assert/strict";
import test from "node:test";
import { ZERO } from "../src/rules/command.ts";
import { touchAttack } from "../src/web/touch-attack.ts";

test("touch attack follows the current press and uses auto-aim at zero direction", () => {
  const right = { x: 0.4, y: 0 };
  assert.deepEqual(touchAttack(false, ZERO), { aim: null, attack: false });
  assert.deepEqual(touchAttack(true, ZERO), { aim: null, attack: true });
  assert.deepEqual(touchAttack(true, right), { aim: right, attack: true });
  assert.deepEqual(touchAttack(true, ZERO), { aim: null, attack: true });
  assert.deepEqual(touchAttack(false, right), { aim: null, attack: false });
});
