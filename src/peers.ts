// Reads from other installed plugins over their RPC. Neither contract is
// published, so parse only the fields we use and treat any failure as
// "no data" rather than failing the board.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { LinearIssue, Review, ReviewState } from "./contract";

export interface LinearBinding {
  issueId: string;
  identifier: string;
  title: string;
  stateName: string | null;
  url: string | null;
}

const bindingsSchema = z.object({
  threads: z.record(
    z.string(),
    z.object({
      binding: z
        .object({
          issueId: z.string(),
          identifier: z.string(),
          title: z.string(),
          stateName: z.string().nullable().catch(null),
          url: z.string().nullable().catch(null),
        })
        .nullable()
        .catch(null),
    }),
  ),
});

// The linear plugin caps one call; it leaves out ids past its cap.
const LINEAR_BATCH = 100;

export async function linearBindings(
  bb: BbPluginApi,
  threadIds: string[],
): Promise<Map<string, LinearBinding>> {
  const out = new Map<string, LinearBinding>();
  for (let i = 0; i < threadIds.length; i += LINEAR_BATCH) {
    const batch = threadIds.slice(i, i + LINEAR_BATCH);
    const result = await bb.sdk.plugins.callRpc({
      pluginId: "linear",
      method: "threadIssues",
      input: { threadIds: batch },
      outputSchema: bindingsSchema,
    });
    for (const [threadId, row] of Object.entries(result.threads)) {
      if (row.binding) out.set(threadId, row.binding);
    }
  }
  return out;
}

const relationSchema = z
  .array(z.object({ identifier: z.string(), title: z.string() }))
  .catch([]);

const issueSchema = z.object({
  result: z.object({
    detail: z
      .object({
        identifier: z.string(),
        title: z.string(),
        url: z.string().nullable().catch(null),
        stateName: z.string().nullable().catch(null),
        description: z.string().nullable().catch(null),
        relations: z
          .object({ blocks: relationSchema, related: relationSchema })
          .catch({ blocks: [], related: [] }),
      })
      .nullable()
      .catch(null),
  }),
});

export async function linearIssue(
  bb: BbPluginApi,
  issueId: string,
): Promise<LinearIssue | null> {
  try {
    const { result } = await bb.sdk.plugins.callRpc({
      pluginId: "linear",
      method: "issue",
      input: { id: issueId },
      outputSchema: issueSchema,
    });
    const detail = result.detail;
    if (!detail) return null;
    return {
      identifier: detail.identifier,
      title: detail.title,
      url: detail.url,
      stateName: detail.stateName,
      description: detail.description,
      blocks: detail.relations.blocks.map(({ identifier, title }) => ({ identifier, title })),
      related: detail.relations.related.map(({ identifier, title }) => ({ identifier, title })),
    };
  } catch (error) {
    bb.log.warn(`linear issue ${issueId}: ${String(error)}`);
    return null;
  }
}

const sentSchema = z.object({ at: z.number() }).passthrough().nullable().optional().catch(null);

const reviewSchema = z.object({
  targetKey: z.string(),
  kind: z.string().nullable().optional().catch(null),
  gitRef: z.string().nullable().catch(null),
  sourceThreadId: z.string().nullable().catch(null),
  sourceThreadAt: z.number().nullable().optional().catch(null),
  userArchivedAt: z.number().nullable().catch(null),
  turnGroup: z.string().nullable().optional().catch(null),
  approvalSent: sentSchema,
  sent: sentSchema,
  createdAt: z.number().nullable().catch(null),
  turn: z.object({ label: z.string().nullable().catch(null) }).nullable().catch(null),
});

/**
 * Where a round stands for the user. A local round (`bb review <ref>`) always
 * reads "Ready" in Code Review Workspace, so what he sent back to the agent
 * after the round opened decides it; a PR round follows its turn group.
 */
export function reviewState(review: z.infer<typeof reviewSchema>): ReviewState {
  if (review.userArchivedAt != null || review.turnGroup === "archive") return "archived";
  const opened = review.sourceThreadAt ?? review.createdAt ?? 0;
  const approvedAt = review.approvalSent?.at ?? null;
  const commentedAt = review.sent?.at ?? null;
  if (approvedAt !== null && approvedAt >= opened && approvedAt >= (commentedAt ?? 0)) return "approved";
  if (commentedAt !== null && commentedAt >= opened) return "with-agent";
  if (review.kind !== "ref" && review.turnGroup) {
    if (review.turnGroup === "reviewed") return "approved";
    if (review.turnGroup === "waiting") return "with-agent";
  }
  return "needs-review";
}

// Rows are parsed one by one so one odd review cannot hide the rest.
const reviewsSchema = z.object({ reviews: z.array(z.unknown()) });

const resolvedSchema = z.object({
  issues: z.array(
    z.object({
      id: z.string().catch(""),
      identifier: z.string(),
      title: z.string(),
      stateName: z.string().nullable().catch(null),
      url: z.string().nullable().optional().catch(null),
    }),
  ),
});

/** Looks up ticket keys the thread's Linear team can see; unknown keys are left out. */
export async function linearResolve(
  bb: BbPluginApi,
  identifiers: string[],
  threadId: string,
): Promise<Map<string, LinearBinding>> {
  const out = new Map<string, LinearBinding>();
  if (identifiers.length === 0) return out;
  try {
    const { issues } = await bb.sdk.plugins.callRpc({
      pluginId: "linear",
      method: "resolveIdentifiers",
      input: { identifiers, threadId },
      outputSchema: resolvedSchema,
    });
    for (const issue of issues) {
      out.set(issue.identifier, {
        issueId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        stateName: issue.stateName,
        url: issue.url ?? null,
      });
    }
  } catch (error) {
    bb.log.warn(`linear resolveIdentifiers: ${String(error)}`);
  }
  return out;
}

/** Code Review Workspace reviews opened from any of these threads. */
export async function reviewsForThreads(
  bb: BbPluginApi,
  threadIds: string[],
): Promise<Review[]> {
  if (threadIds.length === 0) return [];
  try {
    const { reviews } = await bb.sdk.plugins.callRpc({
      pluginId: "code-review-workspace",
      method: "listReviews",
      input: null,
      outputSchema: reviewsSchema,
    });
    const wanted = new Set(threadIds);
    return reviews
      .flatMap((raw) => {
        const parsed = reviewSchema.safeParse(raw);
        return parsed.success ? [parsed.data] : [];
      })
      .filter((review) => review.sourceThreadId && wanted.has(review.sourceThreadId))
      .map((review) => ({
        targetKey: review.targetKey,
        gitRef: review.gitRef,
        label: review.turn?.label ?? null,
        state: reviewState(review),
        threadId: review.sourceThreadId!,
        createdAt: review.createdAt,
        sentAt: Math.max(review.sent?.at ?? 0, review.approvalSent?.at ?? 0) || null,
      }))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  } catch (error) {
    bb.log.warn(`code-review-workspace listReviews: ${String(error)}`);
    return [];
  }
}
