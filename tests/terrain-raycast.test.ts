import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor, Collider, CollisionResponse, CollisionWorld, Scene, Transform } from "@simpludify/core";
import { castTerrain, hasClearance, placeArena, RADIUS } from "../src/rules/arena.ts";

test("terrain rays match the original closed wall intersection at edges and corners", (t) => {
  const scene = new Scene("terrain");
  t.after(() => scene.dispose());
  const collisions = new CollisionWorld(scene);
  placeArena(scene, "terrain.svg");

  const point = (x: number, y: number) => ({ x, y });
  const cases = [
    { name: "nearest wall", from: point(320, 272), to: point(720, 272), hit: point(352, 272) },
    { name: "endpoint on wall", from: point(320, 272), to: point(352, 272), hit: point(352, 272) },
    { name: "endpoint before wall", from: point(320, 272), to: point(352 - 1e-7, 272) },
    { name: "tangent corner", from: point(320, 288), to: point(384, 224), hit: point(352, 256) },
    { name: "just outside corner", from: point(320, 288 - 1e-7), to: point(384, 224 - 1e-7) },
    { name: "along wall edge", from: point(320, 256), to: point(435, 256), hit: point(352, 256) },
    { name: "along internal tile seam", from: point(384, 230), to: point(384, 310), hit: point(384, 256) },
    { name: "origin inside wall", from: point(362, 272), to: point(320, 272), hit: point(362, 272) },
    { name: "origin on edge moving away", from: point(352, 272), to: point(320, 272), hit: point(352, 272) },
    { name: "zero length inside wall", from: point(362, 272), to: point(362, 272), hit: point(362, 272) },
    { name: "zero length on corner", from: point(352, 256), to: point(352, 256), hit: point(352, 256) },
    { name: "zero length on floor", from: point(320, 272), to: point(320, 272) },
  ];

  for (const { name, from, to, hit } of cases) {
    const ray = castTerrain(collisions, from, to);
    assert.equal(Boolean(ray), Boolean(hit), name);
    if (!ray || !hit) continue;
    assert.equal(ray.kind, "tile", name);
    assert.ok(Math.hypot(ray.point.x - hit.x, ray.point.y - hit.y) < 1e-10, name);
    assert.ok(Math.abs(ray.distance - Math.hypot(from.x - hit.x, from.y - hit.y)) < 1e-10, name);
  }
});

test("terrain rays ignore actor colliders and leave movement clearance to pathing", (t) => {
  const scene = new Scene("terrain");
  t.after(() => scene.dispose());
  const collisions = new CollisionWorld(scene);
  placeArena(scene, "terrain.svg");
  const actor = scene.add(new Actor());
  actor.add(new Transform({ x: 335, y: 250 }));
  actor.add(new Collider({ width: 10, height: 8, response: CollisionResponse.Solid }));

  const from = { x: 320, y: 250 };
  const to = { x: 430, y: 250 };
  assert.equal(collisions.raycast({ from, to })?.kind, "collider");
  assert.equal(castTerrain(collisions, from, to), undefined);
  assert.equal(hasClearance(from, to, RADIUS), false);
  assert.equal(hasClearance({ x: 320, y: 236 }, { x: 430, y: 236 }, RADIUS), true);
});
