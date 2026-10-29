# Straidhold

Straidhold is a planned 5v5 top-down tactical action game built with [Simpludify](https://github.com/oz-coden/Simpludify). It combines cooperative PvE, future PvP, territory control, round-based competition, character abilities, and an economy that rewards both tactical planning and casual play.

**Status:** Concept / pre-prototype. Gameplay numbers and systems below are proposals, not implemented features.

## Game concept

Players compete against an opposing team to capture objectives and attack the opposing headquarters. Neutral enemies and objectives provide farming opportunities. The default experience targets friendly, low-pressure cooperative play, while leaving room for team composition, resource allocation, economic rounds, and coordinated tactics.

- **Teams:** 5 vs 5; human players, AI-controlled participants, or mixtures of both are intended.
- **Match:** First team to win three rounds wins the match.
- **Round:** A proposed five-minute combat phase, with a one-minute preparation phase between rounds.
- **Round victory:** Hold a majority of capture points at the end of the timer, or destroy the opposing headquarters during the round.
- **Capture:** Deploy a capture device at an objective and defend it until activation completes.
- **Respawns:** Short early in each round (around two seconds), increasing to around ten seconds during the final minute.
- **Progression:** Currency carries over completely; map ownership and deployed structures reset between rounds.
- **Characters:** Different abilities and strengths, but shared basic actions. Character selection and builds can change during preparation.

The game should remain playable without detailed planning: clear HUD information, recommended builds, presets, and sensible defaults support casual play. More involved tactics should reward players who want them, without being mandatory.

## Documentation

- [Game design](docs/game-design.md) — detailed rules, economy, characters, and open decisions.
- [Networking and simulation](docs/networking.md) — PvE/PvP architecture and reusable Simpludify capabilities.
- [Roadmap](docs/roadmap.md) — phased implementation, automated testing, and validation.

This repository records design proposals and subsequent decisions. Values and unimplemented features should not be presented as finalized or available.
