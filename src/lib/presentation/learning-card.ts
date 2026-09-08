export type LearningCardSections = {
  observedResult: string;
  learning: string;
  applicability: string;
  evidence: string;
  evidenceConfidence: string;
  supportingOutcomeCount: string;
  learningConfidence: string;
  validationStatus: string;
  hypothesis: string;
  nextAction: string;
  improvements: string;
};

export type LearningCardInput = {
  note: string;
  observedResult?: string | null;
  applicability?: string | null;
  evidence?: string | null;
  confidence?: string | null;
  evidenceConfidence?: string | null;
  supportingOutcomeCount?: number | null;
  learningConfidence?: string | null;
  validationStatus?: string | null;
  hypothesis?: string | null;
  nextAction?: string | null;
  improvements?: string | null;
  /** Legacy outcome field retained only for parsing old snapshots. */
  otherAngles?: string | null;
};

type LearningDisplayLocale = "en" | "zh-Hant";

const CONFIDENCE_LABELS: Record<LearningDisplayLocale, Record<string, string>> = {
  en: { low: "Low", medium: "Medium", high: "High" },
  "zh-Hant": { low: "低", medium: "中", high: "高" },
};

const VALIDATION_LABELS: Record<LearningDisplayLocale, Record<string, string>> = {
  en: { pending_validation: "Pending validation", validated: "Validated", rejected: "Rejected" },
  "zh-Hant": { pending_validation: "待驗證", validated: "已驗證", rejected: "已拒絕" },
};

const LABELS = [
  { key: "observedResult", patterns: ["已觀察到的結果", "實際結果", "Observed result"] },
  { key: "learning", patterns: ["候選學習", "可重用學習", "Reusable learning", "Candidate learning"] },
  { key: "applicability", patterns: ["適用情境", "適用時機", "When it applies", "Applicability"] },
  { key: "evidence", patterns: ["已記錄證據", "Recorded evidence", "Evidence", "實證與置信度", "Evidence & confidence"] },
  { key: "evidenceConfidence", patterns: ["證據信心", "Evidence confidence"] },
  { key: "hypothesis", patterns: ["假設 to test", "Hypothesis to test", "可測試的其他方向", "Other angles to test", "其他測試角度"] },
  { key: "nextAction", patterns: ["下一步行動", "Next action", "Next step/test action"] },
  { key: "improvements", patterns: ["可改進之處", "What can be improved", "Improvements"] },
] as const;

const LEARNING_TITLE_MAX_LENGTH = 72;
const TRAILING_LIST_PUNCTUATION = /[\s。．.!！?？;；,，、·]+$/u;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Split legacy all-in-one learning notes without collapsing epistemic fields. */
export function parseLearningCardSections(note: string): LearningCardSections {
  const normalized = note.trim();
  const matches = LABELS.flatMap(({ key, patterns }) => patterns.map((pattern) => ({
    key,
    match: new RegExp(`(?:^|[\\s。])${escapeRegExp(pattern)}\\s*[:：]`, "i").exec(normalized),
  })))
    .filter((item): item is typeof item & { match: RegExpExecArray } => Boolean(item.match))
    .sort((left, right) => left.match.index - right.match.index);

  const sections: LearningCardSections = {
    observedResult: "",
    learning: normalized,
    applicability: "",
    evidence: "",
    evidenceConfidence: "",
    supportingOutcomeCount: "",
    learningConfidence: "",
    validationStatus: "",
    hypothesis: "",
    nextAction: "",
    improvements: "",
  };
  if (!matches.length) return sections;

  for (const [index, item] of matches.entries()) {
    const start = item.match.index + item.match[0].length;
    const end = matches[index + 1]?.match.index ?? normalized.length;
    sections[item.key] = normalized.slice(start, end).trim().replace(/[。.]$/, "");
  }
  if (!sections.learning) sections.learning = normalized;
  return sections;
}

function firstRecorded(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && Boolean(value.trim()))?.trim() ?? "";
}

function withoutTrailingListPunctuation(value: string) {
  return value.trim().replace(TRAILING_LIST_PUNCTUATION, "").trim();
}

/** Join independent display values with one separator, without mixed punctuation. */
export function joinLearningCardValues(values: Array<string | null | undefined>): string {
  const normalized = values
    .map((value) => typeof value === "string" ? withoutTrailingListPunctuation(value) : "")
    .filter(Boolean);
  return [...new Set(normalized)].join(" · ");
}

/** Use the learning itself—not its source case—as the card's concise title. */
export function summarizeLearningTitle(learning: string): string {
  const normalized = learning.replace(/\s+/g, " ").trim();
  const firstClause = normalized.split(/(?:[。！？!?；;]+|\.\s+)/u).find(Boolean) ?? normalized;
  const concise = withoutTrailingListPunctuation(firstClause);
  const characters = Array.from(concise);
  if (characters.length <= LEARNING_TITLE_MAX_LENGTH) return concise;
  const clipped = characters.slice(0, LEARNING_TITLE_MAX_LENGTH).join("").trimEnd();
  const wordSafe = /\s/u.test(clipped) ? clipped.replace(/\s+\S*$/u, "").trimEnd() : clipped;
  return `${wordSafe || clipped}…`;
}

export function localizeLearningConfidence(confidence: string, locale: LearningDisplayLocale): string {
  const normalized = confidence.trim().toLowerCase();
  return CONFIDENCE_LABELS[locale][normalized] ?? confidence;
}

export function localizeLearningValidationStatus(status: string, locale: LearningDisplayLocale): string {
  const normalized = status.trim().toLowerCase();
  return VALIDATION_LABELS[locale][normalized] ?? status;
}

export function localizeLearningEvidence(evidence: string, locale: LearningDisplayLocale): string {
  if (locale === "en") return evidence;
  return evidence.replace(/\bstaging\b\s*/gi, "測試環境");
}

/**
 * Build independent card sections. `otherAngles` is the test hypothesis and
 * `nextAction` is the next step; neither is merged with improvements.
 */
export function presentLearningCard(input: LearningCardInput): LearningCardSections {
  const parsed = parseLearningCardSections(input.note);
  const count = input.supportingOutcomeCount == null ? "" : String(input.supportingOutcomeCount);
  return {
    observedResult: firstRecorded(input.observedResult),
    learning: parsed.learning,
    applicability: firstRecorded(input.applicability, parsed.applicability),
    evidence: firstRecorded(input.evidence, parsed.evidence),
    evidenceConfidence: firstRecorded(input.evidenceConfidence, input.confidence, parsed.evidenceConfidence),
    supportingOutcomeCount: count,
    learningConfidence: firstRecorded(input.learningConfidence),
    validationStatus: firstRecorded(input.validationStatus),
    hypothesis: firstRecorded(input.hypothesis, input.otherAngles, parsed.hypothesis),
    nextAction: firstRecorded(input.nextAction, parsed.nextAction),
    improvements: firstRecorded(input.improvements, parsed.improvements),
  };
}
