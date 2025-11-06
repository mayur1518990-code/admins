/**
 * Request Deduplication Utility
 * Prevents duplicate simultaneous API calls by sharing pending promises
 */

type PendingRequest<T> = {
  promise: Promise<T>;
  timestamp: number;
};

class RequestDeduplicator {
  private pending = new Map<string, PendingRequest<any>>();
  private readonly timeout = 30000; // 30 seconds

  async deduplicate<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Check if there's already a pending request
    const existing = this.pending.get(key);
    
    if (existing) {
      // Check if it's still valid (not too old)
      if (Date.now() - existing.timestamp < this.timeout) {
        // Return the existing promise
        return existing.promise;
      } else {
        // Too old, remove it
        this.pending.delete(key);
      }
    }

    // Create new request
    const promise = fn()
      .then((result) => {
        // Clean up on success
        this.pending.delete(key);
        return result;
      })
      .catch((error) => {
        // Clean up on error
        this.pending.delete(key);
        throw error;
      });

    // Store the pending request
    this.pending.set(key, {
      promise,
      timestamp: Date.now()
    });

    return promise;
  }

  clear(key?: string): void {
    if (key) {
      this.pending.delete(key);
    } else {
      this.pending.clear();
    }
  }

  clearExpired(): void {
    const now = Date.now();
    for (const [key, request] of this.pending.entries()) {
      if (now - request.timestamp > this.timeout) {
        this.pending.delete(key);
      }
    }
  }
}

export const requestDeduplicator = new RequestDeduplicator();

