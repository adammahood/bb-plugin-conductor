// Agent threads inside the board's side panel, so the user can follow and talk to
// them without leaving the page. ThreadChat owns the timeline and composer.
import { useEffect } from "react";
import {
  ThreadChat,
  experimental_useAppPanel as useAppPanel,
  useBbNavigate,
  type JsonValue,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { parseRoute, routeBoardId, useBoards } from "./hooks";

export const PANEL_ID = "board";
const context = { kind: "nav-panel", panelId: PANEL_ID } as const;
export const ORCHESTRATOR_TAB = { id: "orchestrator", context, availability: "fixed" } as const;
export const AGENT_TAB = { id: "agent", context, availability: "action" } as const;

/** The orchestrator of the board in view. */
export function OrchestratorTab({ subPath }: PluginNavPanelProps) {
  const boards = useBoards().data?.boards;
  const boardId = routeBoardId(parseRoute(subPath), boards);
  const threadId = boards?.find((b) => b.id === boardId)?.orchestratorThreadId;
  if (!threadId) {
    return <p className="p-4 text-sm text-muted-foreground">Open a board to talk to its orchestrator here.</p>;
  }
  return <ThreadChat threadId={threadId} variant="compact" layout="contained" />;
}

export function AgentTab({ params }: PluginNavPanelProps & { params: JsonValue | null }) {
  const threadId = threadIdFrom(params);
  if (!threadId) return <p className="p-4 text-sm text-muted-foreground">This tab lost its thread.</p>;
  return <ThreadChat threadId={threadId} variant="compact" layout="contained" />;
}

function threadIdFrom(params: JsonValue | null): string | null {
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const value = (params as Record<string, JsonValue>).threadId;
    return typeof value === "string" && value !== "" ? value : null;
  }
  return null;
}

/**
 * Opens a thread as a tab in the board's side panel (one tab per thread).
 * Outside the board there is no such panel, so it falls back to the thread.
 */
export function useOpenAgentThread() {
  const panel = useAppPanel();
  const navigate = useBbNavigate();
  return (threadId: string, title: string) => {
    const opened = panel.experimental_openTab({
      surface: { kind: "current" },
      tab: AGENT_TAB,
      params: { threadId },
      title,
    });
    if (!opened) navigate.toThread(threadId);
  };
}

export function useOpenOrchestratorTab() {
  const panel = useAppPanel();
  return () => panel.experimental_openTab({ surface: { kind: "current" }, tab: ORCHESTRATOR_TAB });
}

let openedThisSession = false;

/** Shows the orchestrator tab the first time the board opens in this app session. */
export function useOrchestratorTabOnFirstVisit(ready: boolean) {
  const open = useOpenOrchestratorTab();
  useEffect(() => {
    if (!ready || openedThisSession) return;
    openedThisSession = open();
  }, [ready, open]);
}
