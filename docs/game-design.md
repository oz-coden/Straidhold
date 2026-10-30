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
| End-of-timer victory | Higher team score at timeout (objective holding is the primary score source) |
| Early round win | Successfully detonate a headquarters demolition device (knockout) |
| Respawn | Roughly 2 seconds at round start, increasing to 10 seconds in final minute (curve TBD) |
| Round reset | Capture ownership, placed devices, temporary buildings, and battlefield entities |
| Round persistence | Full unspent currency, selected persistent upgrades, and match-level progress |

With full-length rounds, matches take approximately 17 minutes (3–0) to 29 minutes (3–2), excluding initial setup and loading. Headquarters destruction may shorten rounds.

**Unresolved:** Define a deterministic tiebreaker/overtime policy for equal scores at timeout. A headquarters being destroyed awards the round, not the whole match.

## Capture and battlefield

Every character can move, attack, farm, use items, deploy a capture device, and contest objectives. To take an objective, install a device and defend it for a required activation period. Opponents can disrupt or remove the device under rules still to be defined. AI uses the same process.

Controlling points may generate resources, create favorable positioning, or improve access to neutral enemies. Headquarters are separate targets, enabling a direct attack as an alternate victory route. A five-point map and a ~30-second activation timer are initial examples, not fixed requirements.

## Frontline pressure and headquarters protection

**Design direction:** Going directly to the enemy headquarters before taking territory should be possible, but generally risky and inefficient. Do not make capture points hard gates or disallow flanking routes: concentrated investment in an assault character and a coordinated headquarters rush must remain viable as high-risk strategies.

Use a **supply-line / territorial support** model. The map may define adjacency between controlled points and staging areas. Connected friendly territory allows safer resupply, repairs, temporary deployment, and more favorable access to the enemy base. When a team bypasses unclaimed or enemy-held territory, disadvantages increase with the depth of unsupported penetration.

Established mechanical direction (specified more precisely below):
- Friendly connected corridors speed movement; enemy corridors slow movement according to frontline invasion depth.
- Only connected friendly objectives are eligible forward respawn points, and connection influences recall casting time.
- Jungle paths remain neutral to supply-corridor movement modifiers.
- Additional headquarters defense or resupply benefits are optional proposals, not established requirements.

**Fairness constraints:** Apply the same topology and rules to both factions, whether controlled by AI or humans. Clearly visualize frontlines, connected points, and the reason for any penalty. Avoid an automatic win condition triggered only by capturing a particular path; a difficult direct headquarters assault should still be technically possible.

**Open tuning:** Supply effects' magnitudes and timing, route/map tuning, and headquarters defensive strength. The graph-connected ownership and frontline-based depth rules are described below. Test direct rush vs. staged capture vs. diversionary assault with headless simulations and human playtests.

## Economy

Currency is owned individually and carried across rounds **without a carryover cap** under the current proposal. Players earn currency during rounds from holding objectives, eliminations, and farming; score-based awards are paid after rounds. Players can transfer funds during preparation to support a selected carry. A single team-wide injection occurs at 0–2 round losses, not after every lost round.

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

Each character belongs to one of five classes and has three unique abilities available from the outset; upgrades improve them rather than unlock baseline access. Class abilities are separate and cannot be upgraded. Possible roles include frontline defense, assault, healing/support, scouting/flanking, and engineering/utility. These are **strengths, not exclusive permissions**: all characters retain the same core actions.

Character switching happens in preparation, with a modest fee and automatic refund of old character-specific upgrades. Other purchases, presets, and upgrade allocations can also be edited during preparation. The player's unchanged prior setup remains a valid default. Recommended builds should include balanced, offensive, defensive, and economy-saving options.

## AI and PvP

The AI must use the same resource, capture, skill, and combat systems as humans. Its strategy can include assaults, defense, farming, and diversion, constrained by its budget. The rules must not assume one side is always AI: human-vs-AI, human-vs-human, and mixed rosters should remain possible.

## Outstanding decisions

- Exact map topology, number and placement of points, capture-device arming/counterplay, headquarters defenses, and supply-line connectivity/pressure tuning.
- Tie/overtime rules and whether contested devices affect end-of-round ownership.
- Specific income amounts, equipment prices, respawn curve, and interest rate/cap.
- Character roster, upgrades, cooldowns, and exact roster and class-specific abilities (the default prohibits duplicate characters on the same team; custom rooms can allow them).
- Persistence and dropping rules for ordinary purchased equipment (demolition devices explicitly drop); details of currency transfer UI.
- The point at which upgrade holding time starts and the handling of partial upgrades or transaction cancellation.
- Matchmaking, session settings, AI difficulty, spectators, and disconnection rules.


## Scoring, knockout, and end-of-round economy

**Current design direction:** The primary round win condition is the **higher team score when five minutes expire**, not possession of a majority of objectives. Holding owned objectives continually earns substantial **team score** and distributes recurring **personal currency to each teammate**. Completing a capture awards only a comparatively small one-off score bonus. Eliminating opposing players and neutral enemies also earns score and personal currency, but objective retention should remain the principal scoring strategy. Scoring amounts, credit attribution, and rates are balance parameters.

A team wins the round **immediately by knockout** if its headquarters demolition device detonates at the enemy headquarters, irrespective of the team scores. At round end, each player's currency award is based on their team's accumulated score, plus a separate knockout bonus for the knockout team where applicable. Thus a high-scoring team knocked out by an opponent retains a proportionate economic reward for its objective play; the knockout side earns its own score-derived income plus knockout bonus. Round wins are separate from score-based payouts.

Currency belongs to **individual players**. During combat, individuals spend their own funds, including on replenishing shared capture-device stocks; no teammate is charged automatically. During preparation, teammates may transfer currency and redistribute purchases and upgrade investments. A farming-oriented player can fund shared capture devices while an assault-oriented teammate invests in their own combat gear. Winning and losing should not automatically produce equal income: advantage earned by superior play is intentional. A **single comeback cash injection** is granted when a team falls behind **0–2 in rounds**, before its potential final round; no routine first-loss compensation or third-loss payout. Exact injection size is TBD.

### Endgame neutral boss

A strong neutral boss appears with **two minutes remaining** (initial intended timing). Its health is **shared**, not scaled to the number of attacking players: assuming equal uninterrupted DPS, five attackers defeat it in approximately **30 seconds**, ten attackers in approximately **15 seconds**. Opposition, interruption, and fighting each other may extend the encounter. The team that deals the **final damaging blow** receives the boss buff, lasting **until the round ends**, and boss combat also provides relevant score/currency rewards. The buff's effects and amounts are to be designed; the last-hit contest, including steals, is intentional.

## Battlefield topology, jungle, and vision

The map distinguishes designated **lanes / supply corridors** from a **jungle** of obstacles, alternate approaches, and concealment areas. Jungle terrain grants **no supply-line speed acceleration or slowdown** merely by entering it. Base vision uses obstacle line-of-sight occlusion, with special **brush/concealment areas** that hide occupants unless revealed under the game's detection rules. The same team-visibility model supports the alive view and the zoomed-out death view; enemy movements hidden by fog must not be leaked as live coordinates.

Supply connection is a **graph property**: a path from the team's headquarters through consecutively **friendly-owned** connected objectives. A supply corridor is powered for a team only when the designated link's endpoints and required intervening objectives are friendly and headquarters-connected. A neutral/enemy intermediate objective makes the route unpowered, even if distant endpoints are friendly. A corridor is friendly-powered, enemy-powered, or unpowered, not instantaneously converted from enemy to friendly merely because someone walks through it. Isolated friendly points retain ownership but lose supplied privileges.

Inside a **friendly powered corridor**, speed ramps upward toward a cap. Leaving it ends acceleration immediately. Being damaged inside stops acceleration and imposes a cooldown before ramp-up can resume. In an **enemy powered corridor**, movement is slowed. The preferred model bases slowdown on **invasion depth**, measured along enemy-supplied routes from the enemy's frontmost connected point toward their headquarters, rather than time spent inside a corridor. Therefore a player emerging from jungle directly beside the enemy headquarters immediately suffers the appropriate deep-territory slowdown. Leaving an enemy corridor gradually clears the lingering slow. Exact graph distance/path treatment on branching maps and the slowdown curve remain tuning/design questions; maps are intended to avoid gratuitous complexity.

### Respawning and objective disruption

A player may respawn at their own headquarters or a **headquarters-connected friendly-owned objective** when it is eligible. An objective's smaller **core zone** blocks respawn while any enemy is inside; its larger **alert/perimeter zone** warns of enemies but does not itself block respawn. An opposing **capture device**, once deployed at a point, disables the point's respawn function even without an enemy standing there; it does **not** immediately transfer ownership or break supply-route ownership connectivity. Capture completes only after its defended activation process.

Respawn destination modes: **automatic**, **explicit/manual**, or **first and second preferences**. Recheck eligibility at actual respawn. If a manual selection becomes invalid, notify and request reselection without charging a fresh respawn delay; automatic mode may choose another eligible destination. The intended respawn timer rises from ~2 seconds early to ~10 seconds in the final minute; exact progression is TBD. Dead players see a zoomed-out fog-of-war map based on friendly intelligence.

### Recall teleport

Every character can channel a **return teleport to their own headquarters** with a cooldown. Channel duration increases with distance (ideally obstacle-aware route distance) from the **nearest headquarters-connected friendly-owned point**, including headquarters itself; severing supply can consequently increase return time. Taking damage, including through a protective barrier, **interrupts the channel**. Brush can conceal a character while they channel. Precise cast/cooldown values and cancellation penalty remain undecided.

## Devices, delivery, and live purchasing

**Capture devices** are a **shared team inventory**, with a set number replenished to their initial allotment **each round**. Any teammate can deploy one using shared inventory; additional devices are funded by an individual's own currency. This permits spending on territory but makes repeated wasteful rush/capture attempts expensive. A capture device interferes with an objective's function while active (including respawn) and requires a defended activation period to transfer ownership. Capture-device allotment, deployment time, and counterplay timing remain TBD.

A **headquarters demolition device** is a **unique physical carrier item**, initially **one per team each round**, held by an individual player. A team may have at most one active device at a time, including carried, dropped, or planted copies. Its carrier is revealed as carrying the device when observed by an opponent, and that intelligence is shared with the opposing team; loss of vision does not give perpetual live tracking. A dead carrier **drops** it: allies may pick it up and carry on, while an enemy **recovering a dropped opposing device means neutralizing/removing it**, not storing or wielding it. Once neutralized/destroyed, its team may buy a replacement; a recoverable dropped device does not authorize a duplicate purchase. A new round resets this system to the free initial single-device allotment.

The demolition device requires **5 seconds to plant** at the enemy headquarters and **25 further seconds to detonate** if not defused: 30 seconds total from uninterrupted planting. Defenders can prevent planting or defuse. Treat a planted device's interaction with round timeout (potential overtime) as **not yet finalized**. This knockout route must be difficult enough that rushing the enemy headquarters without map control is risky, not a default winning strategy.

**Purchasing:** Players can arrange purchases in a **queue while alive**, make purchases directly at their own headquarters, and browse/buy during the death interval. Personal items ordered while dead are delivered **on respawn**, including at eligible forward spawn points. While alive, entering/returning to their own headquarters processes their queue and supplies purchases. Demolition devices follow the same acquisition/delivery rule; do not add a special headquarters-only pickup restriction. Queue purchases are paid from the requesting player's funds with limits and availability validated at execution. Shared capture-device purchases are credited to team stock; exact timing for combat-time restocking is subject to implementation details.

## Character classes and abilities (provisional)

Five proposed classes: **Assassin, Tank, Recon, Control, Support**. Farming is a **playstyle/assignment**, not a class; every character can fight, farm, capture, use items, and interact. Teams may combine classes freely; by default **the same character cannot be selected twice within a team**, with an optional custom-room rule allowing duplicates. Opposing teams may mirror characters.

Each class supplies **one strong passive and one active** available without upgrades. Each character supplies **three additional unique abilities**, passive and/or active, individually upgradeable using its owner's invested currency. Therefore there are **five total abilities and at most four active abilities** per character. Class abilities are **not upgradeable**. Combat action input bindings (basic attack, items, recall, interact, abilities) are to be finalized; no fixed keyboard/gamepad button assignments are mandated. Holding the basic-attack input repeatedly attacks when able, and ability activations should generally coexist with basic-attack input instead of requiring repeated basic-attack taps.

| Class | Common passive (tentative where unspecified) | Common active |
| --- | --- | --- |
| Assassin | +10% base movement speed; halve time to reach friendly supply acceleration; halve enemy supply slow percentage; halve recovery time from lingering enemy-supply slow after leaving | Temporary outgoing damage boost (amount/duration TBD) |
| Tank | All incoming damage reduced by 20%, including damage taken through interception | Select one ally and intercept **50% of primary incoming damage** for a limited duration |
| Recon | Increased base vision radius (magnitude TBD) | One-time snapshot scan centered on the character, sharing detected enemies' locations with the entire team; no continuing tracking |
| Control | Team-wide improvement to applied debuffs, non-stacking across multiple Control characters | Deploy an area applying debuffs; potentially combine with smoke/visibility interference (details TBD) |
| Support | Team-wide improvement to applied buffs, non-stacking across multiple Support characters | Apply a **100-capacity special barrier** to one selected ally for a limited duration; when a hit breaks it, excess hit damage is discarded |

Tank interception is **non-recursive**: only damage from an original hit can be intercepted, not transferred damage. Up to two tanks may protect a given ally simultaneously, each intercepting 50% of primary damage, for a combined 100%. A third cannot enter that target's two active interception slots until one expires. Tank damage reduction applies to transferred damage. Barrier protection is evaluated **before** interception; interception duration still ticks while a special barrier blocks hits. Team-wide Control and Support class passives do not stack with copies of themselves. Whether buff/debuff bonuses affect other permanent class passives is not finalized; favor applying them to actively granted effects rather than modifying permanent base-class traits. Class definitions may evolve after drafting several unique characters per class.

## Shields, flesh HP, and damage order

Every character has a **normal regenerating shield** and **flesh HP**. Their base proportions should be consistent across characters rather than class-specific. Damage normally passes through layers in this order: **Support special barrier → Tank interception (if applicable) → normal shield → flesh HP**. Damage that spills over a depleted **normal shield** continues to flesh HP. Flesh HP has **no passive regeneration**; it heals while at own headquarters, from purchased healing items, or through character abilities. Exact maximum values and headquarters healing rate are TBD.

After **3 seconds without taking a hit**, the normal shield regenerates at a fixed rate of **20% of its maximum per second** (zero to full in 5 regeneration seconds, or ~8 seconds including waiting). **A hit absorbed entirely by a special barrier still resets this regeneration timer**. Moving and attacking do not by themselves prevent recovery. The Support barrier is a **separate outer layer** of up to 100 durability, single-target, with an expiration time. If one hit exceeds its remaining durability, the barrier is destroyed and **all overflow from that hit is ignored**; only the next hit reaches the inner layers. A shield-refill specialist and a flesh-HP healer are potential distinct character designs, not yet fixed characters.
