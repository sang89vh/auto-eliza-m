import { runLogger } from './logger.js';

export interface RetryOptions {
  /** Total attempts, i.e. the initial call plus retries. The PRD asks for x2 retries. */
  attempts?: number;
  baseDelayMs?: number;
  label: string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A randomized pause, used to keep browser automation paced like a human. */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

/** Runs `task`, retrying with exponential backoff. Every external call goes through this. */
export async function withRetry<T>(task: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const detail = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        runLogger.warn(`${options.label} failed (attempt ${attempt}/${attempts}): ${detail}. Retrying in ${Math.round(delay / 1000)}s`);
        await sleep(delay);
      } else {
        runLogger.error(`${options.label} failed after ${attempts} attempts: ${detail}`);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
