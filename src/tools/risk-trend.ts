/**
 * Bolagsverket MCP Server - Risk Check Tool
 * Analyserar röda flaggor och varningar.
 */

import { FinansiellDataInputSchema, TrendInputSchema, safeParseInput } from './schemas.js';
import { fetchFullArsredovisning, fetchTrendData } from '../lib/arsredovisning-service.js';
import { fetchCompanyInfo } from '../lib/company-service.js';
import { handleError } from '../lib/errors.js';
import { ErrorCode } from '../types/index.js';
import { validateOrgNummer } from '../lib/validators.js';
import { formatRodaFlaggor, exportToJson, formatAmount, calculateGrowth, formatGrowth } from '../lib/formatting.js';
import type { RodFlagga } from '../types/index.js';

export const RISK_TOOL_NAME = 'bolagsverket_risk_check';

export const RISK_TOOL_DESCRIPTION = `Analyserar ett företag för röda flaggor och varningar.

Kontrollerar:
- Negativt eget kapital
- Låg soliditet (<10%)
- Förlust
- Sjunkande omsättning
- Negativ vinstmarginal
- Pågående konkurs eller likvidation
- Revisionsanmärkningar`;

export const RISK_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    org_nummer: {
      type: 'string',
      description: 'Organisationsnummer',
    },
    index: {
      type: 'number',
      description: 'Index för årsredovisning (0 = senaste)',
      default: 0,
    },
    response_format: {
      type: 'string',
      enum: ['text', 'json'],
      default: 'text',
    },
  },
  required: ['org_nummer'],
};

/**
 * Utför riskanalys.
 */
export async function riskCheck(args: unknown): Promise<string> {
  const parsed = safeParseInput(FinansiellDataInputSchema, args);
  if (!parsed.success) {
    return handleError(ErrorCode.INVALID_INPUT, parsed.error);
  }

  const { org_nummer, index, response_format } = parsed.data;

  const validation = validateOrgNummer(org_nummer);
  if (!validation.valid) {
    return handleError(ErrorCode.INVALID_INPUT, validation.error || 'Ogiltigt organisationsnummer');
  }

  try {
    // Hämta företagsinfo och årsredovisning
    const [companyInfo, fullArsredovisning] = await Promise.all([
      fetchCompanyInfo(validation.cleanNumber),
      fetchFullArsredovisning(validation.cleanNumber, index),
    ]);

    // Lägg till företagsnivå-flaggor
    const allFlaggor: RodFlagga[] = [...fullArsredovisning.roda_flaggor];

    // Kontrollera pågående förfaranden
    if (companyInfo.pagaende_konkurs) {
      allFlaggor.unshift({
        typ: 'PAGAENDE_KONKURS',
        allvarlighet: 'kritisk',
        beskrivning: `Företaget har pågående konkurs sedan ${companyInfo.pagaende_konkurs.datum}`,
        rekommendation: 'Avråd från alla transaktioner med detta företag',
      });
    }

    if (companyInfo.pagaende_likvidation) {
      allFlaggor.unshift({
        typ: 'PAGAENDE_LIKVIDATION',
        allvarlighet: 'kritisk',
        beskrivning: `Företaget är under likvidation sedan ${companyInfo.pagaende_likvidation.datum}`,
        rekommendation: 'Verifiera om företaget kan fullgöra sina åtaganden',
      });
    }

    if (companyInfo.status !== 'Aktiv') {
      allFlaggor.unshift({
        typ: 'EJ_AKTIVT',
        allvarlighet: 'kritisk',
        beskrivning: `Företaget är ${companyInfo.status.toLowerCase()}`,
        varde: companyInfo.avregistreringsorsak,
      });
    }

    if (response_format === 'json') {
      return exportToJson({
        org_nummer: companyInfo.org_nummer,
        foretag_namn: companyInfo.namn,
        antal_flaggor: allFlaggor.length,
        kritiska: allFlaggor.filter(f => f.allvarlighet === 'kritisk').length,
        varningar: allFlaggor.filter(f => f.allvarlighet === 'varning').length,
        info: allFlaggor.filter(f => f.allvarlighet === 'info').length,
        flaggor: allFlaggor,
      });
    }

    const lines = [
      `# Riskanalys för ${companyInfo.namn}`,
      '',
      `**Organisationsnummer:** ${companyInfo.org_nummer}`,
      `**Räkenskapsår:** ${fullArsredovisning.rakenskapsar_slut}`,
      '',
    ];

    if (allFlaggor.length === 0) {
      lines.push('✅ **Inga röda flaggor identifierade.**');
      lines.push('');
      lines.push('Företaget visar inga uppenbara varningssignaler baserat på tillgänglig data.');
    } else {
      // Sammanfattning
      const kritiska = allFlaggor.filter(f => f.allvarlighet === 'kritisk').length;
      const varningar = allFlaggor.filter(f => f.allvarlighet === 'varning').length;
      
      lines.push('## Sammanfattning');
      lines.push('');
      lines.push(`- 🔴 Kritiska: ${kritiska}`);
      lines.push(`- 🟡 Varningar: ${varningar}`);
      lines.push('');
      
      lines.push(formatRodaFlaggor(allFlaggor));
    }

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';

    // Konsekvent felkodshantering: samma rotorsak ger samma felkod
    if (message.includes('Inga årsredovisningar') || message.includes('årsredovisning')) {
      return handleError(ErrorCode.ANNUAL_REPORT_NOT_FOUND, message);
    }
    if (message.includes('hittades inte') || message.includes('404')) {
      return handleError(ErrorCode.COMPANY_NOT_FOUND, message);
    }

    return handleError(ErrorCode.API_ERROR, message);
  }
}

// ============================================================================
// Trend Tool
// ============================================================================

export const TREND_TOOL_NAME = 'bolagsverket_trend';

export const TREND_TOOL_DESCRIPTION = `Analyserar ett företags finansiella trend över flera år.

Visar:
- Historisk utveckling av nyckeltal
- Tillväxttakt per nyckeltal
- Enkel prognos baserad på trend`;

export const TREND_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    org_nummer: {
      type: 'string',
      description: 'Organisationsnummer',
    },
    antal_ar: {
      type: 'number',
      description: 'Antal år att analysera (2-10)',
      default: 4,
    },
  },
  required: ['org_nummer'],
};

/**
 * Utför trendanalys.
 */
export async function trendAnalysis(args: unknown): Promise<string> {
  const parsed = safeParseInput(TrendInputSchema, args);
  if (!parsed.success) {
    return handleError(ErrorCode.INVALID_INPUT, parsed.error);
  }

  const { org_nummer, antal_ar } = parsed.data;

  const validation = validateOrgNummer(org_nummer);
  if (!validation.valid) {
    return handleError(ErrorCode.INVALID_INPUT, validation.error || 'Ogiltigt organisationsnummer');
  }

  try {
    const [companyInfo, trendData] = await Promise.all([
      fetchCompanyInfo(validation.cleanNumber),
      fetchTrendData(validation.cleanNumber, antal_ar),
    ]);

    if (trendData.length < 2) {
      return handleError(
        ErrorCode.ANNUAL_REPORT_NOT_FOUND,
        `Minst 2 årsredovisningar krävs för trendanalys. Hittade endast ${trendData.length}.`
      );
    }

    // Bygg trendanalys-objekt
    const perioder = trendData.map(d => d.period);
    const serier: Record<string, (number | null)[]> = {
      nettoomsattning: trendData.map(d => d.nyckeltal.nettoomsattning ?? null),
      arets_resultat: trendData.map(d => d.nyckeltal.arets_resultat ?? null),
      eget_kapital: trendData.map(d => d.nyckeltal.eget_kapital ?? null),
      soliditet: trendData.map(d => d.nyckeltal.soliditet ?? null),
      antal_anstallda: trendData.map(d => d.nyckeltal.antal_anstallda ?? null),
    };

    // Beräkna tillväxt (senaste vs näst senaste)
    const tillvaxt: Record<string, number | null> = {};
    for (const [key, values] of Object.entries(serier)) {
      tillvaxt[key] = calculateGrowth(values[0], values[1]);
    }

    // Prognos med guardrails för extremvärden (P2)
    const prognos: Record<string, number | null> = {};
    const prognosVarningar: string[] = [];

    for (const [key, values] of Object.entries(serier)) {
      if (values[0] !== null && values[1] !== null && tillvaxt[key] !== null) {
        const growth = tillvaxt[key]!;

        // Guardrails för extrema prognoser
        // 1. Soliditet: Ingen prognos om värdet är negativt eller nära 0
        if (key === 'soliditet') {
          if (values[0] <= 0 || values[1] <= 0) {
            prognos[key] = null;
            prognosVarningar.push('Soliditetsprognos ej möjlig pga negativt/noll basvärde');
            continue;
          }
          // Begränsa soliditet till rimligt intervall (-100% till 100%)
          const prognosVarde = values[0] * (1 + growth / 100);
          if (Math.abs(prognosVarde) > 100) {
            prognos[key] = null;
            prognosVarningar.push(`Soliditetsprognos (${prognosVarde.toFixed(0)}%) utanför rimligt intervall`);
            continue;
          }
        }

        // 2. Begränsa tillväxt till max ±500% för att undvika extrema extrapoleringar
        if (Math.abs(growth) > 500) {
          prognos[key] = null;
          prognosVarningar.push(`${key}: Tillväxten (${growth.toFixed(0)}%) är för extrem för prognos`);
          continue;
        }

        // 3. Specialhantering för negativa -> positiva övergångar
        const prognosVarde = values[0] * (1 + growth / 100);

        // Om vi går från positivt till negativt eller tvärtom med stor magnitude, skippa
        if (Math.sign(values[0]) !== Math.sign(prognosVarde) && Math.abs(prognosVarde) > Math.abs(values[0]) * 2) {
          prognos[key] = null;
          prognosVarningar.push(`${key}: Teckenändring med stor differens - prognos osäker`);
          continue;
        }

        prognos[key] = Math.round(prognosVarde);
      } else {
        prognos[key] = null;
      }
    }

    const lines = [
      `# Trendanalys för ${companyInfo.namn}`,
      '',
      `**Analyserade perioder:** ${trendData.length}`,
      '',
      '## Historisk utveckling',
      '',
      '| Nyckeltal | ' + perioder.join(' | ') + ' | Tillväxt |',
      '|-----------|' + perioder.map(() => '------:').join('|') + '|-------:|',
    ];

    const labels: Record<string, string> = {
      nettoomsattning: 'Omsättning',
      arets_resultat: 'Resultat',
      eget_kapital: 'Eget kapital',
      soliditet: 'Soliditet',
      antal_anstallda: 'Anställda',
    };

    for (const [key, values] of Object.entries(serier)) {
      const label = labels[key] || key;
      const formatted = values.map(v => {
        if (v === null) return '-';
        if (key === 'soliditet') return `${v.toFixed(1)}%`;
        if (key === 'antal_anstallda') return String(v);
        return formatAmount(v);
      });
      const growth = formatGrowth(tillvaxt[key]);
      lines.push(`| ${label} | ${formatted.join(' | ')} | ${growth} |`);
    }

    lines.push('');
    lines.push('## Prognos (enkel linjär)');
    lines.push('');
    lines.push('_Baserat på senaste årets tillväxttakt:_');
    lines.push('');

    for (const [key, value] of Object.entries(prognos)) {
      if (value !== null) {
        const label = labels[key] || key;
        const formatted = key === 'soliditet' ? `${value.toFixed(1)}%` : formatAmount(value);
        lines.push(`- **${label}:** ${formatted}`);
      }
    }

    // Lägg till prognosvarningar om det finns några
    if (prognosVarningar.length > 0) {
      lines.push('');
      lines.push('**⚠️ Prognosvarningar:**');
      for (const varning of prognosVarningar) {
        lines.push(`- _${varning}_`);
      }
    }

    lines.push('');
    lines.push('_Observera: Prognosen är en enkel extrapolering och tar inte hänsyn till branschfaktorer eller makroekonomi._');

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';

    // Konsekvent felkodshantering: samma rotorsak ger samma felkod
    if (message.includes('Inga årsredovisningar') || message.includes('årsredovisning')) {
      return handleError(ErrorCode.ANNUAL_REPORT_NOT_FOUND, message);
    }
    if (message.includes('hittades inte') || message.includes('404')) {
      return handleError(ErrorCode.COMPANY_NOT_FOUND, message);
    }

    return handleError(ErrorCode.API_ERROR, message);
  }
}
