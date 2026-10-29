import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Role } from "./contract";
import { linearBindings, type LinearBinding } from "./peers";
import type { BoardStore, DiscoveredTicket } from "./store";

export interface DiscoveryResult {
  tickets: number;
  /** Set when Linear could not be read; tickets then come from titles. */
  warning: string | null;
}

/**
 * Tickets are the orchestrator's direct children (the leads); a lead's own
 * children are that ticket's implementers. The ticket key comes from the
 * linear plugin's binding, else from the lead's title.
 */
export async function discoverTickets(
  bb: BbPluginApi,
  store: BoardStore,
  orchestratorThreadId: string,
  ticketPattern: RegExp,
  available: { linear: boolean },
): Promise<DiscoveryResult> {
  const leads = (
    await bb.sdk.threads.list({ parentThreadId: orchestratorThreadId, limit: 200 })
  ).sort((a, b) => a.createdAt - b.createdAt);
  if (leads.length === 0) return { tickets: 0, warning: null };

  let bindings = new Map<string, LinearBinding>();
  let warning: string | null = null;
  if (available.linear) {
    try {
      bindings = await linearBindings(
        bb,
        leads.map((lead) => lead.id),
      );
    } catch (error) {
      warning = `Linear bindings unavailable: ${String(error)}`;
    }
  }

  const projectNames = new Map(
    (await bb.sdk.projects.list()).map((project) => [project.id, project.name]),
  );
  const roles = new Map<string, { boardId: number; ticketKey: string; role: Role }>();
  let count = 0;

  for (const lead of leads) {
    const binding = bindings.get(lead.id);
    const key = binding?.identifier ?? lead.title?.match(ticketPattern)?.[0] ?? null;
    if (key === null) continue;

    const environment = lead.environmentId
      ? await bb.sdk.environments
          .get({ environmentId: lead.environmentId })
          .catch(() => null)
      : null;
    const implementers = await bb.sdk.threads.list({ parentThreadId: lead.id, limit: 50 });

    const found: DiscoveredTicket = {
      key,
      title: binding?.title ?? stripKey(lead.title ?? key, key),
      repo: projectNames.get(lead.projectId) ?? null,
      projectId: lead.projectId,
      linearUrl: binding?.url ?? null,
      linearIssueId: binding?.issueId ?? null,
      linearState: binding?.stateName ?? null,
      leadThreadId: lead.id,
      environmentId: lead.environmentId,
      branch: environment?.branchName ?? null,
      base: environment?.mergeBaseBranch ?? environment?.baseBranch ?? null,
      implementerThreadIds: implementers.map((thread) => thread.id),
    };
    store.upsertDiscovered(found);
    roles.set(lead.id, { boardId: store.boardId, ticketKey: key, role: "lead" });
    for (const id of found.implementerThreadIds) {
      roles.set(id, { boardId: store.boardId, ticketKey: key, role: "implementer" });
    }
    count += 1;
  }

  await writeThreadMetadata(bb, roles);
  return { tickets: count, warning };
}

/** Writes `{boardId, ticketKey, role}` only where it changed, so a sweep is cheap. */
async function writeThreadMetadata(
  bb: BbPluginApi,
  roles: Map<string, { boardId: number; ticketKey: string; role: Role }>,
): Promise<void> {
  const ids = [...roles.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const { threads } = await bb.sdk.threads.experimental_listPluginMetadata({ threadIds: batch });
    const current = new Map(threads.map((row) => [row.threadId, row.metadata]));
    for (const threadId of batch) {
      const want = roles.get(threadId)!;
      const have = current.get(threadId);
      if (have?.boardId === want.boardId && have?.ticketKey === want.ticketKey && have?.role === want.role) continue;
      await bb.sdk.threads.updatePluginMetadata({ threadId, set: { ...want } });
    }
  }
}

function stripKey(title: string, key: string): string {
  const rest = title.replace(key, "").trim();
  return rest === "" ? key : rest;
}
