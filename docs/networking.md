# Networking and Simulation

> **Status:** Architectural proposal, not an assertion that these APIs already exist in Simpludify.

Straidhold is planned to support co-op PvE and eventual PvP, with up to ten human/AI-controlled participant slots. This makes it a useful proving ground for reusable multiplayer functionality in [Simpludify](https://github.com/oz-coden/Simpludify).

## Separation of responsibilities

**Straidhold owns** rules: rounds, factions, resources, upgrades, objectives, capture devices, combat, victory evaluation, character data, and AI decisions.

**Simpludify could provide** generic facilities: deterministic/fixed-step simulation helpers, serializable input commands and snapshots, transport-agnostic synchronization, connection lifecycle abstractions, and headless execution. Introduce generic features only after identifying a reusable need; keep game-specific policy outside the engine.

**Transport adapters own** actual communication, e.g. WebSocket for browsers. Transport protocols and deployment environments should not leak into game-rule logic.

## Authority model

Prefer server-authoritative simulation for online matches:

1. A human input adapter or AI policy produces a command.
2. The authority validates and applies commands to the simulation.
3. The simulation determines collisions, combat outcomes, funds, upgrades, capture state, and wins.
4. Clients receive state updates and render them, with prediction/interpolation only where justified.

A client must not directly declare damage, purchases, income, or captured points. A local/headless session should call the same rule APIs without any network dependency.

## Candidate milestones

1. Pure headless local simulation and testable AI command adapters.
2. Stable command and snapshot schemas; record/replay and deterministic seeds.
3. Local host + one remote client using a minimal transport.
4. Multiple clients, reconnection, lag handling, and authority checks.
5. Performance measurements, bot-filled matches, and PvP-specific validation.

## Test strategy

Headless simulations should cover rule invariants (currency never unintentionally duplicates, one win is awarded per round, resets clear transient structures, valid upgrades refund correctly), randomized action sequences, and seeded repeatability. Aggregate thousands of AI-vs-AI games once runtime permits, comparing compositions, resource distributions, eco strategies, round length, and side advantage.

AI-vs-AI results are a screening tool, not a substitute for human testing: coordinated humans may find tactics that bots cannot.
