import type { ToolSet } from "ai";
import { boundMcpResult } from "./result-bounds.ts";

// A tool offered to a session, in the registry's namespaced ToolSet.
type RegistryTool = ToolSet[string];

const MAX_TEXT_BYTES = 128 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Leave room below the stream replay ceiling for the tool's frame and other step events.
const MAX_RESULT_BYTES = 15 * 1024 * 1024;

// Time budget for a single tool call. A tool that walks an enormous tree (or
// hangs) would otherwise wedge the turn indefinitely; past the budget local
// waiting ends and the SDK is signalled to abort. The external outcome is unknown.
const TIMEOUT_MS = 180_000;

/** Tunable bounds, defaulting to the module constants. Tests pass tiny values. */
export interface BoundToolOptions {
  /** Aggregate encoded data budget, excluding image base64 and generated omission notices. */
  maxBytes?: number;
  /** Decoded bytes per protocol-typed image. */
  maxImageBytes?: number;
  /** Encoded JSON budget including media, metadata, and generated notices. */
  maxResultBytes?: number;
  timeoutMs?: number;
}

/**
 * Bound MCP output by independent text, image, and complete encoded-result budgets,
 * preserving unique content and marking omissions. Timeout/cancellation settles
 * locally and signals the SDK to abort, without confirming the external action stopped.
 */
export function boundMcpTool(toolDef: RegistryTool, options: BoundToolOptions = {}): RegistryTool {
  const original = toolDef.execute;
  if (!original) return toolDef;
  const {
    maxBytes = MAX_TEXT_BYTES,
    maxImageBytes = MAX_IMAGE_BYTES,
    maxResultBytes = MAX_RESULT_BYTES,
    timeoutMs = TIMEOUT_MS,
  } = options;

  const execute = async (...args: Parameters<NonNullable<RegistryTool["execute"]>>) => {
    const [input, opts] = args;
    opts.abortSignal?.throwIfAborted();
    const controller = new AbortController();
    const cancelled = Promise.withResolvers<never>();
    const onAbort = () => cancelled.reject(controller.signal.reason);
    const onCancel = () => controller.abort(opts.abortSignal?.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    opts.abortSignal?.addEventListener("abort", onCancel, { once: true });
    const timer = setTimeout(() => {
      controller.abort(
        new Error(
          `Tool call exceeded the ${Math.round(timeoutMs / 1000)}s time budget. Its external outcome is unknown; verify before retrying.`,
        ),
      );
    }, timeoutMs);

    try {
      // Local settlement must not depend on the SDK or server observing abort.
      // The race also handles late rejection without reviving the settled call.
      const output = await Promise.race([
        cancelled.promise,
        Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return original(input, { ...opts, abortSignal: controller.signal });
        }),
      ]);
      return boundMcpResult(output, { maxBytes, maxImageBytes, maxResultBytes });
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      opts.abortSignal?.removeEventListener("abort", onCancel);
    }
  };

  return { ...toolDef, execute } as RegistryTool;
}
