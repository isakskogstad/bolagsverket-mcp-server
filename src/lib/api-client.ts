/**
 * Bolagsverket MCP Server - API Client
 * HTTP-klient för kommunikation med Bolagsverkets API.
 *
 * Optimerad för prestanda med:
 * - Connection pooling via keep-alive
 * - Exponentiell backoff för retry
 * - Timeout-hantering
 * - Request ID tracking
 */

import { randomUUID } from 'crypto';
import { Agent } from 'https';
import { API_CONFIG, HTTP_CONFIG } from './config.js';
import { tokenManager } from './token-manager.js';
import type { ApiError, OrganisationResponse, DokumentlistaResponse } from '../types/index.js';

// HTTPS Agent med keep-alive för connection pooling
const httpsAgent = new Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: HTTP_CONFIG.TIMEOUT_MS,
});

/**
 * Sleep-funktion för retry-logik med exponentiell backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Beräkna retry-delay med exponentiell backoff och jitter.
 */
function getRetryDelay(attempt: number): number {
  const baseDelay = HTTP_CONFIG.RETRY_DELAY_MS;
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  // Lägg till jitter (0-20% av delay) för att undvika thundering herd
  const jitter = exponentialDelay * (Math.random() * 0.2);
  return Math.min(exponentialDelay + jitter, 10000); // Max 10 sekunder
}

/**
 * Gör autentiserat API-anrop till Bolagsverket med retry-logik.
 */
export async function makeApiRequest<T>(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: Record<string, unknown>
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= HTTP_CONFIG.MAX_RETRIES; attempt++) {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      const token = await tokenManager.getToken();

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'X-Request-Id': requestId,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
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
        keepalive: true,
      });

      const duration = Date.now() - startTime;

      if (!response.ok) {
        console.error(`[API] Error: ${response.status} (${duration}ms)`);

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
            case 429:
              errorMessage = `För många förfrågningar: ${detail}`;
              // Rate limited - vänta längre
              if (attempt < HTTP_CONFIG.MAX_RETRIES) {
                const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
                console.error(`[API] Rate limited, waiting ${retryAfter}s...`);
                await sleep(retryAfter * 1000);
                continue;
              }
              break;
            case 500:
            case 502:
            case 503:
            case 504:
              errorMessage = `Serverfel hos Bolagsverket: ${detail}`;
              // Server-fel - försök igen
              if (attempt < HTTP_CONFIG.MAX_RETRIES) {
                const delayMs = getRetryDelay(attempt);
                console.error(`[API] Server error, retrying in ${delayMs}ms...`);
                await sleep(delayMs);
                continue;
              }
              break;
            default:
              errorMessage = `${title}: ${detail}`;
          }

          console.error(`[API] Error - requestId: ${requestId}, status: ${response.status}, title: ${title}`);
        } catch {
          const text = await response.text();
          errorMessage = `HTTP ${response.status}: ${text.slice(0, 200)}`;
        }

        throw new Error(errorMessage);
      }

      console.error(`[API] Success: ${response.status} (${duration}ms)`);
      return response.json() as Promise<T>;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Nätverksfel - försök igen med exponentiell backoff
      const isRetryable =
        lastError.message.includes('fetch failed') ||
        lastError.message.includes('network') ||
        lastError.message.includes('ECONNREFUSED') ||
        lastError.message.includes('ECONNRESET') ||
        lastError.message.includes('ETIMEDOUT') ||
        lastError.message.includes('ENOTFOUND') ||
        lastError.message.includes('timeout') ||
        lastError.name === 'AbortError';

      if (isRetryable && attempt < HTTP_CONFIG.MAX_RETRIES) {
        const delayMs = getRetryDelay(attempt);
        console.error(`[API] Network error, retrying in ${delayMs}ms... (${lastError.message})`);
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
  const startTime = Date.now();

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'X-Request-Id': requestId,
    'Accept': 'application/zip',
    'Connection': 'keep-alive',
  };

  const url = `${API_CONFIG.BASE_URL}/dokument/${dokumentId}`;
  console.error(`[API] Downloading document: ${dokumentId} (request_id: ${requestId})`);

  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(HTTP_CONFIG.TIMEOUT_MS * 2), // Längre timeout för download
    keepalive: true,
  });

  const duration = Date.now() - startTime;

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: Kunde inte ladda ner dokument`;

    try {
      const errorData: ApiError = await response.json();
      errorMessage = `${errorData.title}: ${errorData.detail}`;
    } catch {
      // Ignorera JSON-parsningsfel
    }

    console.error(`[API] Download failed: ${response.status} (${duration}ms)`);
    throw new Error(errorMessage);
  }

  console.error(`[API] Download complete: ${dokumentId} (${duration}ms)`);
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
        'Connection': 'keep-alive',
      },
      signal: AbortSignal.timeout(5000), // Kort timeout för health check
      keepalive: true,
    });

    return response.ok;
  } catch {
    return false;
  }
}

// Cleanup vid shutdown
process.on('SIGTERM', () => {
  httpsAgent.destroy();
});

process.on('SIGINT', () => {
  httpsAgent.destroy();
});
