type CacheEntry<T> = { data: T; expiresAt: number };

class SimpleLRUCache {
  private store = new Map<string, CacheEntry<any>>();
  private order: string[] = [];
  constructor(private maxEntries: number = 200) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return undefined;
    }
    // touch
    this.order = this.order.filter(k => k !== key);
    this.order.push(key);
    return entry.data as T;
    }

  set<T>(key: string, value: T, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs;
    this.store.set(key, { data: value, expiresAt });
    this.order = this.order.filter(k => k !== key);
    this.order.push(key);
    // evict
    while (this.order.length > this.maxEntries) {
      const oldest = this.order.shift();
      if (oldest) this.store.delete(oldest);
    }
  }

  delete(key: string): void {
    this.store.delete(key);
    this.order = this.order.filter(k => k !== key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) this.delete(key);
    }
  }
}

export const serverCache = new SimpleLRUCache(300);

export function makeKey(resource: string, parts: Array<string | number | boolean | null | undefined> = []) {
  return `admin:${resource}:${parts.filter(v => v !== undefined && v !== null).join(':')}`;
}




