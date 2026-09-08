import { describe, expect, it } from "vitest";
import {
  buildDefaultActionDraft,
  localizeReadableHeading,
  parseReadableContent,
  serializeReadableContent,
} from "../src/lib/presentation/human-readable";
import { HUMAN_READABLE_OUTPUT_INSTRUCTIONS, TEMPLATE_VERSIONS } from "../src/lib/domain/templates";

describe("human-readable artifact presentation", () => {
  it("turns an inline Markdown-like artifact into readable sections without losing words", () => {
    const source =
      "### Strongest Growth Signal **Structured Project Tracking:** Qualified teams need one visible place to track decisions. ### Core Hypothesis By making the next decision explicit, follow-up becomes easier. ### Recommended Next Action Review the tracked decisions with the team.";
    const blocks = parseReadableContent(source);
    const renderedText = serializeReadableContent(source);

    expect(blocks.filter((block) => block.kind === "heading").map((block) => block.text)).toEqual([
      "Strongest Growth Signal",
      "Core Hypothesis",
      "Recommended Next Action",
    ]);
    expect(renderedText).not.toMatch(/###|\*\*/);
    for (const phrase of [
      "Strongest Growth Signal",
      "Structured Project Tracking:",
      "Qualified teams need one visible place to track decisions.",
      "Core Hypothesis",
      "By making the next decision explicit, follow-up becomes easier.",
      "Review the tracked decisions with the team.",
    ]) {
      expect(renderedText).toContain(phrase);
    }
  });

  it("groups paragraphs, bullets, and numbered items into semantic blocks", () => {
    const blocks = parseReadableContent("First paragraph.\n\n- Alpha\n* Beta\n• Gamma\n\n1. One\n2) Two");
    expect(blocks).toEqual([
      { kind: "paragraph", lines: ["First paragraph."] },
      { kind: "unordered-list", items: ["Alpha", "Beta", "Gamma"] },
      { kind: "ordered-list", items: ["One", "Two"] },
    ]);
  });

  it("keeps analysis and bottleneck separate while localizing their display labels", () => {
    const blocks = parseReadableContent("### Details\n### Bottleneck\nA missing owner.\n### Analysis\nThe handoff is unclear.");
    expect(blocks.filter((block) => block.kind === "heading").map((block) => block.text)).toEqual([
      "Details",
      "Bottleneck",
      "Analysis",
    ]);
    expect(localizeReadableHeading("Details", "zh-Hant")).toBe("詳細內容");
    expect(localizeReadableHeading("Bottleneck", "zh-Hant")).toBe("目前阻礙");
    expect(localizeReadableHeading("Analysis", "zh-Hant")).toBe("原因分析");
    expect(localizeReadableHeading("Analysis", "en")).toBe("Analysis");
  });

  it("builds a neutral, editable email default from all artifact fields", () => {
    const draft = buildDefaultActionDraft({
      title: "Demand-to-revenue strategy",
      summary: "Position the offer around one measurable outcome.",
      body: "### Signal **Qualified demand:** Keep the details readable.\n\n- Confirm the buyer signal\n- Prepare the follow-up",
      nextAction: "Review the nurture draft",
    });

    expect(draft.subject).toBe("A focused next step: Demand-to-revenue strategy");
    expect(draft.body).toContain("Hi,");
    expect(draft.body).toContain("Summary\nPosition the offer around one measurable outcome.");
    expect(draft.body).toContain("Signal\n\nQualified demand: Keep the details readable.");
    expect(draft.body).toContain("- Confirm the buyer signal\n- Prepare the follow-up");
    expect(draft.body).toContain("Next step\nReview the nurture draft");
    expect(draft.body).toContain("Best,\n[Your name]");
    expect(draft.body).not.toMatch(/###|\*\*|```/);
  });

  it("builds a concise key-points email without copying the full case body", () => {
    const draft = buildDefaultActionDraft({
      title: "Client onboarding decision",
      summary: "The client needs one confirmed onboarding route.",
      body: "### Context\nThe current handoff has five steps and two owners.\n\n- Confirm the delivery owner\n- Remove the duplicate approval\n- Keep the client update short\n- This fourth point should not appear",
      nextAction: "Confirm the owner by Friday.",
    }, "en", "key-points");

    expect(draft.subject).toBe("Action needed: Client onboarding decision");
    expect(draft.body).toContain("Key points");
    expect(draft.body).toContain("- The client needs one confirmed onboarding route.");
    expect(draft.body).toContain("- The current handoff has five steps and two owners.");
    expect(draft.body).toContain("- Confirm the delivery owner");
    expect(draft.body).toContain("Action needed\nConfirm the owner by Friday.");
    expect(draft.body).not.toContain("This fourth point should not appear");
    expect(draft.body).not.toContain("Details");
  });

  it("localizes the key-points email template", () => {
    const draft = buildDefaultActionDraft({
      title: "確認交付安排",
      summary: "客戶需要一個清楚決定。",
      body: "- 確認負責人\n- 確認日期",
      nextAction: "星期五前回覆。",
    }, "zh-Hant", "key-points");

    expect(draft.subject).toBe("需要跟進：確認交付安排");
    expect(draft.body).toContain("重點");
    expect(draft.body).toContain("需要跟進\n星期五前回覆。");
  });
});

describe("future AI formatting instructions", () => {
  it("requires plain text sections and forbids presentation-breaking markers", () => {
    expect(HUMAN_READABLE_OUTPUT_INSTRUCTIONS).toMatch(/human-readable plain text/i);
    expect(HUMAN_READABLE_OUTPUT_INSTRUCTIONS).toContain("blank lines");
    expect(HUMAN_READABLE_OUTPUT_INSTRUCTIONS).toContain("- ");
    expect(HUMAN_READABLE_OUTPUT_INSTRUCTIONS).toMatch(/JSON/);
    expect(HUMAN_READABLE_OUTPUT_INSTRUCTIONS).toMatch(/code fences/);
    expect(HUMAN_READABLE_OUTPUT_INSTRUCTIONS).toContain("#");
    expect(HUMAN_READABLE_OUTPUT_INSTRUCTIONS).toContain("**");
    expect(Object.values(TEMPLATE_VERSIONS).every((template) => template.prompt.includes(HUMAN_READABLE_OUTPUT_INSTRUCTIONS))).toBe(true);
  });
});
