// Tracks the GPU resources a scene module creates so its dispose() can release all of them.

/** Anything three.js allocates GPU memory for exposes dispose(). */
export interface Disposable {
  dispose(): void;
}

/** Registers a resource for later disposal and hands it straight back. */
export type Own = <T extends Disposable>(resource: T) => T;

/**
 * Wrapping creation (`const geometry = own(new BufferGeometry())`) keeps allocation and cleanup
 * paired, so a resource cannot be created without also being released.
 */
export function createDisposer(): { own: Own; disposeAll(): void } {
  const resources: Disposable[] = [];
  return {
    own(resource) {
      resources.push(resource);
      return resource;
    },
    disposeAll() {
      for (const resource of resources) resource.dispose();
      resources.length = 0;
    },
  };
}
