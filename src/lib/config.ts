/**
 * Bolagsverket MCP Server - Konfiguration
 */

import { homedir } from 'os';
import { join } from 'path';

// =============================================================================
// API-konfiguration
// =============================================================================

export const API_CONFIG = {
  CLIENT_ID: process.env.BOLAGSVERKET_CLIENT_ID || 'UIiATHgXGSP6HIyOlqWZkX51dnka',
  CLIENT_SECRET: process.env.BOLAGSVERKET_CLIENT_SECRET || 'H10hBNr_KeYqA9h5AEe7J32HkFsa',
  TOKEN_URL: 'https://portal.api.bolagsverket.se/oauth2/token',
  BASE_URL: 'https://gw.api.bolagsverket.se/vardefulla-datamangder/v1',
  SCOPE: 'vardefulla-datamangder:read vardefulla-datamangder:ping',
} as const;

// =============================================================================
// Server-konfiguration
// =============================================================================

export const SERVER_CONFIG = {
  NAME: 'bolagsverket',
  VERSION: '5.3.0',
  DEFAULT_PORT: parseInt(process.env.PORT || '8000', 10),
  DEFAULT_HOST: '0.0.0.0',
} as const;

// =============================================================================
// Sökvägar
// =============================================================================

export const PATHS = {
  OUTPUT_DIR: join(homedir(), 'Downloads', 'bolagsverket'),
  CACHE_DIR: join(homedir(), '.cache', 'bolagsverket_mcp'),
  CACHE_DB: join(homedir(), '.cache', 'bolagsverket_mcp', 'cache.db'),
} as const;

// =============================================================================
// Cache TTL (sekunder)
// =============================================================================

export const CACHE_TTL = {
  arsredovisning: 30 * 24 * 3600,  // 30 dagar
  company_info: 24 * 3600,         // 1 dag
  dokumentlista: 7 * 24 * 3600,    // 7 dagar
  ixbrl_document: 30 * 24 * 3600,  // 30 dagar
  nyckeltal: 30 * 24 * 3600,       // 30 dagar
} as const;

// =============================================================================
// HTTP-konfiguration
// =============================================================================

export const HTTP_CONFIG = {
  TIMEOUT_MS: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
} as const;

// =============================================================================
// Taxonomi-versioner
// =============================================================================

export const TAXONOMY_VERSIONS = {
  CURRENT: [
    'K2 Aktiebolag 2024-09-12',
    'K2 Aktiebolag 2021-10-31',
    'K2 Ek.för/HB/KB/Filial 2024-09-12',
    'K3 Aktiebolag 2021-10-31',
    'K3K Koncern 2021-10-31',
    'Revisionsberättelse 2020-12-01',
    'Fastställelseintyg 2020-12-01',
  ],
  ARCHIVED: [
    'K2 2017-09-30',
    'K3 2018-12-17',
  ],
} as const;
