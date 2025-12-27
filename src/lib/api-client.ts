/**
 * Bolagsverket MCP Server - API Client
 * HTTP-klient för kommunikation med Bolagsverkets API.
 */

import { randomUUID } from 'crypto';
import { API_CONFIG, HTTP_CONFIG } from './config.js';
import { tokenManager } from './token-manager.js';
import { apiRateLimiter } from './rate-limiter.js';
import type { ApiError, OrganisationResponse, DokumentlistaResponse } from '../types/index.js';

/**
 * Sleep-funktion för retry-logik.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Gör autentiserat API-anrop till Bolagsverket med retry-logik.
 */
export async function makeApiRequest<T>(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: Record<string, unknown>
): Promise<T> {
  // Rate limiting check
  if (!apiRateLimiter.check('bolagsverket-api')) {
    const resetIn = Math.ceil(apiRateLimiter.resetIn('bolagsverket-api') / 1000);
    throw new Error(`Rate limit överskriden. Försök igen om ${resetIn} sekunder.`);
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= HTTP_CONFIG.MAX_RETRIES; attempt++) {
    try {
      const token = await tokenManager.getToken();
      const requestId = randomUUID();

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'X-Request-Id': requestId,
        'Accept': 'application/json',
      };

      if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
      }

      const url = `${API_CONFIG.BASE_URL}${endpoint}`;
      console.error(`[API] ${method} ${endpoint} (request_id: ${requestId}, attempt: ${attempt}/${HTTP_CONFIG.MAX_RETRIES})`);

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(HTTP_CONFIG.TIMEOUT_MS),
      });

      if (!response.ok) {
        console.error(`[API] Fel: ${response.status}`);

        let errorMessage = `HTTP ${response.status}`;

        try {
          const errorData: ApiError = await response.json();
          const title = errorData.title || 'Error';
          const detail = errorData.detail || errorMessage;

          switch (response.status) {
            case 400:
              errorMessage = `Ogiltig begäran: ${detail}`;
              break;
            case 401:
              errorMessage = `Ej autentiserad: ${detail}`;
              tokenManager.invalidate();
              break;
            case 403:
              errorMessage = `Åtkomst nekad: ${detail}`;
              break;
            case 404:
              errorMessage = `Företaget hittades inte: ${detail}`;
              break;
            case 500:
              errorMessage = `Serverfel hos Bolagsverket: ${detail}`;
              break;
            default:
              errorMessage = `${title}: ${detail}`;
          }

          console.error(`[API] ApiError - requestId: ${requestId}, status: ${response.status}, title: ${title}`);
        } catch {
          const text = await response.text();
          errorMessage = `HTTP ${response.status}: ${text.slice(0, 200)}`;
        }

        throw new Error(errorMessage);
      }

      return response.json() as Promise<T>;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Nätverksfel - försök igen
      const isNetworkError = lastError.message.includes('fetch failed') ||
                            lastError.message.includes('network') ||
                            lastError.message.includes('ECONNREFUSED') ||
                            lastError.message.includes('ETIMEDOUT') ||
                            lastError.message.includes('timeout');

      if (isNetworkError && attempt < HTTP_CONFIG.MAX_RETRIES) {
        const delayMs = HTTP_CONFIG.RETRY_DELAY_MS * attempt;
        console.error(`[API] Nätverksfel, försöker igen om ${delayMs}ms... (${lastError.message})`);
        await sleep(delayMs);
        continue;
      }

      // Övriga fel - kasta direkt
      throw lastError;
    }
  }

  throw lastError || new Error('API-anrop misslyckades efter alla försök');
}

/**
 * Ladda ner dokument som bytes (ZIP-fil).
 */
export async function downloadDocumentBytes(dokumentId: string): Promise<ArrayBuffer> {
  const token = await tokenManager.getToken();
  const requestId = randomUUID();

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'X-Request-Id': requestId,
    'Accept': 'application/zip',
  };

  const url = `${API_CONFIG.BASE_URL}/dokument/${dokumentId}`;
  console.error(`[API] Laddar ner dokument: ${dokumentId} (request_id: ${requestId})`);

  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(HTTP_CONFIG.TIMEOUT_MS),
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: Kunde inte ladda ner dokument`;
    
    try {
      const errorData: ApiError = await response.json();
      errorMessage = `${errorData.title}: ${errorData.detail}`;
    } catch {
      // Ignorera JSON-parsningsfel
    }
    
    throw new Error(errorMessage);
  }

  return response.arrayBuffer();
}

/**
 * Hämta organisationsinformation.
 */
export async function fetchOrganisation(orgNummer: string): Promise<OrganisationResponse> {
  return makeApiRequest<OrganisationResponse>('POST', '/organisationer', {
    identitetsbeteckning: orgNummer,
  });
}

/**
 * Hämta dokumentlista för organisation.
 */
export async function fetchDokumentlista(orgNummer: string): Promise<DokumentlistaResponse> {
  return makeApiRequest<DokumentlistaResponse>('POST', '/dokumentlista', {
    identitetsbeteckning: orgNummer,
  });
}

/**
 * Kontrollera API-status (isalive).
 */
export async function checkApiStatus(): Promise<boolean> {
  try {
    const token = await tokenManager.getToken();
    
    const response = await fetch(`${API_CONFIG.BASE_URL}/isalive`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(HTTP_CONFIG.TIMEOUT_MS),
    });
    
    return response.ok;
  } catch {
    return false;
  }
}
