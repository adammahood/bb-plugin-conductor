import { useRpc, type PluginThreadAction, type PluginThreadActionItemInput } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../src/contract";
import { useLiveOrchestrators, PANEL_PATH } from "./hooks";

interface ActionData {
  boards: Record<string, number>;
  create(threadId: string): Promise<{ id: number }>;
}

/** Runs once for the whole app: which threads already run a board, and how to start one. */
export function useBoardActionData(): ActionData {
  const rpc = useRpc<typeof rpcContract>();
  const boards = useLiveOrchestrators();
  return { boards, create: (threadId) => rpc.call("boards.create", { threadId }) };
}

/** "Use as a Conductor board" on top-level threads; "Open its Conductor board" on orchestrators. */
export function boardActionItem({ thread, data, navigate }: PluginThreadActionItemInput<ActionData>): PluginThreadAction | null {
  const boardId = data.boards[thread.id];
  const open = (id: number) => navigate.toPluginPanel(PANEL_PATH, { subPath: String(id) });
  if (boardId !== undefined) {
    return { label: "Open its Conductor board", icon: "Layers", run: () => open(boardId) };
  }
  if (thread.parentThreadId) return null;
  return {
    label: "Use as a Conductor board",
    icon: "Layers",
    run: async () => open((await data.create(thread.id)).id),
  };
}
