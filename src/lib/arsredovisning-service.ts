/**
 * Bolagsverket MCP Server - Årsredovisning Service
 * Hämtar, packar upp och parsar årsredovisningar.
 */

import { fetchDokumentlista, downloadDocumentBytes } from './api-client.js';
import { cacheManager } from './cache-manager.js';
import { IXBRLParser } from './ixbrl-parser.js';
import { formatOrgNummer } from './validators.js';
import type { Arsredovisning, FullArsredovisning, DokumentInfo, RodFlagga, FlerarsData } from '../types/index.js';

// Vi behöver en ZIP-parser - använder pako för deflate
import { unzipSync } from 'fflate';

// ---------------------------------------------------------------------------
// Dokument-normalisering
// ---------------------------------------------------------------------------

function stripPaketSuffix(id: string): string {
  return id.replace(/_paket$/i, '');
}

function uuidPart(id: string): string {
  const stripped = stripPaketSuffix(id);
  return stripped.split('_')[0] || stripped;
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d: Date): string {
  // YYYY-MM-DD
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function deriveStartFromEnd(endIso: string): string {
  const end = parseIsoDate(endIso);
  if (!end) return '';
  // Antag räkenskapsår ≈ 12 månader. Start = (slut - 1 år) + 1 dag
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), end.getUTCDate()));
  start.setUTCDate(start.getUTCDate() + 1);
  return toIsoDate(start);
}

function normalizeDokumentInfo(raw: any): DokumentInfo | null {
  if (!raw || typeof raw !== 'object') return null;

  const dokumentId: string | undefined =
    typeof raw.id === 'string' ? raw.id :
    typeof raw.dokumentId === 'string' ? raw.dokumentId :
    undefined;

  if (!dokumentId) return null;

  const till: string =
    (raw.rakenskapsperiod && typeof raw.rakenskapsperiod.till === 'string' && raw.rakenskapsperiod.till) ? raw.rakenskapsperiod.till :
    (typeof raw.rapporteringsperiodTom === 'string' ? raw.rapporteringsperiodTom : '');

  const fran: string =
    (raw.rakenskapsperiod && typeof raw.rakenskapsperiod.fran === 'string' && raw.rakenskapsperiod.fran) ? raw.rakenskapsperiod.fran :
    (till ? deriveStartFromEnd(till) : '');

  const inlamningsdatum: string =
    (typeof raw.inlamningsdatum === 'string' && raw.inlamningsdatum) ? raw.inlamningsdatum :
    (typeof raw.registreringstidpunkt === 'string' ? raw.registreringstidpunkt : '');

  const typ: string = typeof raw.typ === 'string' && raw.typ ? raw.typ : 'ARSREDOVISNING';

  const normalized: DokumentInfo = {
    id: dokumentId,
    typ,
    rakenskapsperiod: { fran, till: till || fran || '' },
    inlamningsdatum,

    // compat fields
    dokumentId: typeof raw.dokumentId === 'string' ? raw.dokumentId : undefined,
    filformat: typeof raw.filformat === 'string' ? raw.filformat : undefined,
    rapporteringsperiodTom: typeof raw.rapporteringsperiodTom === 'string' ? raw.rapporteringsperiodTom : undefined,
    registreringstidpunkt: typeof raw.registreringstidpunkt === 'string' ? raw.registreringstidpunkt : undefined,
  };

  return normalized;
}

function sortDokumentDesc(docs: DokumentInfo[]): DokumentInfo[] {
  return [...docs].sort((a, b) => {
    const aDate = parseIsoDate(a.inlamningsdatum) || parseIsoDate(a.rakenskapsperiod.till) || parseIsoDate(a.rakenskapsperiod.fran);
    const bDate = parseIsoDate(b.inlamningsdatum) || parseIsoDate(b.rakenskapsperiod.till) || parseIsoDate(b.rakenskapsperiod.fran);
    const aTime = aDate ? aDate.getTime() : 0;
    const bTime = bDate ? bDate.getTime() : 0;
    return bTime - aTime;
  });
}

async function downloadZipWithFallback(dokumentId: string): Promise<ArrayBuffer> {
  const candidates = Array.from(new Set([
    dokumentId,
    stripPaketSuffix(dokumentId),
    uuidPart(dokumentId),
  ].filter(Boolean)));

  let lastError: unknown = null;
  for (const id of candidates) {
    try {
      return await downloadDocumentBytes(id);
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const isNotFound = /\b404\b|Ej funnen|Not Found|felaktigt dokumentId/i.test(msg);
      if (!isNotFound) throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Kunde inte ladda ner dokument (inga kandidater fungerade)');
}

/**
 * Hämta dokumentlista för ett företag.
 */
export async function fetchDokumentlistaForOrg(orgNummer: string): Promise<DokumentInfo[]> {
  const cached = cacheManager.get<DokumentInfo[]>('dokumentlista', orgNummer);
  if (cached) {
    console.error(`[ArsredovisningService] Cache-träff för dokumentlista ${orgNummer}`);
    return cached;
  }

  console.error(`[ArsredovisningService] Hämtar dokumentlista för ${orgNummer}`);
  const data: any = await fetchDokumentlista(orgNummer);
  const rawList: any[] =
    Array.isArray(data?.dokument) ? data.dokument :
    Array.isArray(data?.dokumentLista) ? data.dokumentLista :
    Array.isArray(data?.dokumentlista) ? data.dokumentlista :
    Array.isArray(data?.dokumentLista?.dokument) ? data.dokumentLista.dokument :
    Array.isArray(data?.dokumentlista?.dokument) ? data.dokumentlista.dokument :
    [];

  const normalized = rawList
    .map(normalizeDokumentInfo)
    .filter((d): d is DokumentInfo => Boolean(d));

  const sorted = sortDokumentDesc(normalized);

  cacheManager.set('dokumentlista', orgNummer, sorted);
  return sorted;
}

/**
 * Ladda ner och extrahera iXBRL-innehåll från årsredovisning.
 */
export async function downloadAndExtractXhtml(dokumentId: string): Promise<string> {
  const cached = cacheManager.get<string>('ixbrl_document', dokumentId);
  if (cached) {
    console.error(`[ArsredovisningService] Cache-träff för dokument ${dokumentId}`);
    return cached;
  }

  console.error(`[ArsredovisningService] Laddar ner dokument ${dokumentId}`);
  const zipBuffer = await downloadZipWithFallback(dokumentId);
  
  // Extrahera ZIP
  const uint8Array = new Uint8Array(zipBuffer);
  const unzipped = unzipSync(uint8Array);
  
  // Hitta XHTML-filen
  let xhtmlContent = '';
  for (const [filename, content] of Object.entries(unzipped)) {
    if (filename.endsWith('.xhtml') || filename.endsWith('.html')) {
      xhtmlContent = new TextDecoder('utf-8').decode(content);
      break;
    }
  }

  if (!xhtmlContent) {
    throw new Error('Kunde inte hitta iXBRL-dokument i ZIP-filen');
  }

  cacheManager.set('ixbrl_document', dokumentId, xhtmlContent);
  return xhtmlContent;
}

/**
 * Hämta och parsa årsredovisning.
 */
export async function fetchAndParseArsredovisning(
  orgNummer: string,
  index = 0
): Promise<{ arsredovisning: Arsredovisning; xhtml: string; dokumentInfo: DokumentInfo }> {
  const dokument = await fetchDokumentlistaForOrg(orgNummer);
  
  if (dokument.length === 0) {
    throw new Error(`Inga årsredovisningar hittades för ${orgNummer}`);
  }

  if (index >= dokument.length) {
    throw new Error(`Index ${index} är utanför intervallet (0-${dokument.length - 1})`);
  }

  const dokumentInfo = dokument[index];
  const xhtml = await downloadAndExtractXhtml(dokumentInfo.id);
  const parser = new IXBRLParser(xhtml);

  const nyckeltal = parser.getNyckeltal('period0');
  const personer = parser.getPersoner();
  const balansrakning = parser.getBalansrakning('balans0');
  const resultatrakning = parser.getResultatrakning('period0');

  const arsredovisning: Arsredovisning = {
    org_nummer: formatOrgNummer(orgNummer),
    foretag_namn: parser.getForetanamn() || 'Okänt företag',
    rakenskapsar_start: dokumentInfo.rakenskapsperiod.fran,
    rakenskapsar_slut: dokumentInfo.rakenskapsperiod.till,
    nyckeltal,
    personer,
    balansrakning,
    resultatrakning,
    noter: {},
    metadata: {
      dokument_id: dokumentInfo.id,
      inlamningsdatum: dokumentInfo.inlamningsdatum,
    },
  };

  return { arsredovisning, xhtml, dokumentInfo };
}

/**
 * Hämta full årsredovisning med alla detaljer.
 */
export async function fetchFullArsredovisning(
  orgNummer: string,
  index = 0
): Promise<FullArsredovisning> {
  const { arsredovisning, xhtml } = await fetchAndParseArsredovisning(orgNummer, index);
  const parser = new IXBRLParser(xhtml);

  const { styrelse, revisorer, vd } = parser.getPersonerDetaljerad();
  const forvaltningsberattelse = parser.getForvaltningsberattelse();
  const flerarsOversikt = parser.getFlerarsOversikt();

  // Konvertera flerårsöversikt till array
  const flerarsdata: FlerarsData[] = Object.entries(flerarsOversikt).map(([period, nyckeltal]) => ({
    period,
    nyckeltal,
  }));

  // Analysera röda flaggor
  const rodaFlaggor = analyzeRodaFlaggor(arsredovisning, flerarsdata);

  return {
    ...arsredovisning,
    styrelse,
    revisorer,
    vd: vd ?? undefined,
    forvaltningsberattelse,
    flerarsdata,
    roda_flaggor: rodaFlaggor,
  };
}

/**
 * Analysera röda flaggor baserat på nyckeltal.
 */
function analyzeRodaFlaggor(arsredovisning: Arsredovisning, flerarsdata: FlerarsData[]): RodFlagga[] {
  const flaggor: RodFlagga[] = [];
  const nyckeltal = arsredovisning.nyckeltal;

  // Negativt eget kapital
  if (nyckeltal.eget_kapital != null && nyckeltal.eget_kapital < 0) {
    flaggor.push({
      typ: 'NEGATIVT_EGET_KAPITAL',
      allvarlighet: 'kritisk',
      beskrivning: 'Företaget har negativt eget kapital',
      varde: nyckeltal.eget_kapital,
      rekommendation: 'Kontrollera om kontrollbalansräkning upprättats',
    });
  }

  // Låg soliditet
  if (nyckeltal.soliditet != null && nyckeltal.soliditet < 10) {
    flaggor.push({
      typ: 'LAG_SOLIDITET',
      allvarlighet: nyckeltal.soliditet < 0 ? 'kritisk' : 'varning',
      beskrivning: `Soliditeten är endast ${nyckeltal.soliditet}%`,
      varde: nyckeltal.soliditet,
      rekommendation: 'Hög skuldsättning ökar finansiell risk',
    });
  }

  // Förlust
  if (nyckeltal.arets_resultat != null && nyckeltal.arets_resultat < 0) {
    flaggor.push({
      typ: 'FORLUST',
      allvarlighet: 'varning',
      beskrivning: 'Företaget redovisar förlust',
      varde: nyckeltal.arets_resultat,
    });
  }

  // Sjunkande omsättning
  if (flerarsdata.length >= 2) {
    const current = flerarsdata[0]?.nyckeltal.nettoomsattning;
    const previous = flerarsdata[1]?.nyckeltal.nettoomsattning;
    
    if (current != null && previous != null && previous > 0) {
      const forandring = ((current - previous) / previous) * 100;
      if (forandring < -20) {
        flaggor.push({
          typ: 'SJUNKANDE_OMSATTNING',
          allvarlighet: 'varning',
          beskrivning: `Omsättningen har minskat med ${Math.abs(forandring).toFixed(1)}%`,
          varde: forandring,
        });
      }
    }
  }

  // Negativ vinstmarginal
  if (nyckeltal.vinstmarginal != null && nyckeltal.vinstmarginal < -10) {
    flaggor.push({
      typ: 'NEGATIV_VINSTMARGINAL',
      allvarlighet: 'varning',
      beskrivning: `Vinstmarginalen är ${nyckeltal.vinstmarginal}%`,
      varde: nyckeltal.vinstmarginal,
    });
  }

  return flaggor;
}

/**
 * Hämta trenddata för flera år.
 */
export async function fetchTrendData(orgNummer: string, antalAr = 4): Promise<FlerarsData[]> {
  const dokument = await fetchDokumentlistaForOrg(orgNummer);
  const maxIndex = Math.min(antalAr, dokument.length);
  const flerarsdata: FlerarsData[] = [];

  for (let i = 0; i < maxIndex; i++) {
    try {
      const { arsredovisning, dokumentInfo } = await fetchAndParseArsredovisning(orgNummer, i);
      flerarsdata.push({
        period: dokumentInfo.rakenskapsperiod.till,
        nyckeltal: arsredovisning.nyckeltal,
      });
    } catch (error) {
      console.error(`[ArsredovisningService] Kunde inte hämta årsredovisning ${i}: ${error}`);
    }
  }

  return flerarsdata;
}

/**
 * Kontrollera om det finns årsredovisningar för ett företag.
 */
export async function hasArsredovisningar(orgNummer: string): Promise<boolean> {
  try {
    const dokument = await fetchDokumentlistaForOrg(orgNummer);
    return dokument.length > 0;
  } catch {
    return false;
  }
}
