import { Fragment } from "react";
import { localizeReadableHeading, parseReadableContent, type ReadableBlock } from "@/src/lib/presentation/human-readable";
import type { Locale } from "@/src/lib/i18n/locale";

function headingTag(level: number): "h2" | "h3" | "h4" | "h5" | "h6" {
  if (level <= 1) return "h2";
  if (level === 2) return "h3";
  if (level === 3) return "h4";
  if (level === 4) return "h5";
  return "h6";
}

function renderBlock(block: ReadableBlock, index: number, locale: Locale) {
  if (block.kind === "heading") {
    const Heading = headingTag(block.level);
    return <Heading key={`heading-${index}`}>{localizeReadableHeading(block.text, locale)}</Heading>;
  }
  if (block.kind === "paragraph") {
    return (
      <p key={`paragraph-${index}`}>
        {block.lines.map((line, lineIndex) => (
          <Fragment key={`line-${lineIndex}`}>
            {line}
            {lineIndex < block.lines.length - 1 ? <br /> : null}
          </Fragment>
        ))}
      </p>
    );
  }
  const List = block.kind === "unordered-list" ? "ul" : "ol";
  return (
    <List key={`${block.kind}-${index}`}>
      {block.items.map((item, itemIndex) => <li key={`${itemIndex}-${item}`}>{item}</li>)}
    </List>
  );
}

export function HumanReadableContent({ content, className = "", locale = "en" }: { content: string; className?: string; locale?: Locale }) {
  const blocks = parseReadableContent(content);
  return <div className={`human-readable-content ${className}`.trim()}>{blocks.map((block, index) => renderBlock(block, index, locale))}</div>;
}
