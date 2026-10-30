import { createTwoFilesPatch } from "diff";
import type { PlanMark, PlanRound } from "./contract";
import { lineLabel } from "./planBlocks";

export const PLAN_EXTENSIONS = [".md", ".markdown", ".mdx", ".txt"] as const;
export const PLAN_MAX_BYTES = 1_000_000;

/** The prefix agents are told to wait for. */
export function planPrefix(round: Pick<PlanRound, "n" | "ticketKey">): string {
  return `[conductor] Plan round ${round.n} for ${round.ticketKey}`;
}

/**
 * Normalises a submitted path and checks it sits under one of the allowed
 * roots. Returns the matching root, or a reason the path is refused.
 */
export function checkPlanPath(
  path: string,
  roots: (string | null | undefined)[],
): { ok: true; path: string; root: string } | { ok: false; reason: string } {
  const clean = normalize(path);
  if (!clean.startsWith("/")) return { ok: false, reason: "Give the plan's absolute path." };
  if (!PLAN_EXTENSIONS.some((ext) => clean.toLowerCase().endsWith(ext))) {
    return { ok: false, reason: `A plan must be a ${PLAN_EXTENSIONS.join(", ")} file.` };
  }
  for (const root of roots) {
    if (!root) continue;
    const base = normalize(root).replace(/\/+$/, "");
    if (clean.startsWith(`${base}/`)) return { ok: true, path: clean, root: base };
  }
  return {
    ok: false,
    reason: "The plan must be in your workspace, this board's plans folder or your thread's storage folder.",
  };
}

/** Resolves `.` and `..` without touching the disk (the file may be on another machine). */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.trim().split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `${path.trim().startsWith("/") ? "/" : ""}${out.join("/")}`;
}

function quoteBlock(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function renderMark(mark: PlanMark, index: number): string {
  const where = lineLabel(mark.startLine, mark.endLine);
  const quote = mark.quote.trim();
  const lines: string[] = [];
  if (mark.kind === "comment") {
    lines.push(`## ${index}. (${where}) Feedback on: "${quote}"`);
    if (mark.comment) lines.push(quoteBlock(mark.comment));
  } else if (mark.kind === "remove") {
    lines.push(`## ${index}. (${where}) Remove: "${quote}"`);
    if (mark.comment) lines.push(quoteBlock(mark.comment));
  } else {
    lines.push(`## ${index}. (${where}) Replace: "${quote}"`, "With:", "```text", (mark.replacement ?? "").trim(), "```");
    if (mark.comment) lines.push(quoteBlock(mark.comment));
  }
  return lines.join("\n");
}

/**
 * The message a decided round sends to the agent, in the shape Plannotator
 * uses for file feedback so agents used to it read it the same way.
 */
export function planFeedbackMessage(round: PlanRound, marks: PlanMark[]): string {
  const approved = round.status === "approved";
  const head = [
    `${planPrefix(round)}: ${approved ? "approved" : "changes requested"}`,
    `Plan: ${round.path} (round ${round.n}, sha ${round.sha256.slice(0, 8)})`,
  ];
  const items = marks.map((mark, i) => renderMark(mark, i + 1));
  if (round.overallComment?.trim()) {
    items.push(`## ${items.length + 1}. General feedback about the plan\n${quoteBlock(round.overallComment)}`);
  }
  const count = `${items.length} piece${items.length === 1 ? "" : "s"} of feedback`;
  const body = approved
    ? items.length > 0
      ? [`Approved, with ${count} as non-blocking notes:`, ...items]
      : []
    : [`I've reviewed this plan and have ${count}:`, ...items];
  const tail = approved
    ? "Start building and report the stage building."
    : "Revise the same file and submit it again with conductor_submit_plan.";
  return [...head, "", ...body.flatMap((part) => [part, ""]), tail].join("\n");
}

/** A one-file unified patch between two revisions of a plan. */
export function planDiff(before: string, after: string, name: string): string {
  return createTwoFilesPatch(`a/${name}`, `b/${name}`, before, after, "", "", { context: 3 });
}
