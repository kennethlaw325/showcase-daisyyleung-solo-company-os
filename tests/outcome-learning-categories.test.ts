import { describe, expect, it } from "vitest";
import { groupOutcomeLearnings, outcomeLearningCategoryForModule, outcomeLearningCategoryLabels } from "../src/lib/presentation/outcome-learning";

describe("outcome learning categories", () => {
  it("derives categories from canonical modules with workspace fallback", () => {
    expect(outcomeLearningCategoryForModule("growth")).toBe("growth");
    expect(outcomeLearningCategoryForModule("Business Insights")).toBe("operations");
    expect(outcomeLearningCategoryForModule("Business Intelligence & Operating Memory")).toBe("operations");
    expect(outcomeLearningCategoryForModule("Brand Communications & PR")).toBe("intelligence");
    expect(outcomeLearningCategoryForModule("unknown")).toBe("workspace");
  });

  it("groups records without losing source order within each category", () => {
    const grouped = groupOutcomeLearnings([
      { module: "operations", id: "2" },
      { module: "growth", id: "1" },
      { module: "operations", id: "3" },
      { module: "other", id: "4" },
    ]);
    expect(grouped.growth.map((item) => item.id)).toEqual(["1"]);
    expect(grouped.operations.map((item) => item.id)).toEqual(["2", "3"]);
    expect(grouped.workspace.map((item) => item.id)).toEqual(["4"]);
  });

  it("provides bilingual category labels", () => {
    expect(outcomeLearningCategoryLabels("en").growth).toBe("Growth & Revenue");
    expect(outcomeLearningCategoryLabels("zh-Hant").growth).toBe("增長與收入");
  });
});
