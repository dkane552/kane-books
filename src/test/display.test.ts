import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY,
  DISPLAY_BOOT_SCRIPT,
  DISPLAY_STORAGE_KEY,
  applyDisplay,
  bootDisplay,
  cachedDisplay,
  isDefaultDisplay,
  sanitizeDisplay,
} from "@/lib/display";

const root = () => document.documentElement;
afterEach(() => {
  localStorage.clear();
  for (const a of [...root().attributes])
    if (a.name.startsWith("data-")) root().removeAttribute(a.name);
  root().removeAttribute("style");
});

describe("display settings", () => {
  it("fills in defaults and drops anything unknown", () => {
    expect(sanitizeDisplay(null)).toEqual(DEFAULT_DISPLAY);
    expect(sanitizeDisplay({ textSize: 999, theme: "neon", font: "comic" })).toEqual(
      DEFAULT_DISPLAY,
    );
    expect(
      sanitizeDisplay({
        textSize: 130,
        theme: "dark",
        background: "sage",
        boldText: true,
        extra: 1,
      }),
    ).toEqual({
      ...DEFAULT_DISPLAY,
      textSize: 130,
      theme: "dark",
      background: "sage",
      boldText: true,
    });
    expect(isDefaultDisplay(DEFAULT_DISPLAY)).toBe(true);
    expect(isDefaultDisplay({ ...DEFAULT_DISPLAY, spacing: "relaxed" })).toBe(false);
  });

  it("puts the settings on the page", () => {
    bootDisplay(
      {
        textSize: 130,
        theme: "contrast",
        font: "readable",
        spacing: "relaxed",
        underlineLinks: true,
      },
      root(),
      false,
    );
    expect(root().dataset).toMatchObject({
      theme: "contrast",
      bg: "parchment",
      font: "readable",
      spacing: "relaxed",
      motion: "system",
      underline: "on",
      bold: "off",
    });
    expect(root().style.getPropertyValue("--ts")).toBe("1.3");
    expect(root().style.zoom || "").toBe("");
  });

  it("follows the device for Match my device", () => {
    bootDisplay({ theme: "system" }, root(), true);
    expect(root().dataset["theme"]).toBe("dark");
    bootDisplay({ theme: "system" }, root(), false);
    expect(root().dataset["theme"]).toBe("light");
  });

  it("default size is a text scale of 1, and the page is never zoomed", () => {
    bootDisplay({ textSize: 150 }, root(), false);
    expect(root().style.zoom || "").toBe("");
    bootDisplay({}, root(), false);
    expect(root().style.getPropertyValue("--ts")).toBe("1");
  });

  it("remembers settings in this browser, and forgets them on reset", () => {
    applyDisplay({ ...DEFAULT_DISPLAY, textSize: 150 });
    expect(cachedDisplay()?.textSize).toBe(150);
    applyDisplay(DEFAULT_DISPLAY);
    expect(localStorage.getItem(DISPLAY_STORAGE_KEY)).toBeNull();
  });

  it("the head script applies the saved settings before the app loads", () => {
    localStorage.setItem(
      DISPLAY_STORAGE_KEY,
      JSON.stringify({ textSize: 115, theme: "dark", background: "blue" }),
    );
    new Function(DISPLAY_BOOT_SCRIPT)();
    expect(root().dataset["theme"]).toBe("dark");
    expect(root().dataset["bg"]).toBe("blue");
    expect(root().style.getPropertyValue("--ts")).toBe("1.15");
  });

  it("the head script does nothing harmful with nothing or junk saved", () => {
    new Function(DISPLAY_BOOT_SCRIPT)();
    expect(root().dataset["theme"]).toBeUndefined();
    localStorage.setItem(DISPLAY_STORAGE_KEY, "{not json");
    expect(() => new Function(DISPLAY_BOOT_SCRIPT)()).not.toThrow();
  });
});
