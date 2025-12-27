/**
 * Bolagsverket MCP Server - Analyze Full Tool
 * Komplett analys av företag med årsredovisning.
 */

import { FullAnalysInputSchema, safeParseInput } from './schemas.js';
import { fetchCompanyInfo } from '../lib/company-service.js';
import { fetchFullArsredovisning } from '../lib/arsredovisning-service.js';
import { handleError } from '../lib/errors.js';
import { ErrorCode } from '../types/index.js';
import { validateOrgNummer } from '../lib/validators.js';
import { formatNyckeltalTable, formatRodaFlaggor, formatPersoner, exportToJson } from '../lib/formatting.js';
import type { FullArsredovisning, CompanyInfo } from '../types/index.js';

export const TOOL_NAME = 'bolagsverket_analyze_full';

export const TOOL_DESCRIPTION = `Gör en fullständig analys av ett företag baserat på dess senaste årsredovisning.

Inkluderar:
- Företagsinformation (namn, org.form, status, adress)
- Nyckeltal (omsättning, resultat, soliditet, etc.)
- Balans- och resultaträkning
- Styrelse och revisorer
- Röda flaggor och varningar
- Flerårsöversikt

Returnerar text eller JSON beroende på response_format.`;

export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    org_nummer: {
      type: 'string',
      description: 'Organisationsnummer (10 eller 12 siffror)',
    },
    index: {
      type: 'number',
      description: 'Index för årsredovisning (0 = senaste, 1 = näst senaste, etc.)',
      default: 0,
    },
    inkludera_koncern: {
      type: 'boolean',
      description: 'Inkludera koncerndata om tillgängligt',
      default: false,
    },
    response_format: {
      type: 'string',
      enum: ['text', 'json'],
      description: 'Svarsformat',
      default: 'text',
    },
  },
  required: ['org_nummer'],
};

interface AnalysisResult {
  company_info: CompanyInfo;
  arsredovisning: FullArsredovisning;
  koncern_data?: Record<string, unknown>;
}

/**
 * Utför fullständig analys.
 */
export async function analyzeFull(args: unknown): Promise<string> {
  // Validera input
  const parsed = safeParseInput(FullAnalysInputSchema, args);
  if (!parsed.success) {
    return handleError(ErrorCode.INVALID_INPUT, parsed.error);
  }

  const { org_nummer, index, inkludera_koncern, response_format } = parsed.data;

  // Validera organisationsnummer med Luhn
  const validation = validateOrgNummer(org_nummer);
  if (!validation.valid) {
    return handleError(ErrorCode.INVALID_INPUT, validation.error || 'Ogiltigt organisationsnummer');
  }

  try {
    // Hämta företagsinfo först
    const companyInfo = await fetchCompanyInfo(validation.cleanNumber);

    // Försök hämta årsredovisning - graceful hantering om den saknas
    let fullArsredovisning;
    try {
      fullArsredovisning = await fetchFullArsredovisning(validation.cleanNumber, index);
    } catch (arError) {
      const arMessage = arError instanceof Error ? arError.message : 'Okänt fel';

      // Om årsredovisning saknas, returnera grundläggande företagsinfo
      if (arMessage.includes('Inga årsredovisningar') || arMessage.includes('hittades inte')) {
        if (response_format === 'json') {
          return exportToJson({
            isError: false,
            company_info: companyInfo,
            arsredovisning: null,
            analysis_complete: false,
            reason: 'NO_ANNUAL_REPORT',
            message: 'Fullständig analys ej möjlig - företaget har inte lämnat årsredovisning ännu.',
            recommendation: 'Endast grundläggande företagsinformation tillgänglig.',
          });
        }

        // Returnera grundläggande info i textformat
        const lines = [
          `# Företagsanalys: ${companyInfo.namn}`,
          '',
          `**Organisationsnummer:** ${companyInfo.org_nummer}`,
          '',
          '⚠️ **Begränsad analys** - Årsredovisning saknas',
          '',
          '## Grundläggande företagsinformation',
          '',
          `**Organisationsform:** ${companyInfo.organisationsform}`,
          `**Registreringsdatum:** ${companyInfo.registreringsdatum}`,
          `**Status:** ${companyInfo.status}`,
        ];

        if (companyInfo.adress.utdelningsadress) {
          lines.push(`**Adress:** ${companyInfo.adress.utdelningsadress}, ${companyInfo.adress.postnummer || ''} ${companyInfo.adress.postort || ''}`);
        }

        if (companyInfo.verksamhet) {
          lines.push(`**Verksamhet:** ${companyInfo.verksamhet}`);
        }

        if (companyInfo.pagaende_konkurs) {
          lines.push('', `🔴 **VARNING:** Pågående konkurs sedan ${companyInfo.pagaende_konkurs.datum}`);
        }
        if (companyInfo.pagaende_likvidation) {
          lines.push('', `🟡 **VARNING:** Pågående likvidation sedan ${companyInfo.pagaende_likvidation.datum}`);
        }

        lines.push(
          '',
          '---',
          '',
          '_Fullständig analys med nyckeltal, styrelse och röda flaggor kräver årsredovisning._',
          '_Försök igen när företaget har lämnat in årsredovisning._'
        );

        return lines.join('\n');
      }

      throw arError;
    }

    const result: AnalysisResult = {
      company_info: companyInfo,
      arsredovisning: fullArsredovisning,
    };

    // Koncerndata om begärt och tillgängligt
    if (inkludera_koncern) {
      result.koncern_data = {
        har_koncernredovisning: false,
        meddelande: 'Koncernanalys kräver K3K-taxonomi',
      };
    }

    if (response_format === 'json') {
      return exportToJson(result);
    }

    return formatAnalysisText(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';

    if (message.includes('hittades inte') || message.includes('404')) {
      return handleError(ErrorCode.COMPANY_NOT_FOUND, `Företaget ${org_nummer} hittades inte`);
    }

    return handleError(ErrorCode.API_ERROR, message);
  }
}

/**
 * Formatera analysresultat som text.
 */
function formatAnalysisText(result: AnalysisResult): string {
  const { company_info, arsredovisning } = result;
  const lines: string[] = [];

  // Header
  lines.push(`# Företagsanalys: ${company_info.namn}`);
  lines.push('');
  lines.push(`**Organisationsnummer:** ${company_info.org_nummer}`);
  lines.push(`**Räkenskapsår:** ${arsredovisning.rakenskapsar_start} – ${arsredovisning.rakenskapsar_slut}`);
  lines.push('');

  // Status och varningar
  if (company_info.status !== 'Aktiv') {
    lines.push(`⚠️ **Status:** ${company_info.status}`);
    if (company_info.avregistreringsorsak) {
      lines.push(`   Orsak: ${company_info.avregistreringsorsak}`);
    }
    lines.push('');
  }

  if (company_info.pagaende_konkurs) {
    lines.push(`🔴 **PÅGÅENDE KONKURS** sedan ${company_info.pagaende_konkurs.datum}`);
    lines.push('');
  }

  if (company_info.pagaende_likvidation) {
    lines.push(`🟡 **PÅGÅENDE LIKVIDATION** sedan ${company_info.pagaende_likvidation.datum}`);
    lines.push('');
  }

  // Företagsinformation
  lines.push('## Företagsinformation');
  lines.push('');
  lines.push(`**Organisationsform:** ${company_info.organisationsform}`);
  lines.push(`**Registreringsdatum:** ${company_info.registreringsdatum}`);
  
  if (company_info.adress.utdelningsadress) {
    lines.push(`**Adress:** ${company_info.adress.utdelningsadress}, ${company_info.adress.postnummer} ${company_info.adress.postort}`);
  }
  
  if (company_info.verksamhet) {
    lines.push(`**Verksamhet:** ${company_info.verksamhet}`);
  }

  if (company_info.sni_koder.length > 0) {
    const sniStr = company_info.sni_koder.map(s => `${s.kod} (${s.klartext})`).join(', ');
    lines.push(`**SNI-koder:** ${sniStr}`);
  }
  lines.push('');

  // Röda flaggor (om några)
  if (arsredovisning.roda_flaggor.length > 0) {
    lines.push(formatRodaFlaggor(arsredovisning.roda_flaggor));
    lines.push('');
  }

  // Nyckeltal
  lines.push(formatNyckeltalTable(arsredovisning.nyckeltal, 'Nyckeltal'));
  lines.push('');

  // Styrelse
  if (arsredovisning.styrelse.length > 0) {
    lines.push(formatPersoner(arsredovisning.styrelse, 'Styrelse'));
    lines.push('');
  }

  // VD
  if (arsredovisning.vd) {
    lines.push(`**VD:** ${arsredovisning.vd.fornamn} ${arsredovisning.vd.efternamn}`);
    lines.push('');
  }

  // Revisorer
  if (arsredovisning.revisorer.length > 0) {
    lines.push(formatPersoner(arsredovisning.revisorer, 'Revisorer'));
    lines.push('');
  }

  // Flerårsöversikt
  if (arsredovisning.flerarsdata.length > 1) {
    lines.push('## Flerårsöversikt');
    lines.push('');
    lines.push('| Period | Omsättning | Resultat | Soliditet |');
    lines.push('|--------|------------|----------|-----------|');
    
    for (const data of arsredovisning.flerarsdata.slice(0, 4)) {
      const oms = data.nyckeltal.nettoomsattning 
        ? new Intl.NumberFormat('sv-SE').format(data.nyckeltal.nettoomsattning) 
        : '-';
      const res = data.nyckeltal.arets_resultat 
        ? new Intl.NumberFormat('sv-SE').format(data.nyckeltal.arets_resultat) 
        : '-';
      const sol = data.nyckeltal.soliditet 
        ? `${data.nyckeltal.soliditet.toFixed(1)}%` 
        : '-';
      
      lines.push(`| ${data.period} | ${oms} | ${res} | ${sol} |`);
    }
    lines.push('');
  }

  // Förvaltningsberättelse (sammanfattning)
  const fb = arsredovisning.forvaltningsberattelse;
  if (fb.verksamheten || fb.vasentliga_handelser) {
    lines.push('## Förvaltningsberättelse');
    lines.push('');
    
    if (fb.verksamheten) {
      const truncated = fb.verksamheten.length > 500 
        ? fb.verksamheten.slice(0, 500) + '...' 
        : fb.verksamheten;
      lines.push(`**Verksamheten:** ${truncated}`);
      lines.push('');
    }
    
    if (fb.vasentliga_handelser) {
      const truncated = fb.vasentliga_handelser.length > 300 
        ? fb.vasentliga_handelser.slice(0, 300) + '...' 
        : fb.vasentliga_handelser;
      lines.push(`**Väsentliga händelser:** ${truncated}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
