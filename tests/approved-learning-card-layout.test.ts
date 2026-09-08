import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

function declarationBlock(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`^[ \\t]*${escapedSelector}[ \\t]*\\{([^{}]*)\\}`, "m"));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("approved learning card layout", () => {
  it("keeps the owner controls and evidence action aligned across unequal cards", () => {
    const card = declarationBlock(".approved-learning-grid article");
    const sections = declarationBlock(".approved-learning-grid article > .learning-card-sections");

    expect(card).toMatch(/display:\s*grid/i);
    expect(card).toMatch(/grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto\s+auto/i);
    expect(sections).toMatch(/align-content:\s*start/i);
  });
});
