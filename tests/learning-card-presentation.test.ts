import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { joinLearningCardValues, localizeLearningConfidence, localizeLearningEvidence, parseLearningCardSections, presentLearningCard, summarizeLearningTitle } from "../src/lib/presentation/learning-card";

describe("learning card presentation", () => {
  it("splits a legacy Traditional Chinese learning note into readable sections", () => {
    expect(parseLearningCardSections(
      "可重用學習：語言切換與 provider 遷移應分開驗證。適用時機：進行多語言部署時。實證與置信度：Staging 測試已通過（高）。下一步行動：加入 smoke test。",
    )).toEqual({
      observedResult: "",
      learning: "語言切換與 provider 遷移應分開驗證",
      applicability: "進行多語言部署時",
      evidence: "Staging 測試已通過（高）",
      evidenceConfidence: "",
      supportingOutcomeCount: "",
      learningConfidence: "",
      validationStatus: "",
      hypothesis: "",
      nextAction: "加入 smoke test",
      improvements: "",
    });
  });

  it("keeps a new concise learning intact", () => {
    expect(parseLearningCardSections("Validate provider and locale changes independently.")).toEqual({
      observedResult: "",
      learning: "Validate provider and locale changes independently.",
      applicability: "",
      evidence: "",
      evidenceConfidence: "",
      supportingOutcomeCount: "",
      learningConfidence: "",
      validationStatus: "",
      hypothesis: "",
      nextAction: "",
      improvements: "",
    });
  });

  it("parses the new observed-result, candidate-learning, and applicability labels", () => {
    expect(parseLearningCardSections(
      "實際結果：客戶因預算未開而未能推進。候選學習：先確認預算時間及審批流程。適用情境：銷售 → Warm lead → 預算未確認。",
    )).toMatchObject({
      observedResult: "客戶因預算未開而未能推進",
      learning: "先確認預算時間及審批流程",
      applicability: "銷售 → Warm lead → 預算未確認",
    });
  });

  it("presents a legacy all-in-one note as four distinct card values", () => {
    expect(presentLearningCard({
      note: "可重用學習：語言切換不應與 provider migration 綁在同一個 release。適用時機：進行 API 遷移時。實證與置信度：Staging 已通過（高）。下一步行動：加入 smoke test。",
    })).toEqual({
      observedResult: "",
      learning: "語言切換不應與 provider migration 綁在同一個 release",
      applicability: "進行 API 遷移時",
      evidence: "Staging 已通過（高）",
      evidenceConfidence: "",
      supportingOutcomeCount: "",
      learningConfidence: "",
      validationStatus: "",
      hypothesis: "",
      nextAction: "加入 smoke test",
      improvements: "",
    });
  });

  it("prefers recorded outcome fields without duplicating legacy sections or mixed punctuation", () => {
    expect(presentLearningCard({
      note: "可重用學習：分開驗證。適用時機：舊時機。實證與置信度：舊證據。下一步行動：舊行動。可改進之處：舊改進。其他測試角度：舊角度。",
      applicability: "目前時機",
      evidence: "目前證據",
      confidence: "high",
      nextAction: "目前行動。",
      improvements: "可改進之處。",
      otherAngles: "其他測試角度。",
    })).toEqual({
      observedResult: "",
      learning: "分開驗證",
      applicability: "目前時機",
      evidence: "目前證據",
      evidenceConfidence: "high",
      supportingOutcomeCount: "",
      learningConfidence: "",
      validationStatus: "",
      hypothesis: "其他測試角度。",
      nextAction: "目前行動。",
      improvements: "可改進之處。",
    });
  });

  it("uses a single separator between punctuated evidence values", () => {
    expect(joinLearningCardValues(["測試結果。", "高"])).toBe("測試結果 · 高");
    expect(joinLearningCardValues(["One result.", "High"])).toBe("One result · High");
  });

  it("summarizes the learning itself as the title", () => {
    expect(summarizeLearningTitle(
      "語言切換不應與 provider migration 綁在同一個未驗證 release 中發布；部署前須分別驗證 endpoint、schema 與 migration。",
    )).toBe("語言切換不應與 provider migration 綁在同一個未驗證 release 中發布");
  });

  it("uses keyboard-accessible evidence disclosure backed by outcome evidence", () => {
    const page = readFileSync(resolve(process.cwd(), "app/app/outcomes/page.tsx"), "utf8");
    expect(page).toContain('from("case_outcomes")');
    expect(page).toContain('<details className="learning-evidence">');
    expect(page).toContain("已記錄證據");
    expect(page).toContain("來源個案：");
    expect(page).toContain("/app/cases/${item.sourceCaseId}");
    expect(page).toContain("title: summarizeLearningTitle(presentation.learning)");
    expect(page).toContain('<p className="portal-section-subtitle">只有已確認的學習才會建議在新工作使用</p>');
    expect(page).toContain('operations: "Business Insights"');
    expect(page).not.toContain('<button type="button"><Localized zh={<>查看證據 →</>}');
  });

  it("localizes operational evidence and confidence for the Traditional Chinese view", () => {
    expect(localizeLearningEvidence("Staging 介面狀態已更新。", "zh-Hant")).toBe("測試環境介面狀態已更新。");
    expect(localizeLearningConfidence("high", "zh-Hant")).toBe("高");
    expect(localizeLearningConfidence("medium", "en")).toBe("Medium");
  });
});
