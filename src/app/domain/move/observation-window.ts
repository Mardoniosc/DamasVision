/**
 * Bounded observation window (E5-T01): at most `maxSize` items, none older than
 * `maxAgeMs` relative to the newest. Items arriving with a timestamp older than the newest
 * one are stale (a late frame) and are dropped, never reordered.
 */
export class ObservationWindow<T extends { readonly timestamp: number }> {
  private items: T[] = [];
  private staleCount = 0;

  constructor(
    private readonly maxSize: number,
    private readonly maxAgeMs: number,
  ) {
    if (!(Number.isInteger(maxSize) && maxSize >= 1) || !(maxAgeMs > 0)) {
      throw new RangeError('expected maxSize ≥ 1 and maxAgeMs > 0');
    }
  }

  /** Adds an item; returns false (and keeps the window) when it is stale. */
  push(item: T): boolean {
    const newest = this.items[this.items.length - 1];
    if (newest && item.timestamp < newest.timestamp) {
      this.staleCount++;
      return false;
    }
    this.items.push(item);
    this.items = this.items
      .filter((entry) => item.timestamp - entry.timestamp <= this.maxAgeMs)
      .slice(-this.maxSize);
    return true;
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }

  /** Stale items dropped since creation. */
  get dropped(): number {
    return this.staleCount;
  }

  /** Oldest first. */
  toArray(): readonly T[] {
    return [...this.items];
  }
}
