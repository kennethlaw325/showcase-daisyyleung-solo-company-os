import type { Locale } from "../i18n/locale";

export type ReadableBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "unordered-list"; items: string[] }
  | { kind: "ordered-list"; items: string[] };

export type ActionDraftSource = {
  title: string;
  summary: string;
  body: string;
  nextAction: string;
};

export type DefaultActionDraft = {
  subject: string;
  body: string;
};

export type ActionDraftTemplate = "detailed" | "key-points";

/*
 * A small, deliberately conservative presentation parser. Persisted artifact
 * strings are never passed through this function before hashing or saving; it
 * only gives the portal a safe way to present text that may contain a little
 * Markdown-like formatting from an older or third-party model response.
 */
const KNOWN_HEADING_PREFIXES = [
  "Strongest Growth Signal",
  "Recommended Next Action",
  "Core Hypothesis",
  "Recommended Action",
  "Key Insight",
  "Working Artifact",
  "Next Action",
  "Summary",
  "Decision",
  "Details",
  "Evidence",
  "Implication",
  "Bottleneck",
  "Analysis",
  "Recommendation",
] as const;

const ZH_HANT_HEADING_LABELS: Record<string, string> = {
  "Strongest Growth Signal": "最強增長訊號",
  "Recommended Next Action": "建議下一步",
  "Core Hypothesis": "核心假設",
  "Recommended Action": "建議行動",
  "Key Insight": "關鍵洞察",
  "Working Artifact": "工作內容",
  "Next Action": "下一步",
  Summary: "摘要",
  Decision: "決策",
  Details: "詳細內容",
  Evidence: "證據",
  Implication: "影響",
  Bottleneck: "目前阻礙",
  Analysis: "原因分析",
  Recommendation: "建議",
};

/** Localize structural headings for display without changing persisted text. */
export function localizeReadableHeading(value: string, locale: Locale): string {
  return locale === "zh-Hant" ? ZH_HANT_HEADING_LABELS[value] ?? value : value;
}

function cleanInlineText(value: string): string {
  return value
    .replace(/```/g, "")
    .replace(/\*\*(.*?)\*\*/gs, "$1")
    .replace(/__(.*?)__/gs, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    // Remove stray emphasis/heading markers as a safe fallback for malformed
    // model output. The substantive words around them remain untouched.
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/#{3,}/g, "")
    .trim();
}

function splitInlineHeadings(value: string): string {
  // Some previously generated artifacts put several `###` headings in one
  // paragraph. Treat a heading marker after whitespace as a new line for
  // presentation only; the source value itself remains unchanged.
  return value.replace(/\s+(?=#{1,6}\s)/g, "\n");
}

function headingWithContinuation(line: string): ReadableBlock[] | undefined {
  const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
  if (!match) return undefined;

  const level = Math.min(match[1].length, 6);
  const payload = match[2].trim();
  const knownPrefix = KNOWN_HEADING_PREFIXES.find(
    (prefix) => payload === prefix || payload.startsWith(`${prefix} `),
  );
  const boldPrefix = payload.match(/^(.+?)\s+\*\*(.+?)\*\*(.*)$/s);
  const title = knownPrefix ?? (boldPrefix?.[1].trim() || payload);
  const continuation = knownPrefix
    ? payload.slice(knownPrefix.length).trim()
    : boldPrefix
      ? `${boldPrefix[2]}${boldPrefix[3]}`.trim()
      : "";
  const blocks: ReadableBlock[] = [{ kind: "heading", level, text: cleanInlineText(title) }];
  if (continuation) blocks.push({ kind: "paragraph", lines: [cleanInlineText(continuation)] });
  return blocks;
}

function flushParagraph(blocks: ReadableBlock[], lines: string[]): void {
  const cleaned = lines.map(cleanInlineText).filter(Boolean);
  if (cleaned.length) blocks.push({ kind: "paragraph", lines: cleaned });
  lines.length = 0;
}

function flushList(blocks: ReadableBlock[], kind: "unordered-list" | "ordered-list", items: string[]): void {
  if (items.length) blocks.push({ kind, items: items.map(cleanInlineText).filter(Boolean) });
  items.length = 0;
}

/** Parse plain text and a small, safe subset of Markdown-like structure. */
export function parseReadableContent(value: string): ReadableBlock[] {
  const blocks: ReadableBlock[] = [];
  const paragraphLines: string[] = [];
  let listKind: "unordered-list" | "ordered-list" | undefined;
  const listItems: string[] = [];

  const flushAnyList = () => {
    if (listKind) flushList(blocks, listKind, listItems);
    listKind = undefined;
  };

  for (const rawLine of splitInlineHeadings(value.replace(/\r\n?/g, "\n")).split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph(blocks, paragraphLines);
      flushAnyList();
      continue;
    }

    const headingBlocks = headingWithContinuation(line);
    if (headingBlocks) {
      flushParagraph(blocks, paragraphLines);
      flushAnyList();
      blocks.push(...headingBlocks);
      continue;
    }

    const unordered = line.match(/^[-*•]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph(blocks, paragraphLines);
      const nextKind = unordered ? "unordered-list" : "ordered-list";
      if (listKind && listKind !== nextKind) flushAnyList();
      listKind = nextKind;
      listItems.push((unordered ?? ordered)?.[1] ?? "");
      continue;
    }

    flushAnyList();
    paragraphLines.push(line);
  }

  flushParagraph(blocks, paragraphLines);
  flushAnyList();
  return blocks;
}

/** Serialize presentation blocks without Markdown markers for email defaults. */
export function serializeReadableContent(value: string): string {
  return parseReadableContent(value)
    .map((block) => {
      if (block.kind === "heading") return block.text;
      if (block.kind === "paragraph") return block.lines.join("\n");
      const marker = block.kind === "unordered-list" ? "- " : "1. ";
      return block.items.map((item, index) => (block.kind === "ordered-list" ? `${index + 1}. ${item}` : `${marker}${item}`)).join("\n");
    })
    .join("\n\n")
    .trim();
}

function singleLine(value: string): string {
  return serializeReadableContent(value).replace(/\s+/g, " ").trim();
}

function conciseKeyPoints(source: ActionDraftSource): string[] {
  const candidates = [
    serializeReadableContent(source.summary),
    ...parseReadableContent(source.body).flatMap((block) => {
      if (block.kind === "heading") return [];
      if (block.kind === "paragraph") return block.lines;
      return block.items;
    }),
  ];
  const seen = new Set<string>();
  return candidates
    .map((value) => singleLine(value))
    .filter((value) => {
      const normalized = value.toLocaleLowerCase();
      if (!value || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 3);
}

/** Build a deterministic, editable email draft from an artifact's four fields. */
export function buildDefaultActionDraft(
  source: ActionDraftSource,
  locale: Locale = "en",
  template: ActionDraftTemplate = "detailed",
): DefaultActionDraft {
  const title = singleLine(source.title);
  const summary = serializeReadableContent(source.summary);
  const details = serializeReadableContent(source.body);
  const nextAction = serializeReadableContent(source.nextAction);
  const isChinese = locale === "zh-Hant";

  if (template === "key-points") {
    const points = conciseKeyPoints(source);
    const subject = `${isChinese ? "需要跟進：" : "Action needed: "}${title}`.slice(0, 998);
    const body = [
      isChinese ? "你好，" : "Hi,",
      "",
      isChinese ? `以下是「${title}」的重點：` : `Here are the key points for ${title}.`,
      "",
      isChinese ? "重點" : "Key points",
      ...points.map((point) => `- ${point}`),
      "",
      isChinese ? "需要跟進" : "Action needed",
      nextAction,
      "",
      isChinese ? "謝謝，" : "Best,",
      isChinese ? "[你的名字]" : "[Your name]",
    ].join("\n");
    return { subject, body };
  }

  const subject = `${isChinese ? "聚焦的下一步：" : "A focused next step: "}${title}`.slice(0, 998);
  const body = [
    isChinese ? "你好，" : "Hi,",
    "",
    isChinese ? `以下是關於「${title}」的簡要更新。` : `I’m sharing a concise update on ${title}.`,
    "",
    isChinese ? "摘要" : "Summary",
    summary,
    "",
    isChinese ? "詳情" : "Details",
    details,
    "",
    isChinese ? "下一步" : "Next step",
    nextAction,
    "",
    isChinese ? "謝謝，" : "Best,",
    isChinese ? "[你的名字]" : "[Your name]",
  ].join("\n");
  return { subject, body };
}

// Keep an email-oriented alias discoverable to callers without duplicating the
// formatting implementation.
export const buildDefaultEmailDraft = buildDefaultActionDraft;
