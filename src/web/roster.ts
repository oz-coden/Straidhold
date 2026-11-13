import { TEAMS } from "../rules/arena.ts";
import { HZ, type Battle, type Fighter } from "../rules/battle.ts";

export function createRoster(host: HTMLElement, battle: Battle, player: Fighter) {
  const groups = TEAMS.map((team) => {
    const name = team === "blue" ? "青チーム" : "赤チーム";
    const group = document.createElement("div");
    group.className = "roster-team";
    group.dataset.team = team;
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", name);
    const count = document.createElement("span");
    count.className = "roster-count";
    group.append(count);
    const portraits = battle.fighters.filter((fighter) => fighter.team === team).map((fighter) => {
      const icon = document.createElement("span");
      icon.className = "roster-unit";
      icon.setAttribute("role", "img");
      if (fighter === player) icon.classList.add("roster-player");
      group.append(icon);
      return { fighter, icon, previous: -1 };
    });
    return { group, count, portraits, name };
  });

  return {
    mount() { host.replaceChildren(...groups.map(({ group }) => group)); },
    paint() {
      for (const { count, portraits, name } of groups) {
        let alive = 0;
        for (const portrait of portraits) {
          const { fighter, icon } = portrait;
          const seconds = fighter.hp > 0 ? 0 : Math.max(1, Math.ceil((fighter.downUntil - battle.tick) / HZ));
          if (!seconds) alive++;
          if (seconds === portrait.previous) continue;
          portrait.previous = seconds;
          icon.dataset.state = seconds ? "down" : "alive";
          icon.textContent = seconds ? String(seconds) : "";
          icon.setAttribute("aria-label", `${fighter === player ? "自分" : `${name}${fighter.slot + 1}`} ${seconds ? `復活まで${seconds}秒` : "生存"}`);
        }
        const text = `${alive}/${portraits.length}`;
        if (count.textContent !== text) {
          count.textContent = text;
          count.setAttribute("aria-label", `${name} 生存${alive}人 / ${portraits.length}人`);
        }
      }
    },
    dispose() { for (const { group } of groups) group.remove(); },
  };
}
