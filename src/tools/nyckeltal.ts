/**
 * Bolagsverket MCP Server - Nyckeltal Tool
 * Hämtar finansiella nyckeltal från årsredovisning.
 */

import { FinansiellDataInputSchema, safeParseInput } from './schemas.js';
import { fetchAndParseArsredovisning, fetchDokumentlistaForOrg } from '../lib/arsredovisning-service.js';
import { handleError } from '../lib/errors.js';
import { ErrorCode } from '../types/index.js';
import { validateOrgNummer } from '../lib/validators.js';
import { formatNyckeltalTable, exportToJson } from '../lib/formatting.js';

export const TOOL_NAME = 'bolagsverket_get_nyckeltal';

export const TOOL_DESCRIPTION = `Hämtar finansiella nyckeltal från ett företags årsredovisning.

Nyckeltal som hämtas:
- Nettoomsättning
- Rörelseresultat
- Resultat efter finansiella poster
- Årets resultat
- Eget kapital
- Balansomslutning
- Soliditet (%)
- Vinstmarginal (%)
- Räntabilitet på eget kapital (ROE)
- Antal anställda`;

export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    org_nummer: {
      type: 'string',
      description: 'Organisationsnummer (10 eller 12 siffror)',
    },
    index: {
      type: 'number',
      description: 'Index för årsredovisning (0 = senaste)',
      default: 0,
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

/**
 * Hämta nyckeltal.
 */
export async function getNyckeltal(args: unknown): Promise<string> {
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
    const { arsredovisning } = await fetchAndParseArsredovisning(
      validation.cleanNumber,
      index
    );

    if (response_format === 'json') {
      return exportToJson({
        org_nummer: arsredovisning.org_nummer,
        foretag_namn: arsredovisning.foretag_namn,
        rakenskapsar: {
          start: arsredovisning.rakenskapsar_start,
          slut: arsredovisning.rakenskapsar_slut,
        },
        nyckeltal: arsredovisning.nyckeltal,
      });
    }

    const lines = [
      `# Nyckeltal för ${arsredovisning.foretag_namn}`,
      '',
      `**Räkenskapsår:** ${arsredovisning.rakenskapsar_start} – ${arsredovisning.rakenskapsar_slut}`,
      '',
      formatNyckeltalTable(arsredovisning.nyckeltal),
    ];

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    
    if (message.includes('Inga årsredovisningar')) {
      return handleError(ErrorCode.ANNUAL_REPORT_NOT_FOUND, message);
    }
    
    return handleError(ErrorCode.API_ERROR, message);
  }
}

// ============================================================================
// Styrelse-tool
// ============================================================================

export const STYRELSE_TOOL_NAME = 'bolagsverket_get_styrelse';
export const STYRELSE_TOOL_DESCRIPTION = 'Hämtar styrelse, VD och revisorer från årsredovisningen.';

export async function getStyrelse(args: unknown): Promise<string> {
  const parsed = safeParseInput(FinansiellDataInputSchema, args);
  if (!parsed.success) {
    return handleError(ErrorCode.INVALID_INPUT, parsed.error);
  }

  const { org_nummer, index } = parsed.data;

  const validation = validateOrgNummer(org_nummer);
  if (!validation.valid) {
    return handleError(ErrorCode.INVALID_INPUT, validation.error || 'Ogiltigt organisationsnummer');
  }

  try {
    const { arsredovisning } = await fetchAndParseArsredovisning(validation.cleanNumber, index);

    const lines = [`# Styrelse och ledning för ${arsredovisning.foretag_namn}`, ''];

    if (arsredovisning.personer.length === 0) {
      lines.push('_Inga personer hittades i årsredovisningen._');
      return lines.join('\n');
    }

    // Gruppera per roll
    const styrelse: typeof arsredovisning.personer = [];
    const revisorer: typeof arsredovisning.personer = [];
    const ovriga: typeof arsredovisning.personer = [];

    for (const person of arsredovisning.personer) {
      const rollLower = person.roll.toLowerCase();
      if (rollLower.includes('revisor')) {
        revisorer.push(person);
      } else if (rollLower.includes('ordförande') || rollLower.includes('ledamot') || rollLower.includes('suppleant')) {
        styrelse.push(person);
      } else {
        ovriga.push(person);
      }
    }

    if (styrelse.length > 0) {
      lines.push('## Styrelse', '');
      for (const p of styrelse) {
        lines.push(`- **${p.fornamn} ${p.efternamn}** (${p.roll})`);
      }
      lines.push('');
    }

    if (revisorer.length > 0) {
      lines.push('## Revisorer', '');
      for (const p of revisorer) {
        lines.push(`- **${p.fornamn} ${p.efternamn}** (${p.roll})`);
      }
      lines.push('');
    }

    if (ovriga.length > 0) {
      lines.push('## Övriga', '');
      for (const p of ovriga) {
        lines.push(`- **${p.fornamn} ${p.efternamn}** (${p.roll})`);
      }
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
// Dokumentlista-tool
// ============================================================================

export const DOKUMENTLISTA_TOOL_NAME = 'bolagsverket_list_arsredovisningar';
export const DOKUMENTLISTA_TOOL_DESCRIPTION = 'Listar alla tillgängliga årsredovisningar för ett företag.';

export async function listArsredovisningar(args: unknown): Promise<string> {
  const parsed = safeParseInput(FinansiellDataInputSchema, args);
  if (!parsed.success) {
    return handleError(ErrorCode.INVALID_INPUT, parsed.error);
  }

  const { org_nummer, response_format } = parsed.data;

  const validation = validateOrgNummer(org_nummer);
  if (!validation.valid) {
    return handleError(ErrorCode.INVALID_INPUT, validation.error || 'Ogiltigt organisationsnummer');
  }

  try {
    const dokument = await fetchDokumentlistaForOrg(validation.cleanNumber);

    if (dokument.length === 0) {
      return `Inga årsredovisningar hittades för ${org_nummer}`;
    }

    if (response_format === 'json') {
      // Exponera ett stabilt schema som matchar tidigare klientförväntningar
      // (dokumentId/rapporteringsperiodTom/registreringstidpunkt).
      const out = dokument.map(d => ({
        dokumentId: d.dokumentId || d.id,
        filformat: d.filformat,
        rapporteringsperiodTom: d.rapporteringsperiodTom || d.rakenskapsperiod?.till,
        registreringstidpunkt: d.registreringstidpunkt || d.inlamningsdatum,
      }));
      return exportToJson({ org_nummer, antal: out.length, dokument: out });
    }

    const lines = [
      `# Årsredovisningar för ${org_nummer}`,
      '',
      `Totalt ${dokument.length} årsredovisningar tillgängliga.`,
      '',
      '| Index | Räkenskapsår | Inlämningsdatum |',
      '|-------|--------------|-----------------|',
    ];

    dokument.forEach((dok, i) => {
      const fran = dok.rakenskapsperiod?.fran || '';
      const till = dok.rakenskapsperiod?.till || '';
      const period = fran && till ? `${fran} – ${till}` : (till || fran || '-');
      const inlamning = (dok.inlamningsdatum || dok.registreringstidpunkt || '').slice(0, 10) || '-';
      lines.push(`| ${i} | ${period} | ${inlamning} |`);
    });

    lines.push('', '_Använd index-parametern för att välja en specifik årsredovisning._');

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';

    // Konsekvent felkodshantering: samma rotorsak ger samma felkod
    if (message.includes('hittades inte') || message.includes('404')) {
      return handleError(ErrorCode.COMPANY_NOT_FOUND, message);
    }

    return handleError(ErrorCode.API_ERROR, message);
  }
}
