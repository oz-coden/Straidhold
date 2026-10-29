# Roadmap

> **Status:** Proposed milestones; no implementation is claimed.

## Phase 0 — Rules and executable model

- Record game invariants and resolve ambiguous edge cases, especially round ties, early headquarters wins, upgrade accounting, refunds, and resets.
- Build a small map with control points, headquarters, and a five-minute timer.
- Implement command-driven teams and a headless round-state machine.
- Add unit and property-based tests for the economy, score, and round transitions.

## Phase 1 — Playable single-client prototype

- Implement moving, attacking, respawning, farming, and capture device placement/defense.
- Add a small character roster with shared core actions and distinct skills.
- Add preparation, purchases, refundable upgrades, a small character-switch fee, and simple-interest calculation.
- Create readable HUD, default/recommended builds, and minimal input/UI documentation.
- Validate a complete first-to-three match with AI participants.

## Phase 2 — AI and automated balancing

- Add multiple strategic AI profiles and AI teammates, constrained to real game mechanics.
- Support reproducible seeds, event logs, and match summaries.
- Run many headless simulated matches; track win rates, income, snowballing, duration, and strategy viability.
- Tune costs, interest, respawns, and objective balance; review human playability alongside bot metrics.

## Phase 3 — Networking foundation

- Extract reusable, transport-neutral networking/synchronization pieces into Simpludify when appropriate.
- Implement an authoritative local server and remote input/snapshot flow.
- Add human co-op, reconnection policy, latency evaluation, and security checks.
- Keep PvE/PvP differences in lobby and participant control, not duplicated rule engines.

## Phase 4 — Public playable build

- Publish a testable web build (GitHub Pages can host browser client assets but not an authoritative server).
- Document deployment and runtime requirements.
- Use feedback and measured results to decide the next features.

## Documentation maintenance

Treat this repository as the durable source of truth for decided rules and current proposals. When decisions change, revise the relevant sections, mark unresolved issues explicitly, and avoid presenting proposals as completed software.
