# Game Design

> **Status:** Working design notes. This document distinguishes agreed direction from illustrative values and unresolved questions.

## Vision and principles

Straidhold is a top-down 5v5 tactical action game inspired by MOBA farming and progression and tactical shooters' round economy and character abilities. Its primary target is cooperative PvE, with PvP and mixed human/AI teams supported by the same underlying rules.

- **Approachable without optimization:** Players can pick a favorite character, accept a recommended build, farm, fight, and capture objectives without complex planning.
- **Depth without compulsion:** Team strategies include saving currency, concentrating spending on a carry, spreading spending across five players, attacking headquarters, and controlling multiple objectives.
- **Recovery after mistakes:** An individual death or lost round is not an instant match loss; respawn time grows as a round approaches its conclusion.
- **Symmetric core rules:** AI and humans use the same action and economy constraints. Difficulty may change decision quality, not silently grant unlimited resources.
- **Transparent information:** Show score, remaining time, point ownership, capture progress, funds, status effects, and ability cooldowns. Details can live in an expandable view.

## Match and round structure

| Parameter | Current direction |
| --- | --- |
| Team size | 5 vs 5 (up to 10 participants; AI can fill slots) |
| Match result | First to 3 round victories |
| Combat phase | 5 minutes (proposed initial tuning value) |
| Preparation phase | 1 minute between rounds; initial preparation timing TBD |
| End-of-timer victory | Control a strict majority of capturable points |
| Early round win | Destroy opposing headquarters |
| Respawn | Roughly 2 seconds at round start, increasing to 10 seconds in final minute (curve TBD) |
| Round reset | Capture ownership, placed devices, temporary buildings, and battlefield entities |
| Round persistence | Full unspent currency, selected persistent upgrades, and match-level progress |

With full-length rounds, matches take approximately 17 minutes (3–0) to 29 minutes (3–2), excluding initial setup and loading. Headquarters destruction may shorten rounds.

**Unresolved:** If both sides fail to control a majority at timeout (possible with neutral objectives), define overtime or another deterministic tiebreaker. A headquarters being destroyed awards the round, not the whole match.

## Capture and battlefield

Every character can move, attack, farm, use items, deploy a capture device, and contest objectives. To take an objective, install a device and defend it for a required activation period. Opponents can disrupt or remove the device under rules still to be defined. AI uses the same process.

Controlling points may generate resources, create favorable positioning, or improve access to neutral enemies. Headquarters are separate targets, enabling a direct attack as an alternate victory route. A five-point map and a ~30-second activation timer are initial examples, not fixed requirements.

## Economy

Currency is held across rounds **without a carryover cap** under the current proposal. Each round grants base income; outcome-based income, losing-streak support, neutral-enemy rewards, and objective income are candidate sources. Players should be able to transfer resources or contribute to a team pool so one carry can receive concentrated investment.

There are two distinct uses of currency:

1. **Recoverable skill-upgrade allocation.** Characters have around three usable baseline abilities (passive and/or active). Upgrading a skill allocates funds that can later be fully recovered. Each upgrade is managed separately. Skill upgrades can be downgraded or refunded only during preparation. If a character is switched, their character-specific upgrades are refunded.
2. **Consumptive purchases.** Equipment, consumables, and placeable structures cost currency permanently. Structures count as consumables: they are deployed in the current round and reset with the battlefield. Purchased equipment is currently intended to be per-round rather than refunded.

### Upgrade investment / simple interest

An upgrade held across completed rounds accrues a **simple-interest** refund bonus against its original invested principal, not compounded returns:

`refund = invested_principal × (1 + rate_per_round × eligible_completed_rounds)`

The bonus becomes spendable **only when that upgrade is refunded**, rather than being paid each round. Refunds are managed separately per upgrade. An illustrative rate is 5% per eligible round, subject to balancing. The treatment of additional upgrade levels purchased later, rounding, and the exact accrual boundary remain to be specified; preserving independent purchase lots is one candidate.

A character change during preparation incurs a **small flat fee**, ideally comparable to the interest from maintaining a typical skill upgrade for one round. It discourages constant switching without blocking strategic adjustments. Character selection changes within the preparation UI should be previewable without repeated fees; apply the fee only on final confirmation.

The economy should support an intentional **eco round**: avoid spending on per-round gear or devices, rely on baseline skills, save funds, and invest more later. Avoid automatic mandatory income-multiplier upgrades. Economic advantage should usually emerge from practical character abilities, farming, map control, or coordinated play.

**Balance questions:** Interest farming, repeated refund/reinvestment exploits, snowballing, resource transfers, and fully refundable upgrades must be tested. Avoid assuming results before simulation and playtesting.

## Characters and builds

Each character has a distinct combat identity and around three unique abilities available from the outset; upgrades improve them rather than unlock baseline access. Possible roles include frontline defense, assault, healing/support, scouting/flanking, and engineering/utility. These are **strengths, not exclusive permissions**: all characters retain the same core actions.

Character switching happens in preparation, with a modest fee and automatic refund of old character-specific upgrades. Other purchases, presets, and upgrade allocations can also be edited during preparation. The player's unchanged prior setup remains a valid default. Recommended builds should include balanced, offensive, defensive, and economy-saving options.

## AI and PvP

The AI must use the same resource, capture, skill, and combat systems as humans. Its strategy can include assaults, defense, farming, and diversion, constrained by its budget. The rules must not assume one side is always AI: human-vs-AI, human-vs-human, and mixed rosters should remain possible.

## Outstanding decisions

- Exact map topology, number and placement of points, capture-device arming/counterplay, and headquarters defenses.
- Tie/overtime rules and whether contested devices affect end-of-round ownership.
- Specific income amounts, equipment prices, respawn curve, and interest rate/cap.
- Character roster, upgrades, cooldowns, and whether identical characters can be selected by multiple players.
- Item persistence on death, dropped equipment, team-pool and transfer permissions.
- The point at which upgrade holding time starts and the handling of partial upgrades or transaction cancellation.
- Matchmaking, session settings, AI difficulty, spectators, and disconnection rules.
