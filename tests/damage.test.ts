import assert from "node:assert/strict";
import test from "node:test";
import { beginDamage, resolveDamage, type DamageRequest } from "../src/rules/damage.ts";

const request: DamageRequest = { attackId: "11:0", attackerId: "blue-2", targetId: "red-1", baseDamage: 10 };

test("damage retains the original request and reports actual losses separately", () => {
  const context = beginDamage(request);
  assert.deepEqual(context, { request, targetId: "red-1", amount: 10 });
  assert.deepEqual(resolveDamage(context, { shield: 3, hp: 100 }), {
    request, targetId: "red-1", shieldDamage: 3, hpDamage: 7, remaining: { shield: 0, hp: 93 }, lethal: false,
  });
  assert.deepEqual(resolveDamage(context, { shield: 12, hp: 100 })?.remaining, { shield: 2, hp: 100 });
});

test("resolution uses the context amount and recipient, caps overkill, and leaves the original request intact", () => {
  const context = { ...beginDamage(request), targetId: "red-2", amount: 20 };
  const pools = { shield: 2, hp: 4 };
  const lethal = resolveDamage(context, pools)!;
  assert.equal(lethal.request, request);
  assert.equal(lethal.request.targetId, "red-1");
  assert.equal(lethal.targetId, "red-2");
  assert.equal(lethal.shieldDamage + lethal.hpDamage, 6);
  assert.deepEqual(lethal.remaining, { shield: 0, hp: 0 });
  assert.equal(lethal.lethal, true);
  assert.deepEqual(pools, { shield: 2, hp: 4 });
  assert.equal(resolveDamage(context, lethal.remaining), undefined);
  assert.equal(resolveDamage({ ...context, amount: 0 }, pools), undefined);
});
