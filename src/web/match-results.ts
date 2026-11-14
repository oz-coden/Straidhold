import { awardBonusUnits, awardUnits, type Award } from "../rules/awards.ts";
import { TEAMS } from "../rules/arena.ts";
import { contributionUnits, POINTS, POINT_UNITS } from "../rules/contribution.ts";
import { MatchSeries, PLAYER_ID } from "./game-flow.ts";
import { participantLabel } from "./combat-feedback.ts";

const points = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
const measure = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });
export const displayPoints = (units: number) => `${points.format(units / POINT_UNITS)} pt`;
const awardLabel = (award: Award) => award.id === "mvp" || award.id === "team-mvp" || award.id === "streak"
  ? award.title : `${award.title} · ${award.rank}位`;

function renderAwards(host: HTMLElement, awards: readonly Award[] | undefined) {
  host.replaceChildren();
  host.hidden = !awards?.length;
  if (!awards?.length) return;

  const heading = document.createElement("h2");
  heading.textContent = "試合表彰";
  const list = document.createElement("ul");
  for (const award of awards) {
    const item = document.createElement("li");
    item.dataset.award = award.id;
    if (award.team) item.dataset.team = award.team;
    const title = document.createElement("strong");
    title.textContent = awardLabel(award);
    const names = document.createElement("span");
    names.textContent = award.participants.map(participantLabel).join("、");
    if (award.participants.length > 1) names.textContent += "（同率）";
    item.append(title, names);
    const reward = awardUnits(award);
    if (reward) {
      const bonus = document.createElement("small");
      bonus.textContent = `+${displayPoints(reward)} / 人`;
      item.append(bonus);
    }
    list.append(item);
  }
  host.append(heading, list);
}

export function resultsPanel(host: HTMLElement, awardsHost: HTMLElement, select: HTMLSelectElement, signal: AbortSignal) {
  let match: MatchSeries | undefined;

  function render() {
    if (!match) return;
    const round = match.rounds[Number(select.value) - 1];
    const awards = round ? undefined : match.awards;
    const rows = round?.participants ?? match.participantTotals;
    const frag = document.createDocumentFragment();
    for (const team of TEAMS) {
      const section = document.createElement("section");
      section.dataset.team = team;
      const table = document.createElement("table");
      const caption = table.createCaption();
      caption.textContent = team.toUpperCase();
      const header = table.createTHead().insertRow();
      for (const label of ["参加者", "K", "A", "D", "占領", awards ? "最終貢献pt" : "基礎貢献pt"]) {
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
        const base = contributionUnits(stats);
        const personalAwards = awards?.filter((award) => award.participants.includes(stats.id) && awardUnits(award) > 0) ?? [];
        const bonus = awardBonusUnits(personalAwards);
        summary.textContent = displayPoints(base + bonus);
        summary.setAttribute("aria-label", `${name.textContent}の貢献ポイント ${summary.textContent}、内訳`);
        details.append(summary);
        const breakdown = document.createElement("dl");
        const rows: [string, string][] = [
          ["キル", displayPoints(stats.kills * POINTS.kill * POINT_UNITS)],
          ["アシスト", displayPoints(stats.assists * POINTS.assist * POINT_UNITS)],
          ["占領設置", displayPoints(stats.installationUnits)],
          ["占領維持", displayPoints(stats.guardingUnits)],
          ["基礎貢献", displayPoints(base)],
          ["最大キルストリーク", String(stats.maxStreak)],
          ["移動距離", measure.format(stats.distanceMoved)],
          ["被ダメージ（HP / シールド）", `${measure.format(stats.hpDamage + stats.shieldDamage)}（${measure.format(stats.hpDamage)} / ${measure.format(stats.shieldDamage)}）`],
          ["自己回復（HP / シールド）", `${measure.format(stats.hpRecovered + stats.shieldRecovered)}（${measure.format(stats.hpRecovered)} / ${measure.format(stats.shieldRecovered)}）`],
        ];
        if (awards) {
          rows.push(["表彰ボーナス", displayPoints(bonus)]);
          for (const award of personalAwards) rows.push([awardLabel(award), `+${displayPoints(awardUnits(award))}`]);
          rows.push(["最終貢献", displayPoints(base + bonus)]);
        }
        for (const [label, value] of rows) {
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
      renderAwards(awardsHost, next.awards);
      select.replaceChildren(new Option("試合累計", "0"), ...next.rounds.map((_, i) => new Option(`第${i + 1}ラウンド`, String(i + 1))));
      select.value = "0";
      render();
    },
    clear() {
      match = undefined;
      renderAwards(awardsHost, undefined);
      host.replaceChildren();
      select.replaceChildren();
    },
  };
}
