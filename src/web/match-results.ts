import { TEAMS } from "../rules/arena.ts";
import { contributionUnits, POINTS, POINT_UNITS } from "../rules/contribution.ts";
import { MatchSeries, PLAYER_ID } from "./game-flow.ts";
import { participantLabel } from "./combat-feedback.ts";

const points = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 3 });
const format = (units: number) => points.format(units / POINT_UNITS);

export function resultsPanel(host: HTMLElement, select: HTMLSelectElement, signal: AbortSignal) {
  let match: MatchSeries | undefined;

  function render() {
    if (!match) return;
    const round = match.rounds[Number(select.value) - 1];
    const rows = round?.participants ?? match.participantTotals;
    const frag = document.createDocumentFragment();
    for (const team of TEAMS) {
      const section = document.createElement("section");
      section.dataset.team = team;
      const table = document.createElement("table");
      const caption = table.createCaption();
      caption.textContent = team.toUpperCase();
      const header = table.createTHead().insertRow();
      for (const label of ["参加者", "K", "A", "D", "占領", "貢献pt"]) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = label;
        header.append(cell);
      }
      const body = table.createTBody();
      for (const stats of rows.filter((row) => row.team === team)) {
        const row = body.insertRow();
        row.dataset.participant = stats.id;
        const name = document.createElement("th");
        name.scope = "row";
        name.textContent = participantLabel(stats.id);
        if (stats.id === PLAYER_ID) {
          row.dataset.player = "true";
          name.append("（自分）");
        }
        row.append(name);
        for (const value of [stats.kills, stats.assists, stats.deaths, stats.captures]) {
          row.insertCell().textContent = String(value);
        }
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = format(contributionUnits(stats));
        summary.setAttribute("aria-label", `${name.textContent}の貢献ポイント ${summary.textContent}、内訳`);
        details.append(summary);
        const breakdown = document.createElement("dl");
        for (const [label, value] of [
          ["キル", points.format(stats.kills * POINTS.kill)],
          ["アシスト", points.format(stats.assists * POINTS.assist)],
          ["占領設置", format(stats.installationUnits)],
          ["占領維持", format(stats.guardingUnits)],
        ]) {
          const item = document.createElement("dt");
          const amount = document.createElement("dd");
          item.textContent = label;
          amount.textContent = value;
          breakdown.append(item, amount);
        }
        const cell = row.insertCell();
        // Place the wider breakdown in a separate row to preserve the table grid on phones.
        cell.append(details);
        const detailRow = body.insertRow();
        detailRow.hidden = true;
        detailRow.insertCell().colSpan = header.cells.length;
        detailRow.cells[0].append(breakdown);
        details.addEventListener("toggle", () => { detailRow.hidden = !details.open; });
      }
      section.append(table);
      frag.append(section);
    }
    host.replaceChildren(frag);
  }

  select.addEventListener("change", render, { signal });
  return {
    show(next: MatchSeries) {
      match = next;
      select.replaceChildren(new Option("試合累計", "0"), ...next.rounds.map((_, i) => new Option(`第${i + 1}ラウンド`, String(i + 1))));
      select.value = "0";
      render();
    },
    clear() {
      match = undefined;
      host.replaceChildren();
      select.replaceChildren();
    },
  };
}
