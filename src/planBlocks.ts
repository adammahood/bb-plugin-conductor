// Splits a Markdown plan into top-level blocks with their source lines, so a
// selection in the rendered plan maps back to lines of the file. Shared by the
// review page and the tests; no Node or DOM imports.

export interface PlanBlock {
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  source: string;
  /** What to render: the source, except YAML front matter, which shows as a code block. */
  display: string;
  frontMatter: boolean;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const LIST_ITEM = /^\s{0,3}([-*+]|\d+[.)])\s+/;
const TABLE_ROW = /^\s*\|/;
const QUOTE = /^\s{0,3}>/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

export function splitPlan(markdown: string): PlanBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: PlanBlock[] = [];
  let start = -1;
  let kind: "fence" | "table" | "quote" | "list" | "text" | null = null;

  const close = (end: number) => {
    if (start >= 0) {
      const source = lines.slice(start, end + 1).join("\n");
      blocks.push({ startLine: start + 1, endLine: end + 1, source, display: source, frontMatter: false });
    }
    start = -1;
    kind = null;
  };

  let first = 0;
  const fmEnd = lines[0]?.trim() === "---" ? lines.findIndex((line, i) => i > 0 && line.trim() === "---") : -1;
  if (fmEnd > 0) {
    blocks.push({
      startLine: 1,
      endLine: fmEnd + 1,
      source: lines.slice(0, fmEnd + 1).join("\n"),
      display: ["```yaml", ...lines.slice(1, fmEnd), "```"].join("\n"),
      frontMatter: true,
    });
    first = fmEnd + 1;
  }

  for (let i = first; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (kind === "fence") {
      if (FENCE.test(line)) close(i);
      continue;
    }
    if (line.trim() === "") {
      close(i - 1);
      continue;
    }
    if (FENCE.test(line)) {
      close(i - 1);
      start = i;
      kind = "fence";
      continue;
    }
    if (HEADING.test(line) || RULE.test(line)) {
      close(i - 1);
      start = i;
      close(i);
      continue;
    }
    const next = LIST_ITEM.test(line) ? "list" : TABLE_ROW.test(line) ? "table" : QUOTE.test(line) ? "quote" : "text";
    // Each list item is its own block; indented lines continue the item above.
    const continues =
      start >= 0 &&
      (next === kind ? next !== "list" : next === "text" && (kind === "list" || kind === "quote") && /^\s/.test(line));
    if (!continues) {
      close(i - 1);
      start = i;
      kind = next;
    }
  }
  close(lines.length - 1);
  return blocks;
}

/** "line 4" or "lines 4–7". */
export function lineLabel(startLine: number, endLine: number): string {
  return startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;
}
