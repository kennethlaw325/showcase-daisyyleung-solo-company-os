import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function declarationBlock(selector: string) {
  const match = styles.match(new RegExp(`^[ \\t]*${escapeRegExp(selector)}[ \\t]*\\{([^{}]*)\\}`, "m"));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

function pixelValue(block: string, property: "min-width" | "min-height") {
  const match = block.match(new RegExp(`\\b${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px\\b`));
  expect(match, `Missing pixel ${property}`).not.toBeNull();
  return Number(match?.[1] ?? 0);
}

describe("design accessibility contract", () => {
  it("keeps compact and language tap targets at least 44px in both dimensions", () => {
    const interactiveSelectors = [
      ".theme-toggle",
      ".theme-toggle.is-compact",
      ".language-button",
      ".form-language-button",
      ".portal-language-button",
      ".portal-mobile-bar > a:last-child",
      ".portal-mobile-actions > a",
    ];

    for (const selector of interactiveSelectors) {
      const block = declarationBlock(selector);
      expect(pixelValue(block, "min-width"), `${selector} min-width`).toBeGreaterThanOrEqual(44);
      expect(pixelValue(block, "min-height"), `${selector} min-height`).toBeGreaterThanOrEqual(44);
    }
  });
});
