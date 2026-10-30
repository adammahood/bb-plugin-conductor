// The row-status setter exists only in a content script's mount context,
// which has no React or RPC. The content script stores it here; an app
// overlay reads open decisions and drives it.
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PluginContentScriptContext, PluginComposerThreadRowStatus } from "@get-bb/plugin-sdk/app";
import { useOpenDecisions, usePlansWaiting } from "./hooks";

type Setter = (threadId: string, status: PluginComposerThreadRowStatus | null) => void;

let setter: Setter | null = null;
const listeners = new Set<() => void>();

function publish(next: Setter | null) {
  setter = next;
  for (const listener of listeners) listener();
}

export function mountRowStatus({ experimental_setThreadRowStatus }: PluginContentScriptContext) {
  publish(experimental_setThreadRowStatus ?? null);
  return () => publish(null);
}

function useSetter(): Setter | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => setter,
  );
}

/** Puts a question mark on every thread row with an open decision. */
export function RowStatusOverlay() {
  const set = useSetter();
  const { data } = useOpenDecisions();
  const plans = usePlansWaiting().data?.rounds;
  const shown = useRef(new Set<string>());

  useEffect(() => {
    if (!set || !data) return;
    const blocking = new Map<string, boolean>();
    for (const d of data.decisions) blocking.set(d.threadId, (blocking.get(d.threadId) ?? false) || d.blocking);
    // A plan round waiting on the user always blocks the agent that sent it.
    for (const round of plans ?? []) blocking.set(round.threadId, true);
    for (const id of shown.current) if (!blocking.has(id)) set(id, null);
    for (const [id, isBlocking] of blocking) {
      set(id, {
        icon: "CircleQuestion",
        label: isBlocking ? "Waiting on you" : "Decision waiting for you",
        tone: isBlocking ? "error" : "default",
      });
    }
    shown.current = new Set(blocking.keys());
  }, [set, data, plans]);

  return null;
}
