/** Anything holding native (WASM) memory, e.g. an OpenCV `Mat`. */
export interface Deletable {
  delete(): void;
  isDeleted?(): boolean;
}

/**
 * Tracks native resources and releases all of them, in reverse order, exactly once.
 * OpenCV.js `Mat`s are not garbage collected; every allocation must be deleted (spec §7).
 */
export class ResourceScope {
  private readonly resources: Deletable[] = [];
  private disposed = false;

  track<T extends Deletable>(resource: T): T {
    if (this.disposed) {
      resource.delete();
      throw new Error('ResourceScope already disposed');
    }
    this.resources.push(resource);
    return resource;
  }

  get size(): number {
    return this.resources.length;
  }

  /** Deletes everything; returns the errors raised by individual deletes. */
  dispose(): unknown[] {
    if (this.disposed) {
      return [];
    }
    this.disposed = true;
    const errors: unknown[] = [];
    for (const resource of this.resources.reverse()) {
      try {
        if (!resource.isDeleted?.()) {
          resource.delete();
        }
      } catch (error) {
        errors.push(error);
      }
    }
    this.resources.length = 0;
    return errors;
  }
}

/**
 * Runs `work` with a scope whose resources are always released. An error from `work`
 * takes precedence; release errors are reported only when `work` succeeded.
 */
export function withResources<T>(work: (scope: ResourceScope) => T): T {
  const scope = new ResourceScope();
  let result: T;
  try {
    result = work(scope);
  } catch (error) {
    scope.dispose();
    throw error;
  }
  const releaseErrors = scope.dispose();
  if (releaseErrors.length > 0) {
    throw new AggregateError(releaseErrors, 'Failed to release OpenCV resources');
  }
  return result;
}
