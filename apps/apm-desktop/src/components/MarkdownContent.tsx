import type { ReactNode } from "react";

export function MarkdownContent({ content, className = "" }: { content: string; className?: string }) {
  const blocks = parseMarkdownBlocks(content);
  return (
    <div className={`markdown-content ${className}`}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = `h${Math.min(block.level, 3)}` as "h1" | "h2" | "h3";
          return <Tag key={index}>{renderInlineMarkdown(block.text)}</Tag>;
        }
        if (block.type === "code") {
          return <pre key={index}><code>{block.text}</code></pre>;
        }
        if (block.type === "list") {
          return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</ul>;
        }
        if (block.type === "table") {
          return <MarkdownTable key={index} rows={block.rows} />;
        }
        return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; rows: string[][] };

function parseMarkdownBlocks(input: string): MarkdownBlock[] {
  const lines = input.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ type: "code", text: code.join("\n") });
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (line.trim().startsWith("|") && line.includes("|")) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        const raw = lines[i] ?? "";
        if (!/^\s*\|?\s*:?-{3,}/.test(raw)) {
          rows.push(raw.split("|").map((cell) => cell.trim()).filter(Boolean));
        }
        i += 1;
      }
      blocks.push({ type: "table", rows });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    const paragraph: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(#{1,6})\s+/.test(lines[i] ?? "")) {
      if ((lines[i] ?? "").trim().startsWith("```") || /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        break;
      }
      paragraph.push((lines[i] ?? "").trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

function MarkdownTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) {
    return null;
  }
  const [head, ...body] = rows;
  return (
    <table>
      <thead>
        <tr>{head.map((cell, index) => <th key={index}>{renderInlineMarkdown(cell)}</th>)}</tr>
      </thead>
      <tbody>
        {body.map((row, rowIndex) => (
          <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInlineMarkdown(cell)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      nodes.push(
        link ? (
          <a key={key} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>
        ) : token,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}
