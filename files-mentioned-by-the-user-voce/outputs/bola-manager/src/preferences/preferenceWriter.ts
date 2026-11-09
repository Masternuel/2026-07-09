interface Pending<T> { value: T; resolve: ((success: boolean) => void)[]; firstAt: number }

/** Serialize writes; coalesce slider changes without delaying the in-memory preference. */
export class PreferenceWriter<T> {
  private pending: Pending<T> | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  constructor(private readonly write: (value: T) => Promise<void>) {}
  enqueue(value: T, delay = 0): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    return new Promise((resolve) => {
      if (this.pending) { this.pending.value = value; this.pending.resolve.push(resolve); }
      else this.pending = { value, resolve: [resolve], firstAt: Date.now() };
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.drain(), Math.min(delay, Math.max(0, 500 - (Date.now() - this.pending.firstAt))));
    });
  }
  private async drain() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running || !this.pending) return;
    const batch = this.pending;
    this.pending = null;
    this.running = (async () => {
      let success = false;
      try { await this.write(batch.value); success = true; } catch { /* Caller handles failed persistence. */ }
      batch.resolve.forEach((resolve) => resolve(success));
    })();
    await this.running;
    this.running = null;
    if (this.pending) void this.drain();
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.pending?.resolve.forEach((resolve) => resolve(false));
    this.pending = null;
  }
}
