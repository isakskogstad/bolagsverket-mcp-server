/**
 * Bolagsverket MCP Server - Cache Manager
 * In-memory cache med TTL för API-svar.
 * 
 * Använder Map istället för SQLite för kompatibilitet med Render.
 */

import { CACHE_TTL } from './config.js';
import type { CacheStats } from '../types/index.js';

type CacheCategory = keyof typeof CACHE_TTL;

interface CacheEntry {
  value: unknown;
  category: string;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
}

/**
 * In-memory cache med TTL-stöd.
 */
export class CacheManager {
  private cache: Map<string, CacheEntry> = new Map();

  constructor() {
    // Rensa utgångna entries var 5:e minut
    setInterval(() => this.clearExpired(), 5 * 60 * 1000);
  }

  /**
   * Hämta värde från cache.
   */
  get<T>(category: string, identifier: string): T | null {
    const key = `${category}:${identifier}`;
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Kolla om utgången
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Uppdatera träffräknare
    entry.hitCount++;
    
    return entry.value as T;
  }

  /**
   * Spara värde i cache.
   */
  set(category: string, identifier: string, value: unknown, ttl?: number): void {
    const key = `${category}:${identifier}`;
    const effectiveTtl = ttl ?? CACHE_TTL[category as CacheCategory] ?? 3600;
    
    const now = Date.now();
    const entry: CacheEntry = {
      value,
      category,
      createdAt: now,
      expiresAt: now + effectiveTtl * 1000,
      hitCount: 0,
    };

    this.cache.set(key, entry);
  }

  /**
   * Ta bort specifik cache-entry.
   */
  delete(category: string, identifier: string): boolean {
    const key = `${category}:${identifier}`;
    return this.cache.delete(key);
  }

  /**
   * Rensa utgångna cache-entries.
   */
  clearExpired(): number {
    const now = Date.now();
    let cleared = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Rensa all cache.
   */
  clearAll(): number {
    const count = this.cache.size;
    this.cache.clear();
    return count;
  }

  /**
   * Hämta cache-statistik.
   */
  getStats(): CacheStats {
    const now = Date.now();
    const categories: Record<string, { count: number; hits: number }> = {};
    let expiredCount = 0;

    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) {
        expiredCount++;
        continue;
      }

      if (!categories[entry.category]) {
        categories[entry.category] = { count: 0, hits: 0 };
      }
      categories[entry.category].count++;
      categories[entry.category].hits += entry.hitCount;
    }

    return {
      total_entries: this.cache.size,
      expired_entries: expiredCount,
      db_size_bytes: 0, // Inte relevant för in-memory
      categories,
    };
  }

  /**
   * Kontrollera om nyckel finns och är giltig.
   */
  has(category: string, identifier: string): boolean {
    const key = `${category}:${identifier}`;
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Stäng cache (no-op för in-memory).
   */
  close(): void {
    // Inget att stänga för in-memory cache
  }
}

// Singleton-instans
export const cacheManager = new CacheManager();
