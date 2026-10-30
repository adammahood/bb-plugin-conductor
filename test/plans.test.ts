import { describe, expect, it } from "vitest";
import type { PlanMark, PlanRound } from "../src/contract";
import { lineLabel, splitPlan } from "../src/planBlocks";
import { checkPlanPath, planDiff, planFeedbackMessage } from "../src/plans";

const round = (overrides: Partial<PlanRound> = {}): PlanRound => ({
  id: 3,
  boardId: 1,
  ticketKey: "ABC-101",
  threadId: "thr_lead1",
  n: 2,
  path: "/work/acme/plans/2026-10-30-abc101-avatars.md",
  sha256: "1f3c2a9b77aa",
  source: "submitted",
  status: "changes_requested",
  summary: null,
  overallComment: null,
  marks: 0,
  submittedAt: 1,
  decidedAt: 2,
  deliveredAt: null,
  deliveryError: null,
  ...overrides,
});

const mark = (overrides: Partial<PlanMark>): PlanMark => ({
  id: 1,
  roundId: 3,
  kind: "comment",
  quote: "resize on read",
  startLine: 12,
  endLine: 14,
  comment: null,
  replacement: null,
  createdAt: 1,
  ...overrides,
});

describe("planFeedbackMessage", () => {
  it("lists every mark in Plannotator's file-feedback shape when changes are requested", () => {
    const text = planFeedbackMessage(round({ overallComment: "Split step 3 into model and API PRs." }), [
      mark({ comment: "Use a queue; reads must stay fast." }),
      mark({ id: 2, kind: "remove", quote: "Add a CDN purge job", startLine: 20, endLine: 20, comment: "URLs are versioned." }),
      mark({ id: 3, kind: "replace", quote: "Store at 512px", startLine: 31, endLine: 33, replacement: "Keep the original\nplus 128px and 512px copies" }),
    ]);
    expect(text).toBe(
      [
        "[conductor] Plan round 2 for ABC-101: changes requested",
        "Plan: /work/acme/plans/2026-10-30-abc101-avatars.md (round 2, sha 1f3c2a9b)",
        "",
        "I've reviewed this plan and have 4 pieces of feedback:",
        "",
        '## 1. (lines 12–14) Feedback on: "resize on read"',
        "> Use a queue; reads must stay fast.",
        "",
        '## 2. (line 20) Remove: "Add a CDN purge job"',
        "> URLs are versioned.",
        "",
        '## 3. (lines 31–33) Replace: "Store at 512px"',
        "With:",
        "```text",
        "Keep the original",
        "plus 128px and 512px copies",
        "```",
        "",
        "## 4. General feedback about the plan",
        "> Split step 3 into model and API PRs.",
        "",
        "Revise the same file and submit it again with conductor_submit_plan.",
      ].join("\n"),
    );
  });

  it("approves plainly, or with marks as non-blocking notes", () => {
    expect(planFeedbackMessage(round({ status: "approved" }), [])).toBe(
      [
        "[conductor] Plan round 2 for ABC-101: approved",
        "Plan: /work/acme/plans/2026-10-30-abc101-avatars.md (round 2, sha 1f3c2a9b)",
        "",
        "Start building and report the stage building.",
      ].join("\n"),
    );
    const withNote = planFeedbackMessage(round({ status: "approved" }), [mark({ comment: "Fine, but log the queue depth." })]);
    expect(withNote).toContain("Approved, with 1 piece of feedback as non-blocking notes:");
    expect(withNote).toContain("> Fine, but log the queue depth.");
  });
});

describe("checkPlanPath", () => {
  const roots = ["/work/acme", "/storage/thr_lead1", null];

  it("accepts Markdown and text files under an allowed folder", () => {
    expect(checkPlanPath("/work/acme/plans/./plan.md", roots)).toEqual({ ok: true, path: "/work/acme/plans/plan.md", root: "/work/acme" });
    expect(checkPlanPath("/storage/thr_lead1/plan.txt", roots)).toMatchObject({ ok: true, root: "/storage/thr_lead1" });
  });

  it("refuses other files, other folders and escapes", () => {
    expect(checkPlanPath("/work/acme/secrets.env", roots)).toMatchObject({ ok: false });
    expect(checkPlanPath("/home/me/.ssh/notes.md", roots)).toMatchObject({ ok: false });
    expect(checkPlanPath("/work/acme/../other/plan.md", roots)).toMatchObject({ ok: false });
    expect(checkPlanPath("/work/acme-evil/plan.md", roots)).toMatchObject({ ok: false });
    expect(checkPlanPath("plans/plan.md", roots)).toMatchObject({ ok: false });
  });
});

describe("splitPlan", () => {
  it("keeps headings, paragraphs, list items, code and tables as separate blocks with their lines", () => {
    const plan = [
      "# Avatars", //            1
      "", //                     2
      "Store the original and", // 3
      "resize on read.", //      4
      "", //                     5
      "- Add a column", //       6
      "  with a default", //     7
      "- Add a CDN purge job", // 8
      "", //                     9
      "```ts", //                10
      "const a = 1;", //         11
      "", //                     12
      "```", //                  13
      "| a | b |", //            14
      "|---|---|", //            15
    ].join("\n");
    expect(splitPlan(plan).map((b) => [b.startLine, b.endLine])).toEqual([
      [1, 1],
      [3, 4],
      [6, 7],
      [8, 8],
      [10, 13],
      [14, 15],
    ]);
    expect(lineLabel(8, 8)).toBe("line 8");
    expect(lineLabel(3, 4)).toBe("lines 3–4");
  });
});

describe("splitPlan front matter", () => {
  it("keeps YAML front matter as one block shown as code", () => {
    const blocks = splitPlan(["---", "tags: [plan]", "status: draft", "---", "", "# Title"].join("\n"));
    expect(blocks[0]).toMatchObject({ startLine: 1, endLine: 4, frontMatter: true });
    expect(blocks[0]!.display).toBe("```yaml\ntags: [plan]\nstatus: draft\n```");
    expect(blocks[1]).toMatchObject({ startLine: 6, endLine: 6, frontMatter: false, display: "# Title" });
  });
});

describe("planDiff", () => {
  it("makes a one-file unified patch between two revisions", () => {
    const patch = planDiff("a\nb\nc\n", "a\nB\nc\n", "plan.md");
    expect(patch).toContain("--- a/plan.md");
    expect(patch).toContain("+++ b/plan.md");
    expect(patch).toContain("-b\n+B");
  });
});
