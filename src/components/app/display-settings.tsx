import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel, StatusPill } from "./shared";
import { useAuth } from "./auth";
import { supabase } from "@/lib/supabase";
import {
  BACKGROUNDS,
  DEFAULT_DISPLAY,
  FONTS,
  TEXT_SIZES,
  THEMES,
  applyDisplay,
  cachedDisplay,
  isDefaultDisplay,
  sanitizeDisplay,
  type DisplayPrefs,
} from "@/lib/display";

// ---------- one shared copy of this person's settings ----------
let current: DisplayPrefs = DEFAULT_DISPLAY;
let loaded = false;
const listeners = new Set<() => void>();
const store = {
  get: () => {
    if (!loaded && typeof window !== "undefined") {
      current = cachedDisplay() ?? DEFAULT_DISPLAY;
      loaded = true;
    }
    return current;
  },
  set: (p: DisplayPrefs) => {
    current = p;
    loaded = true;
    applyDisplay(p);
    listeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
const useDisplay = () => useSyncExternalStore(store.subscribe, store.get, () => DEFAULT_DISPLAY);

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let warnedLocalOnly = false;
/** Save to the person's login (debounced, so clicking through options is one write). */
function saveToLogin(email: string, p: DisplayPrefs) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { error } = await supabase
      .from("user_settings")
      .upsert({ email: email.toLowerCase(), display: p }, { onConflict: "email" });
    if (error && !warnedLocalOnly) {
      warnedLocalOnly = true;
      toast.message("Saved on this device only", {
        description: "Your settings could not be saved to your login yet.",
      });
    }
  }, 500);
}

/**
 * Loads the signed-in person's settings from their login and keeps the page in step (including
 * "Match my device" when the device switches between light and dark). Renders nothing.
 */
export function DisplaySync() {
  const { email } = useAuth();
  const prefs = useDisplay();
  const synced = useRef<string | null>(null);

  useEffect(() => {
    if (!email || synced.current === email) return;
    synced.current = email;
    let cancelled = false;
    supabase
      .from("user_settings")
      .select("display")
      .eq("email", email.toLowerCase())
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return;
        if (data) store.set(sanitizeDisplay(data.display));
        // First time on the login: keep what was chosen on this device.
        else if (!isDefaultDisplay(store.get())) saveToLogin(email, store.get());
      });
    return () => {
      cancelled = true;
    };
  }, [email]);

  useEffect(() => {
    if (prefs.theme !== "system" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyDisplay(store.get());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [prefs.theme]);

  return null;
}

// ---------- Settings > Accessibility ----------
export function AccessibilityPanel() {
  const { email } = useAuth();
  const prefs = useDisplay();
  const update = (patch: Partial<DisplayPrefs>) => {
    const next = sanitizeDisplay({ ...prefs, ...patch });
    store.set(next);
    if (email) saveToLogin(email, next);
  };
  const lightOnly = prefs.theme === "dark" || prefs.theme === "contrast";

  return (
    <Panel
      title="Accessibility"
      action={
        <Button
          variant="outline"
          size="sm"
          disabled={isDefaultDisplay(prefs)}
          onClick={() => update(DEFAULT_DISPLAY)}
        >
          <RotateCcw />
          Reset
        </Button>
      }
    >
      <div className="space-y-6 p-[18px]">
        <p className="text-xs text-muted-foreground">
          How the app looks for you. Saved to your login, so it follows you to your phone and
          computer. Nobody else's screen changes.
        </p>

        <Setting
          label="Text size"
          hint="Makes the words bigger or smaller. Buttons and layout stay the same."
        >
          <Choices
            label="Text size"
            value={prefs.textSize}
            options={TEXT_SIZES.map((s) => ({
              value: s.value,
              label: (
                <span className="flex items-baseline gap-1.5">
                  <span style={{ fontSize: `${(s.value / 100) * 14}px` }} aria-hidden>
                    A
                  </span>
                  {s.label}
                </span>
              ),
            }))}
            onChange={(v) => update({ textSize: v })}
          />
        </Setting>

        <Setting label="Colors">
          <Choices
            label="Colors"
            value={prefs.theme}
            options={THEMES.map((t) => ({
              value: t.value,
              label: (
                <span className="flex items-center gap-2">
                  <ThemeChip theme={t.value} />
                  {t.label}
                </span>
              ),
            }))}
            onChange={(v) => update({ theme: v })}
          />
        </Setting>

        <Setting
          label="Background"
          hint={
            lightOnly
              ? "Background colors apply to the Light colors."
              : "The page color behind the panels."
          }
        >
          <div role="radiogroup" aria-label="Background" className="flex flex-wrap gap-3">
            {BACKGROUNDS.map((b) => {
              const on = prefs.background === b.value;
              return (
                <button
                  key={b.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={lightOnly}
                  onClick={() => update({ background: b.value })}
                  className="flex flex-col items-center gap-1 text-[length:calc(11px*var(--ts,1))] disabled:opacity-50"
                >
                  <span
                    className={`grid size-10 place-items-center rounded-full border-2 ${on ? "border-primary" : "border-border"}`}
                    style={{ background: b.swatch }}
                  >
                    {on && <Check className="size-4 text-[oklch(0.373_0.058_163)]" />}
                  </span>
                  {b.label}
                </button>
              );
            })}
          </div>
        </Setting>

        <Setting label="Font">
          <Choices
            label="Font"
            value={prefs.font}
            options={FONTS.map((f) => ({
              value: f.value,
              label: <span style={{ fontFamily: fontStack(f.value) }}>{f.label}</span>,
            }))}
            onChange={(v) => update({ font: v })}
          />
        </Setting>

        <Setting label="Line spacing">
          <Choices
            label="Line spacing"
            value={prefs.spacing}
            options={[
              { value: "normal", label: "Normal" },
              { value: "relaxed", label: "More space between lines" },
            ]}
            onChange={(v) => update({ spacing: v })}
          />
        </Setting>

        <Setting label="Motion" hint="Turns off sliding and fading animations.">
          <Choices
            label="Motion"
            value={prefs.motion}
            options={[
              { value: "system", label: "Match my device" },
              { value: "reduce", label: "Reduce motion" },
            ]}
            onChange={(v) => update({ motion: v })}
          />
        </Setting>

        <Setting label="Reading">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={prefs.boldText}
                onCheckedChange={(v) => update({ boldText: v === true })}
              />
              Bolder text
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={prefs.underlineLinks}
                onCheckedChange={(v) => update({ underlineLinks: v === true })}
              />
              Underline links
            </label>
          </div>
        </Setting>

        <div>
          <div className="mb-2 text-[length:calc(11px*var(--ts,1))] font-semibold uppercase tracking-wide text-muted-foreground">
            Preview
          </div>
          <div className="rounded-md border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-semibold">Lot 59 · Old Mill</div>
              <StatusPill tone="approved">In progress</StatusPill>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Framing inspection passed on Tuesday. Drywall starts next week, and the{" "}
              <a href="#preview" onClick={(e) => e.preventDefault()} className="text-primary">
                cabinet selection
              </a>{" "}
              is due Friday.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" type="button">
                Approve
              </Button>
              <Button size="sm" variant="outline" type="button">
                Not now
              </Button>
              <span className="number ml-auto text-sm">$1,469,350.00</span>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function fontStack(f: DisplayPrefs["font"]) {
  if (f === "readable") return '"Atkinson Hyperlegible", sans-serif';
  if (f === "system") return 'system-ui, -apple-system, "Segoe UI", sans-serif';
  return '"Archivo", sans-serif';
}

function ThemeChip({ theme }: { theme: DisplayPrefs["theme"] }) {
  const [bg, fg] =
    theme === "dark"
      ? ["oklch(0.205 0.008 160)", "oklch(0.93 0.006 85)"]
      : theme === "contrast"
        ? ["oklch(1 0 0)", "oklch(0 0 0)"]
        : ["oklch(0.963 0.012 83)", "oklch(0.289 0 0)"];
  return (
    <span
      aria-hidden
      className="grid size-5 place-items-center rounded border text-[length:calc(10px*var(--ts,1))] font-bold"
      style={
        theme === "system"
          ? {
              background: `linear-gradient(135deg, ${"oklch(0.963 0.012 83)"} 50%, ${"oklch(0.205 0.008 160)"} 50%)`,
            }
          : { background: bg, color: fg, borderColor: theme === "contrast" ? fg : undefined }
      }
    >
      {theme === "system" ? "" : "A"}
    </span>
  );
}

function Setting({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <div>
        <div className="text-xs font-semibold">{label}</div>
        {hint && (
          <div className="mt-0.5 text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div>{children}</div>
    </section>
  );
}

/** A row of buttons that behaves as one radio group (arrow keys move the choice). */
function Choices<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => {
    const n = (i + options.length) % options.length;
    onChange(options[n]!.value);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const step =
                e.key === "ArrowRight" || e.key === "ArrowDown"
                  ? 1
                  : e.key === "ArrowLeft" || e.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              e.preventDefault();
              move(i + step);
            }}
            className={`min-h-9 rounded-md border px-3 py-1.5 text-xs transition-colors ${
              on
                ? "border-primary bg-accent font-semibold text-foreground"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
