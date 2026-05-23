export class SerialRateLimiter {
  private nextRunAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly intervalMs: number) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const waitMs = Math.max(0, this.nextRunAt - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      this.nextRunAt = Date.now() + this.intervalMs;
      return withTelegramRetry(task);
    });

    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export async function withTelegramRetry<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      const retryAfter = telegramRetryAfterSeconds(error);
      if (retryAfter) {
        if (attempt >= 3) throw error;
        await sleep((retryAfter + 1) * 1000);
        continue;
      }

      if (!isTransientNetworkError(error) || attempt >= 5) throw error;
      await sleep(Math.min(30_000, 1000 * 2 ** attempt));
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function telegramRetryAfterSeconds(error: unknown): number | null {
  const maybe = error as { error_code?: number; parameters?: { retry_after?: number } };
  if (maybe.error_code === 429 && typeof maybe.parameters?.retry_after === "number") {
    return maybe.parameters.retry_after;
  }
  return null;
}

function isTransientNetworkError(error: unknown): boolean {
  const maybe = error as { error?: { code?: string }; code?: string };
  const code = maybe.error?.code ?? maybe.code;
  return code === "ETIMEDOUT" || code === "ECONNRESET" || code === "EAI_AGAIN" || code === "ENOTFOUND";
}
