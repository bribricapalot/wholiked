/**
 * Token-bucket + concurrency limiter. One instance per upstream host so a large
 * lobby importing at once can't burst past TikTok's rate limits.
 */
export class Throttle {
  private tokens: number;
  private last = Date.now();
  private active = 0;
  private queue: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private ratePerSec: number,
    private concurrency: number,
    private burst = ratePerSec,
  ) {
    this.tokens = burst;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.pump();
          });
      });
      this.pump();
    });
  }

  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSec);
    this.last = now;
  }

  private pump() {
    this.refill();
    while (this.queue.length && this.active < this.concurrency && this.tokens >= 1) {
      this.tokens -= 1;
      this.queue.shift()!();
    }
    if (this.queue.length && this.active < this.concurrency && !this.timer) {
      const wait = Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, wait);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch through a throttle, retrying 429/5xx with Retry-After or exponential backoff. */
export async function throttledFetch(
  throttle: Throttle,
  url: string,
  init: RequestInit = {},
  retries = 3,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await throttle.run(() =>
      fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(10_000) }),
    );
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt + Math.random() * 250);
  }
}

/** TikTok Open API (open.tiktokapis.com) and the public oEmbed endpoint are limited separately. */
export const tiktokApiThrottle = new Throttle(5, 4);
export const oembedThrottle = new Throttle(8, 4);
