import type { defineRpcContract as SdkDefineRpcContract } from "@get-bb/plugin-sdk";

/**
 * The SDK's helper is an identity function with rich types. The frontend
 * bundle cannot load the bare SDK on a git install (devDependencies are
 * omitted there), so this copy keeps the types and drops the import.
 */
export const defineRpcContract = ((contract: unknown) => contract) as typeof SdkDefineRpcContract;
