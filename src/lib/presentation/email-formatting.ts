/**
 * The deliberately small formatting language used by Gmail action bodies.
 *
 * This module is the single presentation boundary for action bodies. The
 * source string is still persisted (and hashed) exactly as entered; parsing
 * here is only for preview and for the two safe MIME alternatives.
 */

export type EmailInlineNode =
  | { type: "text"; text: string }
  | { type: "bold" | "italic" | "highlight"; children: EmailInlineNode[] };

export type EmailBlock =
  | { type: "paragraph"; lines: EmailInlineNode[][] }
  | { type: "unordered-list"; items: EmailInlineNode[][] }
  | { type: "ordered-list"; items: Array<{ marker: number; children: EmailInlineNode[] }> };

export type EmailBodyAst = EmailBlock[];

type Delimiter = "**" | "_" | "==";
type DelimiterToken = { start: number; end: number; marker: Delimiter };

const ESCAPABLE = new Set(["\\", "*", "_", "=", "-", "."]);

function isWordCharacter(value: string | undefined): boolean {
  return value ? /[\p{L}\p{N}]/u.test(value) : false;
}

function delimiterAt(value: string, index: number): Delimiter | undefined {
  if (value.startsWith("**", index)) return "**";
  if (value.startsWith("==", index)) return "==";
  if (value[index] === "_") {
    // Do not interpret the underscore in snake_case as emphasis. A marker
    // must touch whitespace/punctuation on at least one side.
    const previous = value[index - 1];
    const next = value[index + 1];
    if (!isWordCharacter(previous) || !isWordCharacter(next)) return "_";
  }
  return undefined;
}

function tokenizeDelimiters(value: string): DelimiterToken[] {
  const tokens: DelimiterToken[] = [];
  let slashCount = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\") {
      slashCount += 1;
      continue;
    }
    const escaped = slashCount % 2 === 1;
    slashCount = 0;
    if (escaped) continue;
    const marker = delimiterAt(value, index);
    if (!marker) continue;
    tokens.push({ start: index, end: index + marker.length, marker });
    index += marker.length - 1;
  }
  return tokens;
}

function unescape(value: string): string {
  return value.replace(/\\(.)/gs, (full, character: string) => ESCAPABLE.has(character) ? character : full);
}

function parseInline(value: string): EmailInlineNode[] {
  const tokens = tokenizeDelimiters(value);
  if (!tokens.length) return value ? [{ type: "text", text: unescape(value) }] : [];
  // Keep hostile input bounded. The editor caps bodies at 100,000 characters;
  // a line containing thousands of delimiters is not meaningful formatting and
  // is returned as literal text rather than creating deep or quadratic work.
  if (tokens.length > 4_096) return value ? [{ type: "text", text: unescape(value) }] : [];

  // A stack makes crossed delimiters fail closed. For example, the `_` in
  // `**bold _italic** text_` cannot close the outer `**`, so no marker on the
  // line is interpreted as HTML/formatting.
  const stack: number[] = [];
  const pairs = new Map<number, number>();
  let maxDepth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const open = stack[stack.length - 1];
    if (open !== undefined && tokens[open].marker === token.marker) {
      stack.pop();
      pairs.set(open, index);
      pairs.set(index, open);
    } else {
      stack.push(index);
      maxDepth = Math.max(maxDepth, stack.length);
    }
  }
  if (stack.length || maxDepth > 64) return value ? [{ type: "text", text: unescape(value) }] : [];

  const markerType: Record<Delimiter, "bold" | "italic" | "highlight"> = {
    "**": "bold",
    "_": "italic",
    "==": "highlight",
  };

  function parseRange(start: number, end: number, fromToken = 0): EmailInlineNode[] {
    const nodes: EmailInlineNode[] = [];
    let cursor = start;
    let tokenIndex = fromToken;
    while (tokenIndex < tokens.length && tokens[tokenIndex].start < start) tokenIndex += 1;
    while (tokenIndex >= 0 && tokenIndex < tokens.length && tokens[tokenIndex].start < end) {
      const token = tokens[tokenIndex];
      const pairIndex = pairs.get(tokenIndex);
      if (pairIndex === undefined || pairIndex <= tokenIndex || tokens[pairIndex].start >= end) {
        // This should only be reachable for an invalid pairing, but retaining
        // text is safer than ever allowing a malformed marker into HTML.
        tokenIndex += 1;
        continue;
      }
      if (token.start > cursor) nodes.push({ type: "text", text: unescape(value.slice(cursor, token.start)) });
      nodes.push({ type: markerType[token.marker], children: parseRange(token.end, tokens[pairIndex].start, tokenIndex + 1) });
      cursor = tokens[pairIndex].end;
      tokenIndex = pairIndex + 1;
    }
    if (cursor < end) nodes.push({ type: "text", text: unescape(value.slice(cursor, end)) });
    return nodes.filter((node) => node.type !== "text" || node.text.length > 0);
  }

  return parseRange(0, value.length);
}

function parseLine(value: string): EmailInlineNode[] {
  return parseInline(value);
}

function flushParagraph(blocks: EmailBodyAst, lines: string[]): void {
  if (lines.length) blocks.push({ type: "paragraph", lines: lines.map(parseLine) });
  lines.length = 0;
}

function flushList(blocks: EmailBodyAst, kind: "unordered-list" | "ordered-list", items: Array<{ marker: number; text: string }>): void {
  if (!items.length) return;
  if (kind === "unordered-list") blocks.push({ type: kind, items: items.map((item) => parseLine(item.text)) });
  else blocks.push({ type: kind, items: items.map((item) => ({ marker: item.marker, children: parseLine(item.text) })) });
  items.length = 0;
}

/** Parse the constrained Gmail body language into a safe, renderable AST. */
export function parseEmailBody(value: string): EmailBodyAst {
  const blocks: EmailBodyAst = [];
  const paragraphLines: string[] = [];
  let listKind: "unordered-list" | "ordered-list" | undefined;
  const listItems: Array<{ marker: number; text: string }> = [];
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n");

  const flushAnyList = () => {
    if (listKind) flushList(blocks, listKind, listItems);
    listKind = undefined;
  };

  for (const line of normalized.split("\n")) {
    const unordered = line.match(/^\s*-\s+(.*)$/);
    const ordered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (unordered || ordered) {
      flushParagraph(blocks, paragraphLines);
      const nextKind = unordered ? "unordered-list" : "ordered-list";
      if (listKind && listKind !== nextKind) flushAnyList();
      listKind = nextKind;
      listItems.push({ marker: ordered ? Number(ordered[1]) : 0, text: unordered?.[1] ?? ordered?.[2] ?? "" });
      continue;
    }
    if (!line.trim()) {
      flushParagraph(blocks, paragraphLines);
      flushAnyList();
      continue;
    }
    flushAnyList();
    paragraphLines.push(line);
  }
  flushParagraph(blocks, paragraphLines);
  flushAnyList();
  return blocks;
}

function inlineText(nodes: EmailInlineNode[]): string {
  return nodes.map((node) => node.type === "text" ? node.text : inlineText(node.children)).join("");
}

/** Convert the AST to meaningful plain text while retaining list markers. */
export function emailBodyToPlainText(astOrValue: EmailBodyAst | string): string {
  const ast = typeof astOrValue === "string" ? parseEmailBody(astOrValue) : astOrValue;
  return ast.map((block) => {
    if (block.type === "paragraph") return block.lines.map(inlineText).join("\n");
    if (block.type === "unordered-list") return block.items.map((item) => `- ${inlineText(item)}`).join("\n");
    return block.items.map((item) => `${item.marker}. ${inlineText(item.children)}`).join("\n");
  }).join("\n\n");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function inlineHtml(nodes: EmailInlineNode[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return escapeHtml(node.text);
    const tag = node.type === "bold" ? "strong" : node.type === "italic" ? "em" : "mark";
    return `<${tag}>${inlineHtml(node.children)}</${tag}>`;
  }).join("");
}

/** Convert the AST to escaped HTML. No user-provided HTML is ever interpreted. */
export function emailBodyToHtml(astOrValue: EmailBodyAst | string): string {
  const ast = typeof astOrValue === "string" ? parseEmailBody(astOrValue) : astOrValue;
  return ast.map((block) => {
    if (block.type === "paragraph") return `<p>${block.lines.map(inlineHtml).join("<br />")}</p>`;
    if (block.type === "unordered-list") return `<ul>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join("")}</ul>`;
    return `<ol>${block.items.map((item) => `<li value="${Number.isSafeInteger(item.marker) && item.marker > 0 ? item.marker : 1}">${inlineHtml(item.children)}</li>`).join("")}</ol>`;
  }).join("");
}

export function formatEmailBody(value: string): { ast: EmailBodyAst; plainText: string; html: string } {
  const ast = parseEmailBody(value);
  return { ast, plainText: emailBodyToPlainText(ast), html: emailBodyToHtml(ast) };
}

// Explicit aliases keep the presentation contract discoverable to callers and
// make the pure renderers convenient to use in tests and adapters.
export const renderEmailBodyHtml = emailBodyToHtml;
export const renderEmailBodyPlainText = emailBodyToPlainText;
