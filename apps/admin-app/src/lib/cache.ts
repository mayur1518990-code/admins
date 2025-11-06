type CacheEntry<T> = { data: T; timestamp: number };

class ClientLRUCache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxSize = 500; // Prevent memory bloat
  private accessOrder: string[] = [];

  get<T>(key: string): CacheEntry<T> | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      // Move to end (most recently used)
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      this.accessOrder.push(key);
    }
    return entry;
  }

  set<T>(key: string, data: T): void {
    // Remove if already exists
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }

    this.cache.set(key, { data, timestamp: Date.now() });
    this.accessOrder.push(key);

    // Evict oldest if over limit
    if (this.cache.size > this.maxSize) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }
  }

  delete(key: string): void {
    this.cache.delete(key);
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }
}

const memoryCache = new ClientLRUCache();

export function getCached<T>(key: string): CacheEntry<T> | undefined {
  return memoryCache.get(key);
}

export function setCached<T>(key: string, data: T): void {
  memoryCache.set(key, data);
}

export function getCacheKey(parts: Array<string | number | boolean | null | undefined>): string {
  return parts.filter((p) => p !== undefined && p !== null).join(":");
}

export function isFresh(entry: CacheEntry<any> | undefined, ttlMs: number): boolean {
  if (!entry) return false;
  return Date.now() - entry.timestamp < ttlMs;
}

export function deleteCached(key: string): void {
  memoryCache.delete(key);
}

export function clearCache(): void {
  memoryCache.clear();
}


