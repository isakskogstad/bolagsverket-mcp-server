/**
 * Bolagsverket MCP Server - Token Manager
 * OAuth2 client credentials flow för Bolagsverkets API.
 */

import { API_CONFIG, HTTP_CONFIG } from './config.js';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/**
 * Hanterar OAuth2-tokens med automatisk förnyelse.
 */
export class TokenManager {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  /**
   * Hämta giltig access token, förnyar om nödvändigt.
   */
  async getToken(forceRefresh = false): Promise<string> {
    // Returnera cached token om den fortfarande är giltig
    if (!forceRefresh && this.accessToken && this.tokenExpiry) {
      if (new Date() < this.tokenExpiry) {
        return this.accessToken;
      }
    }

    console.error('[TokenManager] Hämtar ny OAuth2-token...');

    const response = await fetch(API_CONFIG.TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: API_CONFIG.CLIENT_ID,
        client_secret: API_CONFIG.CLIENT_SECRET,
        scope: API_CONFIG.SCOPE,
      }),
      signal: AbortSignal.timeout(HTTP_CONFIG.TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TokenManager] Token-fel: ${response.status} - ${errorText}`);
      throw new Error(`Token-fel: ${response.status} - ${errorText}`);
    }

    const data: TokenResponse = await response.json();
    
    this.accessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;
    // Förnya 60 sekunder innan utgång
    this.tokenExpiry = new Date(Date.now() + (expiresIn - 60) * 1000);

    console.error(`[TokenManager] Token hämtad, giltig i ${expiresIn} sekunder`);
    
    return this.accessToken;
  }

  /**
   * Invalidera cached token.
   */
  invalidate(): void {
    this.accessToken = null;
    this.tokenExpiry = null;
    console.error('[TokenManager] Token invaliderad');
  }

  /**
   * Kontrollera om token finns och är giltig.
   */
  isValid(): boolean {
    if (!this.accessToken || !this.tokenExpiry) {
      return false;
    }
    return new Date() < this.tokenExpiry;
  }

  /**
   * Hämta tid till utgång i sekunder.
   */
  getTimeToExpiry(): number {
    if (!this.tokenExpiry) {
      return 0;
    }
    const remaining = this.tokenExpiry.getTime() - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
  }
}

// Singleton-instans
export const tokenManager = new TokenManager();
