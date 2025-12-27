/**
 * Bolagsverket MCP Server - API Client
 * HTTP-klient för kommunikation med Bolagsverkets API.
 */

import { randomUUID } from 'crypto';
import { API_CONFIG, HTTP_CONFIG } from './config.js';
import { tokenManager } from './token-manager.js';
import type { ApiError, OrganisationResponse, DokumentlistaResponse } from '../types/index.js';

/**
 * Gör autentiserat API-anrop till Bolagsverket.
 */
export async function makeApiRequest<T>(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: Record<string, unknown>
): Promise<T> {
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
  console.error(`[API] ${method} ${endpoint} (request_id: ${requestId})`);

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
          errorMessage = `Ej funnen: ${detail}`;
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
