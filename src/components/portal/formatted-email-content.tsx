import type { ReactNode } from "react";
import { parseEmailBody, type EmailBlock, type EmailInlineNode } from "@/src/lib/presentation/email-formatting";

function InlineContent({ nodes }: { nodes: EmailInlineNode[] }): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    if (node.type === "text") return <span key={key}>{node.text}</span>;
    if (node.type === "bold") return <strong key={key}><InlineContent nodes={node.children} /></strong>;
    if (node.type === "italic") return <em key={key}><InlineContent nodes={node.children} /></em>;
    return <mark key={key}><InlineContent nodes={node.children} /></mark>;
  });
}

function EmailBlockContent({ block, index }: { block: EmailBlock; index: number }): ReactNode {
  if (block.type === "paragraph") {
    return <p key={`paragraph-${index}`}>{block.lines.map((line, lineIndex) => <span key={`line-${lineIndex}`}>{lineIndex ? <br /> : null}<InlineContent nodes={line} /></span>)}</p>;
  }
  if (block.type === "unordered-list") {
    return <ul key={`unordered-${index}`}>{block.items.map((item, itemIndex) => <li key={`item-${itemIndex}`}><InlineContent nodes={item} /></li>)}</ul>;
  }
  return <ol key={`ordered-${index}`}>{block.items.map((item, itemIndex) => <li key={`item-${itemIndex}`} value={item.marker}><InlineContent nodes={item.children} /></li>)}</ol>;
}

/** Safe React preview for a persisted Gmail action body. */
export function FormattedEmailContent({ content }: { content: string }) {
  return <div className="formatted-email-content">{parseEmailBody(content).map((block, index) => <EmailBlockContent block={block} index={index} key={`${block.type}-${index}`} />)}</div>;
}
