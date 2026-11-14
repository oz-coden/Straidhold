export type StreakNotice =
  | { readonly kind: "milestone"; readonly count: number }
  | { readonly kind: "shutdown"; readonly count: number };

export function createStreakBanner(host: HTMLElement) {
  let current: StreakNotice | undefined;
  return {
    paint(notice: StreakNotice | undefined, opacity = 0, scale = 1) {
      if (current !== notice) {
        current = notice;
        host.hidden = !notice;
        if (notice) {
          host.dataset.kind = notice.kind;
          host.dataset.count = String(notice.count);
          if (notice.kind === "shutdown") {
            const label = document.createElement("strong");
            label.textContent = "SHUTDOWN";
            host.replaceChildren(label, `${notice.count}連続キルを阻止`);
          } else {
            host.textContent = `${notice.count}連続キル！`;
          }
        } else {
          host.replaceChildren();
          delete host.dataset.kind;
          delete host.dataset.count;
        }
      }
      if (notice) {
        host.style.opacity = String(opacity);
        host.style.setProperty("--streak-scale", String(scale));
      }
    },
  };
}
