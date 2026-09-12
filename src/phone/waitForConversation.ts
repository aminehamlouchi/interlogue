/**
 * Bounded wait for a conversation to reach a terminal status.
 *
 * Hosts cap a single MCP tool call (Claude Desktop is reported near four
 * minutes; the SDK default is one minute), so a wait is bounded, emits
 * progress while it runs, and stops the moment the host cancels. The caller
 * turns "not finished in time" into a clear "still in progress, call again".
 */
import { TERMINAL_STATUSES, type ConversationDetails } from "./elevenlabs.js";

export interface WaitOptions {
  getDetails: () => Promise<ConversationDetails>;
  waitMs: number;
  pollMs?: number;
  signal?: AbortSignal;
  /** Called every poll with elapsed and total milliseconds. Errors are swallowed. */
  onProgress?: (elapsedMs: number, totalMs: number, status: string) => void | Promise<void>;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface WaitResult {
  /** The terminal conversation, or null if the wait ran out or was aborted. */
  details: ConversationDetails | null;
  lastStatus: string | null;
  elapsedMs: number;
  aborted: boolean;
  polls: number;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function waitForConversation(opts: WaitOptions): Promise<WaitResult> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? abortableSleep;
  const pollMs = opts.pollMs ?? 3000;
  const start = now();
  const deadline = start + opts.waitMs;
  let lastStatus: string | null = null;
  let polls = 0;
  for (;;) {
    if (opts.signal?.aborted) return { details: null, lastStatus, elapsedMs: now() - start, aborted: true, polls };
    const details = await opts.getDetails();
    polls++;
    lastStatus = details.status;
    if (TERMINAL_STATUSES.has(details.status)) {
      return { details, lastStatus, elapsedMs: now() - start, aborted: false, polls };
    }
    const elapsed = now() - start;
    try {
      await opts.onProgress?.(elapsed, opts.waitMs, details.status);
    } catch {
      // progress is best-effort
    }
    if (now() + pollMs > deadline) {
      return { details: null, lastStatus, elapsedMs: now() - start, aborted: false, polls };
    }
    await sleep(pollMs, opts.signal);
  }
}
