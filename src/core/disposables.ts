// A stack of teardown callbacks. The composition root registers one per resource it creates, so a
// fallback at any stage of startup releases exactly what exists by then, newest first.

export interface Disposables {
  /** True once disposeAll() has run. Async startup checks this after each await. */
  readonly disposed: boolean;
  /** Registers a teardown. If everything was already disposed it runs immediately, so nothing leaks. */
  add(dispose: () => void): void;
  /** Runs every callback once, newest first. A throwing callback is reported and does not block the rest. */
  disposeAll(): void;
}

export function createDisposables(): Disposables {
  const stack: Array<() => void> = [];
  let disposed = false;

  function run(dispose: () => void): void {
    try {
      dispose();
    } catch (error) {
      console.error('Teardown step failed', error);
    }
  }

  return {
    get disposed() {
      return disposed;
    },
    add(dispose) {
      if (disposed) run(dispose);
      else stack.push(dispose);
    },
    disposeAll() {
      disposed = true;
      for (let dispose = stack.pop(); dispose !== undefined; dispose = stack.pop()) run(dispose);
    },
  };
}
