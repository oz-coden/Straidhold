export type InputMode = "keyboard" | "touch" | "gamepad";
type StickMode = "fixed" | "floating" | "follow";

export interface Settings {
  mode: InputMode | "auto";
  stick: StickMode;
  aimStick: StickMode;
  size: number;
  opacity: number;
  deadZone: number;
}

const KEY = "straidhold.controls";
const defaults: Settings = { mode: "auto", stick: "floating", aimStick: "floating", size: 44, opacity: 76, deadZone: 15 };
const modes = ["auto", "keyboard", "touch", "gamepad"] as const;
const sticks = ["fixed", "floating", "follow"] as const;

function option<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.find((choice) => choice === value) ?? fallback;
}

function slider(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;
}

function read(): Settings {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!data || data.version !== 1) return { ...defaults };
    return {
      mode: option(data.mode, modes, defaults.mode),
      stick: option(data.stick, sticks, defaults.stick),
      aimStick: option(data.aimStick, sticks, defaults.aimStick),
      size: slider(data.size, 24, 68, defaults.size),
      opacity: slider(data.opacity, 25, 100, defaults.opacity),
      deadZone: slider(data.deadZone, 0, 45, defaults.deadZone),
    };
  } catch {
    return { ...defaults };
  }
}

export function settingsPanel(dialog: HTMLDialogElement, change: (settings: Settings) => void, signal: AbortSignal): Settings {
  const settings = read();
  const form = dialog.querySelector("form")!;
  const selectMode = form.elements.namedItem("mode") as HTMLSelectElement;
  const selectStick = form.elements.namedItem("stick") as HTMLSelectElement;
  const selectAimStick = form.elements.namedItem("aimStick") as HTMLSelectElement;
  const size = form.elements.namedItem("size") as HTMLInputElement;
  const opacity = form.elements.namedItem("opacity") as HTMLInputElement;
  const deadZone = form.elements.namedItem("deadZone") as HTMLInputElement;
  const label = (id: string, value: string) => { dialog.querySelector<HTMLOutputElement>(id)!.value = value; };
  function updateLabels() {
    label("#size-label", `${settings.size} px`);
    label("#opacity-label", `${settings.opacity}%`);
    label("#dead-zone-label", `${settings.deadZone}%`);
  }
  selectMode.value = settings.mode;
  selectStick.value = settings.stick;
  selectAimStick.value = settings.aimStick;
  size.valueAsNumber = settings.size;
  opacity.valueAsNumber = settings.opacity;
  deadZone.valueAsNumber = settings.deadZone;
  updateLabels();
  form.addEventListener("input", () => {
    settings.mode = option(selectMode.value, modes, defaults.mode);
    settings.stick = option(selectStick.value, sticks, defaults.stick);
    settings.aimStick = option(selectAimStick.value, sticks, defaults.aimStick);
    settings.size = size.valueAsNumber;
    settings.opacity = opacity.valueAsNumber;
    settings.deadZone = deadZone.valueAsNumber;
    updateLabels();
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, ...settings }));
    } catch {
      // The in-memory settings remain usable when storage is unavailable.
    }
    change(settings);
  }, { signal });
  return settings;
}
