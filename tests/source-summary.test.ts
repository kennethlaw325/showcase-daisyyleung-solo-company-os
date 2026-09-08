import { describe, expect, it } from "vitest";
import { presentSourceSummary } from "../src/lib/presentation/source-summary";

describe("source presentation", () => {
  it("uses a human label for pasted or dictated notes without exposing the synthetic filename", () => {
    expect(presentSourceSummary({ sourceKind: "pasted", filename: "pasted-intake.txt", sourceUrl: null, extractionStatus: "extracted", locale: "zh-Hant" })).toEqual({
      kind: "筆記",
      label: "已貼上的文字或語音內容",
      meta: "已完整讀取",
      extracted: true,
    });
  });

  it("preserves a guided upload filename even though its extracted row is stored as pasted evidence", () => {
    expect(presentSourceSummary({ sourceKind: "pasted", filename: "client-brief.pdf", sourceUrl: null, extractionStatus: "extracted", locale: "en" })).toEqual({
      kind: "PDF",
      label: "client-brief.pdf",
      meta: "Fully read",
      extracted: true,
    });
  });
});
