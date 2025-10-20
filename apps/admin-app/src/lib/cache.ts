type CacheEntry<T> = { data: T; timestamp: number };

const memoryCache = new Map<string, CacheEntry<any>>();

export function getCached<T>(key: string): CacheEntry<T> | undefined {
  return memoryCache.get(key);
}

export function setCached<T>(key: string, data: T): void {
  memoryCache.set(key, { data, timestamp: Date.now() });
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


