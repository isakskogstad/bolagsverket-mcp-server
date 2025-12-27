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
 * Hämta nyckeltal med parservarningar.
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
    let arsredovisning;
    let parseWarnings: any[] = [];

    try {
      const result = await fetchAndParseArsredovisning(validation.cleanNumber, index);
      arsredovisning = result.arsredovisning;
      parseWarnings = result.parseWarnings;
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Okänt fel';

      // Graceful hantering om årsredovisning saknas
      if (errorMessage.includes('Inga årsredovisningar')) {
        if (response_format === 'json') {
          return JSON.stringify({
            isError: false,
            org_nummer: validation.cleanNumber,
            nyckeltal_available: false,
            reason: 'NO_ANNUAL_REPORT',
            message: 'Inga nyckeltal tillgängliga - företaget har inte lämnat årsredovisning ännu.',
            recommendation: 'Nyregistrerade företag eller företag som inte lämnat in digital årsredovisning visas inte.',
          }, null, 2);
        }

        return [
          `# Nyckeltal för ${org_nummer}`,
          '',
          '**Inga nyckeltal tillgängliga**',
          '',
          'Företaget har inte lämnat årsredovisning ännu.',
          '',
          '**Möjliga orsaker:**',
          '- Nyregistrerat företag som ännu inte haft bokslut',
          '- Företaget lämnar inte in digital årsredovisning',
          '- Stora börsbolag lämnar ofta in via annan kanal',
        ].join('\n');
      }

      throw fetchError;
    }

    // Kontrollera om vi har tillräckligt med data
    const nyckeltal = arsredovisning.nyckeltal;
    const hasData = Object.values(nyckeltal).some(v => v !== null && v !== undefined);

    if (!hasData) {
      // Returnera strukturerat fel om ingen data kunde parsas
      return handleError(ErrorCode.PARSE_ERROR,
        'Kunde inte extrahera nyckeltal från årsredovisningen. Dokumentet kan ha annorlunda format.',
        { index, parseWarnings }
      );
    }

    if (response_format === 'json') {
      return exportToJson({
        org_nummer: arsredovisning.org_nummer,
        foretag_namn: arsredovisning.foretag_namn,
        rakenskapsar: {
          start: arsredovisning.rakenskapsar_start,
          slut: arsredovisning.rakenskapsar_slut,
        },
        nyckeltal: arsredovisning.nyckeltal,
        // Inkludera varningar om det finns några (P1-E)
        ...(parseWarnings && parseWarnings.length > 0 ? { parse_warnings: parseWarnings } : {}),
      });
    }

    const lines = [
      `# Nyckeltal för ${arsredovisning.foretag_namn}`,
      '',
      `**Räkenskapsår:** ${arsredovisning.rakenskapsar_start} – ${arsredovisning.rakenskapsar_slut}`,
      '',
      formatNyckeltalTable(arsredovisning.nyckeltal),
    ];

    // Lägg till parservarningar i textformat
    if (parseWarnings && parseWarnings.length > 0) {
      lines.push('', '---', '');
      lines.push('**⚠️ Parservarningar:**');
      for (const warning of parseWarnings) {
        lines.push(`- _${warning.beskrivning}_`);
      }
    }

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
    let arsredovisning;

    try {
      const result = await fetchAndParseArsredovisning(validation.cleanNumber, index);
      arsredovisning = result.arsredovisning;
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Okänt fel';

      // Graceful hantering om årsredovisning saknas
      if (errorMessage.includes('Inga årsredovisningar')) {
        return [
          `# Styrelse och ledning för ${org_nummer}`,
          '',
          '**Information ej tillgänglig**',
          '',
          'Företaget har inte lämnat årsredovisning ännu, vilket krävs för att visa styrelseuppgifter.',
          '',
          '_För aktuell styrelseinfo, se Bolagsverkets register direkt._',
        ].join('\n');
      }

      throw fetchError;
    }

    const lines = [`# Styrelse och ledning för ${arsredovisning.foretag_namn}`, ''];

    if (arsredovisning.personer.length === 0) {
      lines.push('_Inga personer hittades i årsredovisningen._');
      lines.push('', '_Detta kan bero på att dokumentet har annorlunda struktur eller att personuppgifter inte är inkluderade._');
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
        const fullNamn = [p.fornamn, p.efternamn].filter(Boolean).join(' ').trim();
        lines.push(`- **${fullNamn || 'Namn ej tillgängligt'}** (${p.roll})`);
      }
      lines.push('');
    }

    if (revisorer.length > 0) {
      lines.push('## Revisorer', '');
      for (const p of revisorer) {
        const fullNamn = [p.fornamn, p.efternamn].filter(Boolean).join(' ').trim();
        lines.push(`- **${fullNamn || 'Namn ej tillgängligt'}** (${p.roll})`);
      }
      lines.push('');
    }

    if (ovriga.length > 0) {
      lines.push('## Övriga', '');
      for (const p of ovriga) {
        const fullNamn = [p.fornamn, p.efternamn].filter(Boolean).join(' ').trim();
        lines.push(`- **${fullNamn || 'Namn ej tillgängligt'}** (${p.roll})`);
      }
    }

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';

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

    // VIKTIGT: Alltid returnera strukturerat JSON-svar för response_format=json
    // även när inga dokument finns (P1-D typstabilitet)
    if (response_format === 'json') {
      const out = dokument.map(d => ({
        dokumentId: d.dokumentId || d.id,
        filformat: d.filformat,
        rapporteringsperiodTom: d.rapporteringsperiodTom || d.rakenskapsperiod?.till,
        registreringstidpunkt: d.registreringstidpunkt || d.inlamningsdatum,
      }));

      // Lägg till coverage-varning för stora bolag (P0-C)
      let coverage_note: string | undefined;
      if (dokument.length === 0) {
        coverage_note = 'Inga årsredovisningar hittades. Stora börsnoterade bolag (t.ex. Ericsson, H&M, Spotify) lämnar in via annan kanal och finns ej i Bolagsverkets öppna API för digitala årsredovisningar.';
      }

      return exportToJson({
        org_nummer: validation.cleanNumber,
        antal: out.length,
        dokument: out,
        ...(coverage_note ? { coverage_note } : {}),
      });
    }

    // Text-format
    if (dokument.length === 0) {
      const lines = [
        `# Årsredovisningar för ${org_nummer}`,
        '',
        '**Inga årsredovisningar hittades.**',
        '',
        '## Möjliga orsaker:',
        '- Stora börsnoterade bolag (t.ex. Ericsson, H&M, Spotify) lämnar in via annan kanal',
        '- Företaget har inte lämnat in digital årsredovisning ännu',
        '- Företaget använder ett filformat som inte indexeras i detta API',
        '- Nyregistrerat företag som ännu ej haft sitt första bokslut',
        '',
        '_För stora bolag, sök istället på respektive bolags hemsida eller finansiella databaser som Bloomberg/Reuters._',
      ];
      return lines.join('\n');
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
