/**
 * Bolagsverket MCP Server - Basic Info Tool
 * Hämtar grundläggande företagsinformation.
 */

import { OrgNummerInputSchema, safeParseInput } from './schemas.js';
import { fetchCompanyInfo, formatCompanyInfoText } from '../lib/company-service.js';
import { handleError } from '../lib/errors.js';
import { ErrorCode } from '../types/index.js';
import { validateOrgNummer } from '../lib/validators.js';

export const TOOL_NAME = 'bolagsverket_get_basic_info';

export const TOOL_DESCRIPTION = `Hämtar grundläggande företagsinformation från Bolagsverket.

Inkluderar:
- Företagsnamn och organisationsform
- Registreringsdatum och status
- Adress och säte
- Verksamhetsbeskrivning
- SNI-koder
- Eventuella pågående förfaranden (konkurs, likvidation)`;

export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    org_nummer: {
      type: 'string',
      description: 'Organisationsnummer (10 eller 12 siffror)',
    },
  },
  required: ['org_nummer'],
};

/**
 * Hämta grundläggande företagsinfo.
 */
export async function getBasicInfo(args: unknown): Promise<string> {
  const parsed = safeParseInput(OrgNummerInputSchema, args);
  if (!parsed.success) {
    return handleError(ErrorCode.INVALID_INPUT, parsed.error);
  }

  const { org_nummer } = parsed.data;

  const validation = validateOrgNummer(org_nummer);
  if (!validation.valid) {
    return handleError(ErrorCode.INVALID_INPUT, validation.error || 'Ogiltigt organisationsnummer');
  }

  try {
    const companyInfo = await fetchCompanyInfo(validation.cleanNumber);
    return formatCompanyInfoText(companyInfo);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    
    if (message.includes('hittades inte') || message.includes('404')) {
      return handleError(ErrorCode.COMPANY_NOT_FOUND, `Företaget ${org_nummer} hittades inte`);
    }
    
    return handleError(ErrorCode.API_ERROR, message);
  }
}

// ============================================================================
// Granulära verktyg
// ============================================================================

export const ADDRESS_TOOL_NAME = 'bolagsverket_get_address';
export const ADDRESS_TOOL_DESCRIPTION = 'Hämtar endast adressinformation för ett företag.';

export async function getAddress(args: unknown): Promise<string> {
  const parsed = safeParseInput(OrgNummerInputSchema, args);
  if (!parsed.success) {
    return handleError(ErrorCode.INVALID_INPUT, parsed.error);
  }

  const validation = validateOrgNummer(parsed.data.org_nummer);
  if (!validation.valid) {
    return handleError(ErrorCode.INVALID_INPUT, validation.error || 'Ogiltigt organisationsnummer');
  }

  try {
    const info = await fetchCompanyInfo(validation.cleanNumber);

    const lines = [`# Adress för ${info.namn}`, ''];

    // Kontrollera om vi har någon adressinformation alls
    const harUtdelningsadress = !!info.adress.utdelningsadress;
    const harPostnummer = !!info.adress.postnummer;
    const harPostort = !!info.adress.postort;
    const harSate = !!info.sate;

    if (!harUtdelningsadress && !harPostnummer && !harPostort && !harSate) {
      // Returnera strukturerat JSON-svar vid saknad adress
      return JSON.stringify({
        org_nummer: info.org_nummer,
        foretag_namn: info.namn,
        adress: null,
        sate: null,
        reason: 'NO_ADDRESS_DATA',
        message: 'Ingen adressinformation finns registrerad för detta företag hos Bolagsverket.',
        hint: 'Adressinformation kan saknas för myndigheter, vissa äldre registreringar, eller om företaget inte lämnat in adressuppgifter.'
      }, null, 2);
    }

    // Bygg adressblock
    if (harUtdelningsadress) {
      lines.push(info.adress.utdelningsadress!);
    }

    const postnrOrt = [info.adress.postnummer, info.adress.postort]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (postnrOrt) {
      lines.push(postnrOrt);
    }

    if (info.adress.land && info.adress.land !== 'Sverige') {
      lines.push(info.adress.land);
    }

    // Lägg till säte om tillgängligt
    if (harSate) {
      lines.push('', `**Säte:** ${info.sate}`);
    }

    // Om vi bara har säte men ingen annan adress, notera det
    if (!harUtdelningsadress && !harPostnummer && !harPostort && harSate) {
      lines.push('', '_Endast säte registrerat, ingen fullständig adress._');
    }

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return handleError(ErrorCode.API_ERROR, message);
  }
}

export const VERKSAMHET_TOOL_NAME = 'bolagsverket_get_verksamhet';
export const VERKSAMHET_TOOL_DESCRIPTION = 'Hämtar verksamhetsbeskrivning och SNI-koder för ett företag.';

export async function getVerksamhet(args: unknown): Promise<string> {
  const parsed = safeParseInput(OrgNummerInputSchema, args);
  if (!parsed.success) {
    return handleError(ErrorCode.INVALID_INPUT, parsed.error);
  }

  const validation = validateOrgNummer(parsed.data.org_nummer);
  if (!validation.valid) {
    return handleError(ErrorCode.INVALID_INPUT, validation.error || 'Ogiltigt organisationsnummer');
  }

  try {
    const info = await fetchCompanyInfo(validation.cleanNumber);
    
    const lines = [`# Verksamhet för ${info.namn}`, ''];

    if (info.verksamhet) {
      lines.push('## Verksamhetsbeskrivning', '', info.verksamhet, '');
    } else {
      lines.push('_Ingen verksamhetsbeskrivning registrerad._', '');
    }

    if (info.sni_koder.length > 0) {
      lines.push('## SNI-koder', '');
      for (const sni of info.sni_koder) {
        lines.push(`- **${sni.kod}**: ${sni.klartext}`);
      }
    }

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return handleError(ErrorCode.API_ERROR, message);
  }
}

export const STATUS_TOOL_NAME = 'bolagsverket_get_company_status';
export const STATUS_TOOL_DESCRIPTION = 'Kontrollerar företagets status (aktivt, avregistrerat, konkurs, likvidation).';

export async function getCompanyStatus(args: unknown): Promise<string> {
  const parsed = safeParseInput(OrgNummerInputSchema, args);
  if (!parsed.success) {
    return handleError(ErrorCode.INVALID_INPUT, parsed.error);
  }

  const validation = validateOrgNummer(parsed.data.org_nummer);
  if (!validation.valid) {
    return handleError(ErrorCode.INVALID_INPUT, validation.error || 'Ogiltigt organisationsnummer');
  }

  try {
    const info = await fetchCompanyInfo(validation.cleanNumber);
    
    const lines = [`# Status för ${info.namn}`, ''];
    
    // Huvudstatus
    const statusIcon = info.status === 'Aktiv' ? '✅' : '❌';
    lines.push(`${statusIcon} **Status:** ${info.status}`);

    if (info.avregistreringsdatum) {
      lines.push(`**Avregistreringsdatum:** ${info.avregistreringsdatum.slice(0, 10)}`);
      if (info.avregistreringsorsak) {
        lines.push(`**Orsak:** ${info.avregistreringsorsak}`);
      }
    }

    // Varningar
    if (info.pagaende_konkurs) {
      lines.push('', `🔴 **PÅGÅENDE KONKURS**`);
      lines.push(`   Typ: ${info.pagaende_konkurs.typ}`);
      lines.push(`   Datum: ${info.pagaende_konkurs.datum}`);
    }

    if (info.pagaende_likvidation) {
      lines.push('', `🟡 **PÅGÅENDE LIKVIDATION**`);
      lines.push(`   Typ: ${info.pagaende_likvidation.typ}`);
      lines.push(`   Datum: ${info.pagaende_likvidation.datum}`);
    }

    // Metadata
    lines.push('', '---');
    lines.push(`**Registreringsdatum:** ${info.registreringsdatum}`);
    lines.push(`**Organisationsform:** ${info.organisationsform}`);
    
    if (info.verksam_organisation !== undefined) {
      lines.push(`**Verksam organisation:** ${info.verksam_organisation ? 'Ja' : 'Nej'}`);
    }

    if (info.reklamsparr) {
      lines.push(`**Reklamsparr:** Ja`);
    }

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel';
    return handleError(ErrorCode.API_ERROR, message);
  }
}
