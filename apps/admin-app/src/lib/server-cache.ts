type CacheEntry<T> = { data: T; expiresAt: number };

class SimpleLRUCache {
  private store = new Map<string, CacheEntry<any>>();
  private order: string[] = [];
  private hits = 0;
  private misses = 0;

  constructor(private maxEntries: number = 1000) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      this.misses++;
      return undefined;
    }
    // touch - move to end (most recently used)
    const index = this.order.indexOf(key);
    if (index > -1) {
      this.order.splice(index, 1);
    }
    this.order.push(key);
    this.hits++;
    return entry.data as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs;
    
    // Remove from order if exists
    const index = this.order.indexOf(key);
    if (index > -1) {
      this.order.splice(index, 1);
    }
    
    this.store.set(key, { data: value, expiresAt });
    this.order.push(key);
    
    // Evict oldest entries if over limit
    while (this.order.length > this.maxEntries) {
      const oldest = this.order.shift();
      if (oldest) this.store.delete(oldest);
    }
  }

  delete(key: string): void {
    this.store.delete(key);
    const index = this.order.indexOf(key);
    if (index > -1) {
      this.order.splice(index, 1);
    }
  }

  deleteByPrefix(prefix: string): void {
    const keysToDelete = Array.from(this.store.keys()).filter(key => key.startsWith(prefix));
    keysToDelete.forEach(key => this.delete(key));
  }

  getStats() {
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses) * 100).toFixed(2) + '%' : '0%'
    };
  }

  clear(): void {
    this.store.clear();
    this.order = [];
  }
}

export const serverCache = new SimpleLRUCache(1000);

export function makeKey(resource: string, parts: Array<string | number | boolean | null | undefined> = []) {
  return `admin:${resource}:${parts.filter(v => v !== undefined && v !== null).join(':')}`;
}




