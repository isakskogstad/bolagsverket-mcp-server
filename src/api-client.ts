/**
 * Bolagsverket API Client
 * Hanterar kommunikation med Bolagsverkets "Värdefulla datamängder" API
 */

// API Base URLs
const BOLAGSVERKET_BASE = 'https://foretagsfakta.bolagsverket.se';
const ARSREDOVISNING_API = `${BOLAGSVERKET_BASE}/api/arsredovisning`;
const FORETAGSINFO_API = `${BOLAGSVERKET_BASE}/api/foretagsinfo`;

// Typer
export interface CompanyInfo {
  organisationsnummer: string;
  namn: string;
  bolagsform?: string;
  status?: string;
  registreringsdatum?: string;
  adress?: {
    gatuadress?: string;
    postnummer?: string;
    postort?: string;
  };
}

export interface AnnualReport {
  organisationsnummer: string;
  rakenskapsperiod: {
    from: string;
    tom: string;
  };
  taxonomi?: string;
  inlamningsdatum?: string;
  data: FinancialData;
}

export interface FinancialData {
  balansrakning?: BalanceSheet;
  resultatrakning?: IncomeStatement;
  nyckeltal?: KeyFigures;
  noter?: Record<string, unknown>;
}

export interface BalanceSheet {
  tillgangar?: {
    anlaggningstillgangar?: number;
    omsattningstillgangar?: number;
    summa?: number;
  };
  egetKapitalOchSkulder?: {
    egetKapital?: number;
    langfristigaSkulder?: number;
    kortfristigaSkulder?: number;
    summa?: number;
  };
}

export interface IncomeStatement {
  nettoomsattning?: number;
  rorelseresultat?: number;
  resultatEfterFinansiellaPoster?: number;
  aretResultat?: number;
}

export interface KeyFigures {
  soliditet?: number;
  kassalikviditet?: number;
  avkastningEgetKapital?: number;
  avkastningTotaltKapital?: number;
  vinstmarginal?: number;
}

export interface SearchResult {
  companies: CompanyInfo[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface RiskIndicator {
  type: 'critical' | 'warning' | 'info';
  category: string;
  description: string;
  value?: number;
  threshold?: number;
}

export interface NetworkConnection {
  personId: string;
  namn: string;
  roll: string;
  organisationsnummer: string;
  foretag: string;
}

// Cache för att minska API-anrop
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minuter

function getCached<T>(key: string): T | null {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// Hjälpfunktion för att validera organisationsnummer
export function validateOrgNr(orgNr: string): string {
  // Ta bort alla icke-siffror
  const cleaned = orgNr.replace(/\D/g, '');
  
  // Kontrollera längd (10 siffror)
  if (cleaned.length !== 10) {
    throw new Error(`Ogiltigt organisationsnummer: ${orgNr}. Måste vara 10 siffror.`);
  }
  
  return cleaned;
}

// Formatera organisationsnummer med bindestreck
export function formatOrgNr(orgNr: string): string {
  const cleaned = validateOrgNr(orgNr);
  return `${cleaned.slice(0, 6)}-${cleaned.slice(6)}`;
}

/**
 * Hämta företagsinformation
 */
export async function getCompanyInfo(orgNr: string): Promise<CompanyInfo> {
  const cleanedOrgNr = validateOrgNr(orgNr);
  const cacheKey = `company:${cleanedOrgNr}`;
  
  const cached = getCached<CompanyInfo>(cacheKey);
  if (cached) return cached;
  
  try {
    const response = await fetch(`${FORETAGSINFO_API}/${cleanedOrgNr}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Företag med organisationsnummer ${formatOrgNr(cleanedOrgNr)} hittades inte.`);
      }
      throw new Error(`API-fel: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as CompanyInfo;
    setCache(cacheKey, data);
    return data;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Kunde inte hämta företagsinformation: ${error}`);
  }
}

/**
 * Hämta årsredovisning
 */
export async function getAnnualReport(
  orgNr: string, 
  year?: number
): Promise<AnnualReport> {
  const cleanedOrgNr = validateOrgNr(orgNr);
  const cacheKey = `report:${cleanedOrgNr}:${year || 'latest'}`;
  
  const cached = getCached<AnnualReport>(cacheKey);
  if (cached) return cached;
  
  try {
    let url = `${ARSREDOVISNING_API}/${cleanedOrgNr}`;
    if (year) {
      url += `?year=${year}`;
    }
    
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Ingen årsredovisning hittades för ${formatOrgNr(cleanedOrgNr)}${year ? ` år ${year}` : ''}.`);
      }
      throw new Error(`API-fel: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as AnnualReport;
    setCache(cacheKey, data);
    return data;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Kunde inte hämta årsredovisning: ${error}`);
  }
}

/**
 * Sök företag
 */
export async function searchCompanies(
  query: string,
  options: {
    page?: number;
    pageSize?: number;
    status?: string;
    bolagsform?: string;
  } = {}
): Promise<SearchResult> {
  const { page = 1, pageSize = 20, status, bolagsform } = options;
  
  const params = new URLSearchParams({
    q: query,
    page: page.toString(),
    pageSize: pageSize.toString(),
  });
  
  if (status) params.set('status', status);
  if (bolagsform) params.set('bolagsform', bolagsform);
  
  try {
    const response = await fetch(`${FORETAGSINFO_API}/search?${params}`);
    
    if (!response.ok) {
      throw new Error(`API-fel: ${response.status} ${response.statusText}`);
    }
    
    return await response.json() as SearchResult;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Sökning misslyckades: ${error}`);
  }
}

/**
 * Analysera riskindikatorer
 */
export function analyzeRisks(report: AnnualReport): RiskIndicator[] {
  const risks: RiskIndicator[] = [];
  const data = report.data;
  
  // Soliditet
  if (data.nyckeltal?.soliditet !== undefined) {
    const soliditet = data.nyckeltal.soliditet;
    if (soliditet < 10) {
      risks.push({
        type: 'critical',
        category: 'Soliditet',
        description: 'Mycket låg soliditet - hög risk för obestånd',
        value: soliditet,
        threshold: 10,
      });
    } else if (soliditet < 25) {
      risks.push({
        type: 'warning',
        category: 'Soliditet',
        description: 'Låg soliditet - begränsad finansiell styrka',
        value: soliditet,
        threshold: 25,
      });
    }
  }
  
  // Negativt resultat
  if (data.resultatrakning?.aretResultat !== undefined) {
    const resultat = data.resultatrakning.aretResultat;
    if (resultat < 0) {
      risks.push({
        type: 'warning',
        category: 'Resultat',
        description: 'Negativt årsresultat',
        value: resultat,
      });
    }
  }
  
  // Negativt eget kapital
  if (data.balansrakning?.egetKapitalOchSkulder?.egetKapital !== undefined) {
    const egetKapital = data.balansrakning.egetKapitalOchSkulder.egetKapital;
    if (egetKapital < 0) {
      risks.push({
        type: 'critical',
        category: 'Eget kapital',
        description: 'Negativt eget kapital - risk för kontrollbalansräkning',
        value: egetKapital,
      });
    }
  }
  
  // Kassalikviditet
  if (data.nyckeltal?.kassalikviditet !== undefined) {
    const kassalikviditet = data.nyckeltal.kassalikviditet;
    if (kassalikviditet < 100) {
      risks.push({
        type: 'warning',
        category: 'Likviditet',
        description: 'Låg kassalikviditet - kan ha svårt att betala kortfristiga skulder',
        value: kassalikviditet,
        threshold: 100,
      });
    }
  }
  
  return risks;
}

/**
 * Beräkna nyckeltal från balans- och resultaträkning
 */
export function calculateKeyFigures(report: AnnualReport): KeyFigures {
  const balans = report.data.balansrakning;
  const resultat = report.data.resultatrakning;
  
  const keyFigures: KeyFigures = {};
  
  // Soliditet = Eget kapital / Totala tillgångar * 100
  if (balans?.egetKapitalOchSkulder?.egetKapital && balans?.tillgangar?.summa) {
    keyFigures.soliditet = (balans.egetKapitalOchSkulder.egetKapital / balans.tillgangar.summa) * 100;
  }
  
  // Vinstmarginal = Årets resultat / Nettoomsättning * 100
  if (resultat?.aretResultat && resultat?.nettoomsattning) {
    keyFigures.vinstmarginal = (resultat.aretResultat / resultat.nettoomsattning) * 100;
  }
  
  // Avkastning på eget kapital = Årets resultat / Eget kapital * 100
  if (resultat?.aretResultat && balans?.egetKapitalOchSkulder?.egetKapital) {
    keyFigures.avkastningEgetKapital = (resultat.aretResultat / balans.egetKapitalOchSkulder.egetKapital) * 100;
  }
  
  // Avkastning på totalt kapital = (Resultat efter finansiella poster + Räntekostnader) / Totala tillgångar * 100
  if (resultat?.resultatEfterFinansiellaPoster && balans?.tillgangar?.summa) {
    keyFigures.avkastningTotaltKapital = (resultat.resultatEfterFinansiellaPoster / balans.tillgangar.summa) * 100;
  }
  
  return keyFigures;
}

/**
 * Formatera belopp i SEK
 */
export function formatSEK(amount: number): string {
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Formatera procent
 */
export function formatPercent(value: number): string {
  return new Intl.NumberFormat('sv-SE', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100);
}

/**
 * Hämta cache-statistik
 */
export function getCacheStats(): { entries: number; oldestEntry: number | null } {
  let oldestTimestamp: number | null = null;
  
  for (const [, value] of cache) {
    if (oldestTimestamp === null || value.timestamp < oldestTimestamp) {
      oldestTimestamp = value.timestamp;
    }
  }
  
  return {
    entries: cache.size,
    oldestEntry: oldestTimestamp ? Date.now() - oldestTimestamp : null,
  };
}

/**
 * Rensa cache
 */
export function clearCache(): void {
  cache.clear();
}
