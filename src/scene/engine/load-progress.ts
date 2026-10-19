// Real load progress for the preloader. It never claims more than the slowest of its sources:
// module initialisation (geometry generation, texture decode) and the shared LoadingManager (every
// file a module requests). Shader compilation is the final slice. The reported value only ever
// increases, because the manager's total grows as modules discover more files to load.
import type * as THREE from 'three';
import { clamp01 } from './curves';

/** Share of the bar given to shader compilation, the last step before the first frame. */
const COMPILE_WEIGHT = 0.1;

const noop = () => {};

export interface LoadTracker {
  moduleReady(): void;
  compiled(): void;
  /** Stops listening to the manager. Safe to call more than once. */
  dispose(): void;
}

export function trackLoadProgress(manager: THREE.LoadingManager, moduleCount: number, report: (progress: number) => void): LoadTracker {
  let modulesReady = 0;
  let filesFraction = 1;
  let compiledDone = false;
  let reported = 0;

  const emit = () => {
    const loading = Math.min(modulesReady / moduleCount, filesFraction);
    const value = compiledDone ? 1 : (1 - COMPILE_WEIGHT) * clamp01(loading);
    if (value > reported) {
      reported = value;
      report(value);
    }
  };

  manager.onStart = (_url, loaded, total) => {
    filesFraction = total > 0 ? loaded / total : 1;
    emit();
  };
  manager.onProgress = (_url, loaded, total) => {
    filesFraction = total > 0 ? loaded / total : 1;
    emit();
  };
  manager.onLoad = () => {
    filesFraction = 1;
    emit();
  };

  return {
    moduleReady() {
      modulesReady++;
      emit();
    },
    compiled() {
      compiledDone = true;
      emit();
    },
    dispose() {
      manager.onStart = noop;
      manager.onProgress = noop;
      manager.onLoad = noop;
    },
  };
}
