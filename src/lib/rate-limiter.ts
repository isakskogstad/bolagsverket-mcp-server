/**
 * Bolagsverket MCP Server - Rate Limiter
 * Sliding window rate limiter för att skydda mot överbelastning.
 */

import { HTTP_CONFIG } from './config.js';

interface RateLimitWindow {
  timestamps: number[];
  blocked_until?: number;
}

/**
 * Sliding window rate limiter.
 * Spårar requests per tidsfönster och blockerar vid överträdelse.
 */
class RateLimiter {
  private windows: Map<string, RateLimitWindow> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(maxRequests: number = HTTP_CONFIG.RATE_LIMIT_REQUESTS, windowMs: number = HTTP_CONFIG.RATE_LIMIT_WINDOW_MS) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Rensa gamla entries var 5:e minut
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Kontrollera om en request är tillåten.
   * @param key - Identifierare (t.ex. session-id eller IP)
   * @returns true om request är tillåten, false om rate limited
   */
  check(key: string): boolean {
    const now = Date.now();
    let window = this.windows.get(key);

    if (!window) {
      window = { timestamps: [] };
      this.windows.set(key, window);
    }

    // Kontrollera om vi är blockerade
    if (window.blocked_until && now < window.blocked_until) {
      return false;
    }

    // Rensa timestamps äldre än fönstret
    window.timestamps = window.timestamps.filter(t => now - t < this.windowMs);

    // Kontrollera om vi överskrider gränsen
    if (window.timestamps.length >= this.maxRequests) {
      // Blockera i ett fönster
      window.blocked_until = now + this.windowMs;
      console.error(`[RateLimiter] Rate limit exceeded for ${key}. Blocked until ${new Date(window.blocked_until).toISOString()}`);
      return false;
    }

    // Lägg till ny timestamp
    window.timestamps.push(now);
    return true;
  }

  /**
   * Hämta antal återstående requests.
   */
  remaining(key: string): number {
    const window = this.windows.get(key);
    if (!window) {
      return this.maxRequests;
    }

    const now = Date.now();
    const validTimestamps = window.timestamps.filter(t => now - t < this.windowMs);
    return Math.max(0, this.maxRequests - validTimestamps.length);
  }

  /**
   * Hämta tid tills rate limit resettas (millisekunder).
   */
  resetIn(key: string): number {
    const window = this.windows.get(key);
    if (!window || window.timestamps.length === 0) {
      return 0;
    }

    const now = Date.now();
    const oldestValid = window.timestamps.find(t => now - t < this.windowMs);
    if (!oldestValid) {
      return 0;
    }

    return Math.max(0, this.windowMs - (now - oldestValid));
  }

  /**
   * Rensa gamla entries.
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, window] of this.windows.entries()) {
      // Ta bort helt om inga aktiva timestamps och inte blockerad
      window.timestamps = window.timestamps.filter(t => now - t < this.windowMs);

      if (window.timestamps.length === 0 && (!window.blocked_until || now >= window.blocked_until)) {
        this.windows.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.error(`[RateLimiter] Cleaned up ${cleaned} expired entries`);
    }
  }

  /**
   * Stäng rate limiter och rensa timers.
   */
  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.windows.clear();
  }

  /**
   * Hämta statistik.
   */
  getStats(): { total_keys: number; total_requests: number } {
    let totalRequests = 0;
    const now = Date.now();

    for (const window of this.windows.values()) {
      totalRequests += window.timestamps.filter(t => now - t < this.windowMs).length;
    }

    return {
      total_keys: this.windows.size,
      total_requests: totalRequests,
    };
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

// Global API rate limiter (för Bolagsverket API)
export const apiRateLimiter = new RateLimiter(50, 60000); // 50 requests per minut till API
