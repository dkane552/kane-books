/**
 * Accessibility and display settings: each person picks how the app looks for them. Saved to their login
 * (user_settings, 24_display_settings.sql) so it follows them to any device, and cached in this browser so
 * the first paint already uses it (bootDisplay runs from an inline script in the page head).
 *
 * Text size changes only the text: every font size in styles.css and the components is multiplied by --ts
 * (set on <html>), while spacing, buttons, icons and the layout stay the same.
 */

export const TEXT_SIZES = [
  { value: 90, label: "Smaller" },
  { value: 100, label: "Default" },
  { value: 115, label: "Large" },
  { value: 130, label: "Larger" },
  { value: 150, label: "Largest" },
] as const;
export type TextSize = (typeof TEXT_SIZES)[number]["value"];

export const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "contrast", label: "High contrast" },
  { value: "system", label: "Match my device" },
] as const;
export type Theme = (typeof THEMES)[number]["value"];

/** Page background tints for the light theme. swatch is what the picker shows. */
export const BACKGROUNDS = [
  { value: "parchment", label: "Parchment", swatch: "oklch(0.963 0.012 83)" },
  { value: "white", label: "White", swatch: "oklch(0.995 0 0)" },
  { value: "gray", label: "Gray", swatch: "oklch(0.95 0.004 250)" },
  { value: "sage", label: "Sage", swatch: "oklch(0.95 0.02 155)" },
  { value: "blue", label: "Blue", swatch: "oklch(0.95 0.018 240)" },
  { value: "rose", label: "Rose", swatch: "oklch(0.955 0.016 20)" },
] as const;
export type Background = (typeof BACKGROUNDS)[number]["value"];

export const FONTS = [
  { value: "standard", label: "Standard", sample: "Archivo" },
  { value: "readable", label: "Easy to read", sample: "Atkinson Hyperlegible" },
  { value: "system", label: "My device's font", sample: "system-ui" },
] as const;
export type Font = (typeof FONTS)[number]["value"];

export type Spacing = "normal" | "relaxed";
export type Motion = "system" | "reduce";

export interface DisplayPrefs {
  textSize: TextSize;
  theme: Theme;
  background: Background;
  font: Font;
  spacing: Spacing;
  motion: Motion;
  underlineLinks: boolean;
  boldText: boolean;
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  textSize: 100,
  theme: "light",
  background: "parchment",
  font: "standard",
  spacing: "normal",
  motion: "system",
  underlineLinks: false,
  boldText: false,
};

export const DISPLAY_STORAGE_KEY = "kane-books-display";

const pick = <T extends string | number>(v: unknown, allowed: readonly { value: T }[], d: T): T =>
  allowed.some((a) => a.value === v) ? (v as T) : d;

/** Anything (a saved row, localStorage, a partial update) to a complete, valid set of settings. */
export function sanitizeDisplay(raw: unknown): DisplayPrefs {
  const o: Partial<Record<keyof DisplayPrefs, unknown>> = raw && typeof raw === "object" ? raw : {};
  return {
    textSize: pick(o.textSize, TEXT_SIZES, DEFAULT_DISPLAY.textSize),
    theme: pick(o.theme, THEMES, DEFAULT_DISPLAY.theme),
    background: pick(o.background, BACKGROUNDS, DEFAULT_DISPLAY.background),
    font: pick(o.font, FONTS, DEFAULT_DISPLAY.font),
    spacing: o.spacing === "relaxed" ? "relaxed" : "normal",
    motion: o.motion === "reduce" ? "reduce" : "system",
    underlineLinks: o.underlineLinks === true,
    boldText: o.boldText === true,
  };
}

export const isDefaultDisplay = (p: DisplayPrefs) =>
  (Object.keys(DEFAULT_DISPLAY) as (keyof DisplayPrefs)[]).every(
    (k) => p[k] === DEFAULT_DISPLAY[k],
  );

/**
 * Puts settings on the page. Self-contained on purpose (no imports, no outside names): its source text is
 * also the inline boot script, which runs before the app loads.
 */
export function bootDisplay(raw: unknown, root: HTMLElement, prefersDark: boolean): void {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<
    Record<keyof DisplayPrefs, unknown>
  >;
  const size =
    [90, 100, 115, 130, 150].indexOf(o.textSize as number) >= 0 ? (o.textSize as number) : 100;
  let theme =
    ["light", "dark", "contrast", "system"].indexOf(o.theme as string) >= 0 ? o.theme : "light";
  if (theme === "system") theme = prefersDark ? "dark" : "light";
  const bg =
    ["parchment", "white", "gray", "sage", "blue", "rose"].indexOf(o.background as string) >= 0
      ? o.background
      : "parchment";
  const font =
    ["standard", "readable", "system"].indexOf(o.font as string) >= 0 ? o.font : "standard";
  const set = (k: string, v: unknown) => root.setAttribute("data-" + k, String(v));
  set("theme", theme);
  set("bg", bg);
  set("font", font);
  set("spacing", o.spacing === "relaxed" ? "relaxed" : "normal");
  set("motion", o.motion === "reduce" ? "reduce" : "system");
  set("underline", o.underlineLinks === true ? "on" : "off");
  set("bold", o.boldText === true ? "on" : "off");
  root.style.setProperty("--ts", String(size / 100));
  root.style.colorScheme = theme === "dark" ? "dark" : "light";
}

/** Inline script for the page head: applies this browser's saved settings before the first paint. */
export const DISPLAY_BOOT_SCRIPT = `(function(){try{var raw=JSON.parse(localStorage.getItem(${JSON.stringify(
  DISPLAY_STORAGE_KEY,
)})||"null");if(!raw)return;var dark=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches;(${bootDisplay.toString()})(raw,document.documentElement,dark);}catch(e){}})();`;

export const systemPrefersDark = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Apply to this page and remember in this browser. */
export function applyDisplay(p: DisplayPrefs) {
  if (typeof document === "undefined") return;
  bootDisplay(p, document.documentElement, systemPrefersDark());
  try {
    if (isDefaultDisplay(p)) localStorage.removeItem(DISPLAY_STORAGE_KEY);
    else localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Private windows and blocked storage: the setting still applies to this page.
  }
}

export function cachedDisplay(): DisplayPrefs | null {
  try {
    const raw = localStorage.getItem(DISPLAY_STORAGE_KEY);
    return raw ? sanitizeDisplay(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
