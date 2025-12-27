/**
 * Bolagsverket MCP Server - Company Service
 * Hämtar och strukturerar företagsinformation från API.
 */

import { fetchOrganisation } from './api-client.js';
import { cacheManager } from './cache-manager.js';
import { formatOrgNummer } from './validators.js';
import { getAvregistreringsorsakText, getOrganisationsformText, getPagaendeForfarandeText } from './code-lists.js';
import type { CompanyInfo, OrganisationResponse, DatakallaFel, OrganisationsNamn, SNIKod } from '../types/index.js';

/**
 * Hämta företagsinformation med caching.
 */
export async function fetchCompanyInfo(orgNummer: string): Promise<CompanyInfo> {
  // Kolla cache först
  const cached = cacheManager.get<CompanyInfo>('company_info', orgNummer);
  if (cached) {
    console.error(`[CompanyService] Cache-träff för ${orgNummer}`);
    return cached;
  }

  console.error(`[CompanyService] Hämtar företagsinfo för ${orgNummer}`);
  const data = await fetchOrganisation(orgNummer);
  const companyInfo = parseOrganisationResponse(data, orgNummer);

  // Spara i cache
  cacheManager.set('company_info', orgNummer, companyInfo);

  return companyInfo;
}

/**
 * Parsa API-svar till CompanyInfo.
 */
function parseOrganisationResponse(data: OrganisationResponse, orgNummer: string): CompanyInfo {
  const orgs = data.organisationer || [];
  
  if (orgs.length === 0) {
    throw new Error(`Företaget ${orgNummer} hittades inte`);
  }

  if (orgs.length > 1) {
    console.error(`[CompanyService] Identitetsbeteckning ${orgNummer} har ${orgs.length} registrerade organisationer`);
  }

  const org = orgs[0];
  const datakallaFel: DatakallaFel[] = [];

  // Hjälpfunktion för att kontrollera datakällfel
  const checkFel = (dataObj: { fel?: { typ: string; felBeskrivning: string }; dataproducent?: string } | undefined, faltnamn: string) => {
    if (dataObj?.fel) {
      datakallaFel.push({
        falt: faltnamn,
        typ: dataObj.fel.typ || 'OKÄNT',
        beskrivning: dataObj.fel.felBeskrivning || 'Okänt fel',
        dataproducent: dataObj.dataproducent || 'Okänd',
      });
    }
  };

  // Kontrollera fel
  checkFel(org.organisationsnamn, 'organisationsnamn');
  checkFel(org.organisationsform, 'organisationsform');
  checkFel(org.organisationsdatum, 'organisationsdatum');
  checkFel(org.avregistreradOrganisation, 'avregistreradOrganisation');
  checkFel(org.postadressOrganisation, 'postadressOrganisation');
  checkFel(org.verksamhetsbeskrivning, 'verksamhetsbeskrivning');
  checkFel(org.naringsgrenOrganisation, 'naringsgrenOrganisation');

  // Extrahera namn
  const namnData = org.organisationsnamn;
  const namnLista = namnData?.organisationsnamnLista || [];
  const namn = namnLista[0]?.namn || 'Okänt';

  // Alla namn
  const allaNamn: OrganisationsNamn[] = namnLista.map(n => ({
    namn: n.namn,
    typ: n.typ || 'FORETAGSNAMN',
  }));

  // Organisationsform
  const orgFormData = org.organisationsform;
  let orgFormKod = orgFormData?.organisationsform || '';

  // Fallback: härleda organisationsform från företagsnamnet om koden saknas
  if (!orgFormKod && namn) {
    const namnUpper = namn.toUpperCase();
    if (namnUpper.includes(' AB') || namnUpper.endsWith(' AB') || namnUpper.includes('AKTIEBOLAG')) {
      orgFormKod = 'AB';
    } else if (namnUpper.includes(' HB') || namnUpper.endsWith(' HB') || namnUpper.includes('HANDELSBOLAG')) {
      orgFormKod = 'HB';
    } else if (namnUpper.includes(' KB') || namnUpper.endsWith(' KB') || namnUpper.includes('KOMMANDITBOLAG')) {
      orgFormKod = 'KB';
    } else if (namnUpper.includes('EKONOMISK FÖRENING') || namnUpper.includes(' EK FÖR')) {
      orgFormKod = 'EK';
    } else if (namnUpper.includes('BOSTADSRÄTTSFÖRENING') || namnUpper.includes(' BRF')) {
      orgFormKod = 'BRF';
    }
    if (orgFormKod) {
      console.error(`[CompanyService] Härledde organisationsform ${orgFormKod} från företagsnamn`);
    }
  }

  const organisationsform = getOrganisationsformText(orgFormKod);
  const juridiskForm = orgFormData?.juridiskForm;

  // Datum
  const datumData = org.organisationsdatum;
  const registreringsdatum = datumData?.registreringsdatum || '';

  // Avregistrering
  const avregData = org.avregistreradOrganisation;
  const avregistreringsdatum = avregData?.avregistreringsdatum;
  const avregistreringsorsakKod = avregData?.orsak;
  const avregistreringsorsak = avregistreringsorsakKod 
    ? getAvregistreringsorsakText(avregistreringsorsakKod) 
    : undefined;

  // Status
  const status = avregistreringsdatum ? 'Avregistrerad' : 'Aktiv';

  // Adress - kontrollera flera möjliga adresskällor
  // Använd any-types för att hantera potentiella fält som inte finns i typedefinitionen
  const postadressData = org.postadressOrganisation as any;
  const besoksadressData = (org as any).besoksadressOrganisation;
  const kontaktadressData = (org as any).kontaktadressOrganisation;

  // Försök med postadress först, sedan besöksadress, sedan kontaktadress
  const primaryAdress = postadressData || besoksadressData || kontaktadressData;

  // Bygg adressobjekt med fallbacks
  const adress = {
    utdelningsadress: postadressData?.utdelningsadress ||
                      besoksadressData?.utdelningsadress ||
                      kontaktadressData?.utdelningsadress ||
                      postadressData?.gatuadress ||
                      besoksadressData?.gatuadress ||
                      primaryAdress?.adress,
    postnummer: postadressData?.postnummer ||
                besoksadressData?.postnummer ||
                kontaktadressData?.postnummer,
    postort: postadressData?.postort ||
             besoksadressData?.postort ||
             kontaktadressData?.postort ||
             postadressData?.ort ||
             besoksadressData?.ort,
    land: postadressData?.land || besoksadressData?.land || 'Sverige',
  };

  // Logga om adress saknas för felsökning
  if (!adress.utdelningsadress && !adress.postnummer && !adress.postort) {
    console.error(`[CompanyService] Varning: Ingen adress hittades för ${orgNummer}. API-svar innehöll:`, {
      harPostadress: !!postadressData,
      harBesoksadress: !!besoksadressData,
      harKontaktadress: !!kontaktadressData,
      postadressFalt: postadressData ? Object.keys(postadressData) : [],
    });
  }

  // Verksamhet
  const verksamhet = org.verksamhetsbeskrivning?.beskrivning;

  // SNI-koder - prova flera möjliga fältnamn
  const sniData = org.naringsgrenOrganisation ||
                  (org as any).naringsgrenOrg ||
                  (org as any).sniKoder;

  const rawSniLista = sniData?.naringsgrenLista ||
                      sniData?.sniLista ||
                      (sniData as any)?.koder ||
                      [];

  const sniKoder: SNIKod[] = rawSniLista.map((sni: any) => ({
    kod: sni.kod || sni.sniKod || sni.code || '',
    klartext: sni.beskrivning || sni.klartext || sni.description || sni.namn || '',
  })).filter((s: SNIKod) => s.kod);

  // Logga om SNI-koder saknas för felsökning
  if (sniKoder.length === 0 && sniData) {
    console.error(`[CompanyService] Varning: SNI-data finns men inga koder extraherades för ${orgNummer}. Fält:`,
      Object.keys(sniData));
  }

  // Säte
  const sate = org.sateOrganisation?.lan;

  // Pågående förfaranden
  const forfarandeData = org.pagandeAvvecklingsEllerOmstruktureringsforfarande;
  const forfarandeLista = forfarandeData?.forfarandeLista || [];

  let pagaendeKonkurs: { datum: string; typ: string } | undefined;
  let pagaendeLikvidation: { datum: string; typ: string } | undefined;

  for (const f of forfarandeLista) {
    const typText = getPagaendeForfarandeText(f.typ);
    if (f.typ === 'KK') {
      pagaendeKonkurs = { datum: f.datum || '', typ: typText };
    } else if (f.typ === 'LI') {
      pagaendeLikvidation = { datum: f.datum || '', typ: typText };
    }
  }

  // Reklamsparr
  const reklamsparr = org.organisationReklamsparr?.sparr;

  // Verksam organisation
  const verksamOrganisation = org.verksamOrganisation?.verksam;

  return {
    org_nummer: formatOrgNummer(orgNummer),
    namn,
    organisationsform,
    organisationsform_kod: orgFormKod,
    juridisk_form: juridiskForm,
    registreringsdatum,
    status,
    avregistreringsdatum,
    avregistreringsorsak,
    adress,
    verksamhet,
    sni_koder: sniKoder,
    sate,
    pagaende_konkurs: pagaendeKonkurs,
    pagaende_likvidation: pagaendeLikvidation,
    reklamsparr,
    verksam_organisation: verksamOrganisation,
    alla_namn: allaNamn,
    datakalla_fel: datakallaFel.length > 0 ? datakallaFel : undefined,
  };
}

/**
 * Kontrollera om företag är aktivt (inte avregistrerat).
 */
export function isActiveCompany(info: CompanyInfo): boolean {
  return info.status === 'Aktiv' && !info.pagaende_konkurs && !info.pagaende_likvidation;
}

/**
 * Formatera företagsinfo som text.
 */
export function formatCompanyInfoText(info: CompanyInfo): string {
  const lines: string[] = [
    `# ${info.namn}`,
    '',
    `**Organisationsnummer:** ${info.org_nummer}`,
    `**Organisationsform:** ${info.organisationsform}`,
  ];

  if (info.juridisk_form) {
    lines.push(`**Juridisk form:** ${info.juridisk_form}`);
  }

  lines.push(`**Registreringsdatum:** ${info.registreringsdatum}`);
  lines.push(`**Status:** ${info.status}`);

  if (info.avregistreringsdatum) {
    lines.push(`**Avregistreringsdatum:** ${info.avregistreringsdatum.slice(0, 10)}`);
    if (info.avregistreringsorsak) {
      lines.push(`**Avregistreringsorsak:** ${info.avregistreringsorsak}`);
    }
  }

  if (info.pagaende_konkurs) {
    lines.push('', `**⚠️ PÅGÅENDE KONKURS** (${info.pagaende_konkurs.datum})`);
  }

  if (info.pagaende_likvidation) {
    lines.push('', `**⚠️ PÅGÅENDE LIKVIDATION** (${info.pagaende_likvidation.datum})`);
  }

  if (info.adress.utdelningsadress) {
    lines.push('', '## Adress');
    lines.push(info.adress.utdelningsadress);
    lines.push(`${info.adress.postnummer || ''} ${info.adress.postort || ''}`);
  }

  if (info.sate) {
    lines.push(`**Säte:** ${info.sate}`);
  }

  if (info.verksamhet) {
    lines.push('', '## Verksamhet', info.verksamhet);
  }

  if (info.sni_koder.length > 0) {
    lines.push('', '## SNI-koder');
    for (const sni of info.sni_koder) {
      lines.push(`- **${sni.kod}**: ${sni.klartext}`);
    }
  }

  return lines.join('\n');
}
