import { describe, expect, it } from "vitest";
import { SCHEMES, contrast, contrastPairs, resolveScheme } from "./themes";

describe("interface colour schemes", () => {
  it("offers light, dark and high-contrast schemes", () => {
    expect(SCHEMES.filter((s) => s.group === "Light").length).toBeGreaterThanOrEqual(4);
    expect(SCHEMES.filter((s) => s.group === "High contrast").map((s) => s.dark).sort()).toEqual([false, true]);
    expect(new Set(SCHEMES.map((s) => s.id)).size).toBe(SCHEMES.length);
  });
  for (const s of SCHEMES)
    it(`${s.name}: every text and background pair is readable`, () => {
      const weak = contrastPairs(s.tokens).map((p) => ({ ...p, ratio: contrast(p.fg, p.bg) })).filter((p) => p.ratio < p.min)
        .map((p) => `${p.name}: ${p.ratio.toFixed(2)} < ${p.min} (${p.fg} on ${p.bg})`);
      expect(weak).toEqual([]);
    });
  it("high-contrast schemes reach 7:1 even for muted text", () => {
    for (const s of SCHEMES.filter((x) => x.group === "High contrast"))
      for (const bg of [s.tokens.bg, s.tokens.panel, s.tokens["panel-2"]]) expect(contrast(s.tokens["ink-3"], bg)).toBeGreaterThanOrEqual(7);
  });
  it("resolves auto and system choices", () => {
    expect(resolveScheme("auto", "cosmic").id).toBe("cosmic");
    expect(resolveScheme(undefined, "nope").id).toBe("library");
    expect(resolveScheme("system", "arena", true).id).toBe("daylight");
    expect(resolveScheme("system", "arena", false).id).toBe("arena");
    expect(resolveScheme("paper", "arena").id).toBe("paper");
  });
});
