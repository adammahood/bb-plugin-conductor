import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Decision } from "./contract";
import type { Store } from "./store";

/** The prefix agents are told to wait for; keep in step with the tool text. */
export function answerPrefix(decision: Pick<Decision, "ref">): string {
  return `[conductor] ${decision.ref} answered`;
}

export function askedNotice(decision: Decision, userName: string): string {
  const head = `${decision.ref} is with ${userName} on the Conductor board.`;
  return decision.blocking
    ? `${head} It is blocking: end your turn now and do not work around it. The answer arrives as a message that starts "${answerPrefix(decision)}".`
    : `${head} It is not blocking: continue with your recommendation and adjust when a message that starts "${answerPrefix(decision)}" arrives.`;
}

export function deliveryText(decision: Decision, userName: string): string {
  const lines =
    decision.status === "withdrawn"
      ? [`[conductor] ${decision.ref} withdrawn by ${userName}`, `Question: ${decision.question}`]
      : [
          answerPrefix(decision),
          `Question: ${decision.question}`,
          `Answer: ${decision.answer?.choice ?? ""}`,
        ];
  if (decision.answer?.note) lines.push(`Note: ${decision.answer.note}`);
  if (decision.status === "withdrawn") {
    lines.push("Continue without this decision, or ask again with new context.");
  }
  return lines.join("\n");
}

/**
 * Sends the settled decision to the asking thread. A failure is stored on the
 * decision so the board can offer Retry; it never throws.
 */
export async function deliver(
  bb: BbPluginApi,
  store: Store,
  decision: Decision,
  userName: string,
): Promise<Decision> {
  try {
    await bb.sdk.threads.send({
      threadId: decision.threadId,
      mode: "auto",
      originPluginId: bb.pluginId,
      input: [{ type: "text", text: deliveryText(decision, userName), mentions: [] }],
    });
    return store.markDelivery(decision.id, null);
  } catch (error) {
    bb.log.warn(`deliver ${decision.ref} to ${decision.threadId}: ${String(error)}`);
    return store.markDelivery(decision.id, String(error).slice(0, 500));
  }
}
