// Every owner removes its timer/listener, including an already-aborted caller.
export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? Object.assign(new Error("operation_aborted"), { reasonCode: "operation_aborted" });
}

export function abortableDelay(ms, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error); else resolve();
    };
    const aborted = () => finish(signal.reason ?? new Error("operation_aborted"));
    const timer = setTimeout(() => finish(), Math.max(0, ms));
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

export async function withDeadline(work, ms, { signal, reasonCode = "rpc_timeout" } = {}) {
  throwIfAborted(signal);
  const controller = new AbortController();
  let timer;
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => {
      const error = signal.reason ?? Object.assign(new Error("operation_aborted"), { reasonCode: "operation_aborted" });
      controller.abort(error);
      reject(error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      const error = Object.assign(new Error(reasonCode), { reasonCode, retryable: true });
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    // The settlement guard also bounds a transport which ignores abort. Callers
    // fence durable writes with the child signal; late results cannot commit.
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    if (!controller.signal.aborted) controller.abort(Object.assign(new Error("operation_finished"), { reasonCode: "operation_finished" }));
  }
}

export class BoundedSemaphore {
  constructor(limit, maximumWaiting = 32) { this.limit = limit; this.maximumWaiting = maximumWaiting; this.active = 0; this.waiters = []; this.peak = 0; }
  async acquire(signal) {
    throwIfAborted(signal);
    if (this.active < this.limit) return this.grant();
    if (this.waiters.length >= this.maximumWaiting) throw Object.assign(new Error("rpc_budget_queue_full"), { reasonCode: "rpc_budget_queue_full", retryable: true });
    return new Promise((resolve, reject) => {
      const row = { resolve, reject, signal, aborted: undefined };
      row.aborted = () => {
        this.waiters = this.waiters.filter((item) => item !== row);
        signal?.removeEventListener("abort", row.aborted);
        reject(signal.reason ?? new Error("operation_aborted"));
      };
      signal?.addEventListener("abort", row.aborted, { once: true });
      this.waiters.push(row);
    });
  }
  grant() {
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) {
        next.signal?.removeEventListener("abort", next.aborted);
        next.resolve(this.grant());
      }
    };
  }
}
