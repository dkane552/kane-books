import { describe, expect, it } from "vitest";
import { qrSrc } from "@/components/app/security";

describe("two-step login QR", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#000"/></svg>';
  it("encodes the SVG supabase-js returns so a # does not cut it off", () => {
    const src = qrSrc(`data:image/svg+xml;utf-8,${svg}`);
    expect(src.startsWith("data:image/svg+xml;charset=utf-8,%3Csvg")).toBe(true);
    expect(decodeURIComponent(src.slice(src.indexOf(",") + 1))).toBe(svg);
  });
  it("leaves an already encoded link alone", () => {
    const enc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    expect(qrSrc(enc)).toBe(enc);
  });
});
