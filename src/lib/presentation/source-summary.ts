import type { Locale } from "../i18n/locale";

const syntheticPastedFilenames = new Set(["intake.txt", "pasted-intake.txt"]);

export function presentSourceSummary(input: {
  sourceKind: string | null;
  filename: string | null;
  sourceUrl: string | null;
  extractionStatus: string | null;
  locale: Locale;
}) {
  const zh = input.locale === "zh-Hant";
  // Guided uploads are stored as extracted evidence rows without retaining
  // their original bytes.  Their real filename still distinguishes them from
  // the synthetic source used for pasted text and speech transcripts.
  const pastedNotes = input.sourceKind === "pasted" && syntheticPastedFilenames.has(input.filename ?? "");
  const extracted = input.extractionStatus === "extracted";
  return {
    kind: input.sourceKind === "url" ? "URL" : pastedNotes ? (zh ? "筆記" : "Notes") : String(input.filename?.split(".").pop() ?? "FILE").toUpperCase(),
    label: pastedNotes ? (zh ? "已貼上的文字或語音內容" : "Pasted or dictated notes") : input.filename ?? input.sourceUrl ?? (zh ? "來源" : "Source"),
    meta: extracted ? (zh ? "已完整讀取" : "Fully read") : input.extractionStatus === "failed" ? (zh ? "未能讀取內容" : "Could not read content") : (zh ? "等待讀取" : "Waiting to be read"),
    extracted,
  };
}
