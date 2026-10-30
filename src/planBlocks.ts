// Splits a Markdown plan into top-level blocks with their source lines, so a
// selection in the rendered plan maps back to lines of the file. Shared by the
// review page and the tests; no Node or DOM imports.

export interface PlanBlock {
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  source: string;
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
    if (start >= 0) blocks.push({ startLine: start + 1, endLine: end + 1, source: lines.slice(start, end + 1).join("\n") });
    start = -1;
    kind = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
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
