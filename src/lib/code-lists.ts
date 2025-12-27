/**
 * Bolagsverket MCP Server - Kodlistor
 * Svenska kodlistor enligt Bolagsverkets API-dokumentation.
 */

// =============================================================================
// Avregistreringsorsak
// =============================================================================

export const AVREGISTRERINGSORSAK: Record<string, string> = {
  'AKEJH': 'Aktiekapitalet inte höjts',
  'ARSEED': 'Årsredovisning saknas',
  'AVREG': 'Avregistrerad',
  'BABAKEJH': 'Ombildat till bankaktiebolag eller aktiekapitalet inte höjts',
  'DELAV': 'Delning',
  'DOM': 'Beslut av domstol',
  'FUAV': 'Fusion',
  'GROMAV': 'Gränsöverskridande ombildning',
  'KKAV': 'Konkurs',
  'LIAV': 'Likvidation',
  'NYINN': 'Ny innehavare',
  'OMAV': 'Ombildning',
  'OMBAB': 'Ombildat till bankaktiebolag',
  'OVERK': 'Overksamhet',
  'UTLKKLI': 'Det utländska företagets likvidation eller konkurs',
  'VERKUPP': 'Verksamheten har upphört',
  'VDSAK': 'Verkställande direktör saknas',
};

// =============================================================================
// Organisationsform
// =============================================================================

export const ORGANISATIONSFORM: Record<string, string> = {
  'AB': 'Aktiebolag',
  'BAB': 'Bankaktiebolag',
  'BF': 'Bostadsförening',
  'BFL': 'Utländsk banks filial',
  'BRF': 'Bostadsrättsförening',
  'E': 'Enskild näringsverksamhet',
  'EB': 'Enkla bolag',
  'EEIG': 'Europeisk ekonomisk intressegruppering',
  'EGTS': 'Europeiska grupperingar för territoriellt samarbete',
  'EK': 'Ekonomisk förening',
  'FAB': 'Försäkringsaktiebolag',
  'FF': 'Försäkringsförmedlare',
  'FL': 'Filial',
  'FOF': 'Försäkringsförening',
  'HB': 'Handelsbolag',
  'I': 'Ideell förening som bedriver näringsverksamhet',
  'KB': 'Kommanditbolag',
  'KHF': 'Kooperativ hyresrättsförening',
  'MB': 'Medlemsbank',
  'OFB': 'Ömsesidigt försäkringsbolag',
  'OTPB': 'Ömsesidigt tjänstepensionsbolag',
  'S': 'Stiftelse som bedriver näringsverksamhet',
  'SB': 'Sparbank',
  'SCE': 'Europakooperativ',
  'SE': 'Europabolag',
  'SF': 'Sambruksförening',
  'TPAB': 'Tjänstepensionsaktiebolag',
  'TPF': 'Tjänstepensionsförening',
  'TSF': 'Trossamfund som bedriver näringsverksamhet',
};

// =============================================================================
// Pågående förfarande
// =============================================================================

export const PAGAENDE_FORFARANDE: Record<string, string> = {
  'AC': 'Ackordsförhandling',
  'DEOL': 'Överlåtande vid delning',
  'DEOT': 'Övertagande vid delning',
  'FR': 'Företagsrekonstruktion',
  'FUOL': 'Överlåtande i fusion',
  'FUOT': 'Övertagande i fusion',
  'GROM': 'Gränsöverskridande ombildning',
  'KK': 'Konkurs',
  'LI': 'Likvidation',
  'OM': 'Ombildning',
  'RES': 'Resolution',
};

// =============================================================================
// Identitetsbeteckningstyp
// =============================================================================

export const IDENTITETSBETECKNINGSTYP: Record<string, string> = {
  'DODSBO': 'Dödsbonummer',
  'GDNUMMER': 'Identitetsbeteckning person (GD-nummer)',
  'ORGANISATIONSNUMMER': 'Organisationsnummer',
  'PERSONNUMMER': 'Identitetsbeteckning person (personnummer)',
  'SAMORDNINGSNUMMER': 'Identitetsbeteckning person (Samordningsnummer)',
  'UTLANDSK_JURIDISK_IDENTITETSBETECKNING': 'Utländsk identitetsbeteckning',
};

// =============================================================================
// Organisationsnamntyp
// =============================================================================

export const ORGANISATIONSNAMNTYP: Record<string, string> = {
  'FORETAGSNAMN': 'Företagsnamn',
  'FORNAMN_FRSPRAK': 'Företagsnamn på främmande språk',
  'NAMN': 'Namn',
  'SARSKILT_FORETAGSNAMN': 'Särskilt företagsnamn',
};

// =============================================================================
// BAS-kontomappning (iXBRL-begrepp → BAS-konto)
// =============================================================================

export const BAS_KONTO_MAPPNING: Record<string, string> = {
  // Resultaträkning
  'Nettoomsattning': '3000-3799',
  'OvrigaRorelseintakter': '3900-3999',
  'HandelsvarorKostnader': '4000-4999',
  'OvrigaExternaKostnader': '5000-6999',
  'Personalkostnader': '7000-7699',
  'AvskrivningarNedskrivningar': '7800-7899',
  'FinansiellaIntakter': '8000-8399',
  'FinansiellaKostnader': '8400-8499',
  'SkattAretsResultat': '8900-8999',

  // Balansräkning - Tillgångar
  'ImmateriellAnlaggningstillgangar': '1000-1099',
  'MateriellaAnlaggningstillgangar': '1100-1299',
  'FinansiellaAnlaggningstillgangar': '1300-1399',
  'VarulagerMm': '1400-1499',
  'Kundfordringar': '1500-1599',
  'KassaBank': '1900-1999',

  // Balansräkning - Eget kapital & Skulder
  'Aktiekapital': '2081',
  'BalanseratResultat': '2091-2098',
  'AretsResultat': '2099',
  'LangfristigaSkulder': '2300-2499',
  'KortfristigaSkulder': '2400-2999',
  'Leverantorsskulder': '2440',
};

// =============================================================================
// Hjälpfunktioner
// =============================================================================

export function getAvregistreringsorsakText(kod: string): string {
  return AVREGISTRERINGSORSAK[kod] || kod;
}

/**
 * Hämta text för organisationsformkod.
 * Hanterar tom sträng, case-insensitive matchning och okända koder.
 */
export function getOrganisationsformText(kod: string): string {
  // Hantera tom/undefined/null
  if (!kod || kod.trim() === '') {
    return 'Okänd organisationsform';
  }

  const normalizedKod = kod.trim().toUpperCase();

  // Direkt matchning
  if (ORGANISATIONSFORM[normalizedKod]) {
    return ORGANISATIONSFORM[normalizedKod];
  }

  // Försök hitta case-insensitive
  for (const [key, value] of Object.entries(ORGANISATIONSFORM)) {
    if (key.toUpperCase() === normalizedKod) {
      return value;
    }
  }

  // Fallback: returnera koden om den finns, annars "Okänd"
  return normalizedKod.length > 0 ? normalizedKod : 'Okänd organisationsform';
}

export function getPagaendeForfarandeText(kod: string): string {
  return PAGAENDE_FORFARANDE[kod] || kod;
}

export function getIdentitetsbeteckningstypText(kod: string): string {
  return IDENTITETSBETECKNINGSTYP[kod] || kod;
}

export function getOrganisationsnamntypText(kod: string): string {
  return ORGANISATIONSNAMNTYP[kod] || kod;
}

/**
 * Hitta BAS-konto för ett iXBRL-begrepp.
 */
export function findBASKonto(begrepp: string): string | null {
  // Direkt matchning
  if (BAS_KONTO_MAPPNING[begrepp]) {
    return BAS_KONTO_MAPPNING[begrepp];
  }

  // Partiell matchning (case-insensitive)
  const lowerBegrepp = begrepp.toLowerCase();
  for (const [key, value] of Object.entries(BAS_KONTO_MAPPNING)) {
    if (key.toLowerCase().includes(lowerBegrepp) || lowerBegrepp.includes(key.toLowerCase())) {
      return value;
    }
  }

  return null;
}
