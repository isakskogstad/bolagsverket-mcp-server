/**
 * Bolagsverket MCP Server - TypeScript Types
 * Alla datatyper för API-svar, interna strukturer och MCP-kommunikation.
 */

// =============================================================================
// Enums
// =============================================================================

export enum ErrorCode {
  COMPANY_NOT_FOUND = 'COMPANY_NOT_FOUND',
  ANNUAL_REPORT_NOT_FOUND = 'ANNUAL_REPORT_NOT_FOUND',
  API_ERROR = 'API_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  EXPORT_ERROR = 'EXPORT_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export enum ResponseFormat {
  TEXT = 'text',
  JSON = 'json',
}

export enum ExportFormat {
  PDF = 'pdf',
  EXCEL = 'excel',
  CSV = 'csv',
  JSON = 'json',
  WORD = 'word',
  POWERPOINT = 'powerpoint',
}

// =============================================================================
// Grundläggande datatyper
// =============================================================================

export interface Person {
  fornamn: string;
  efternamn: string;
  roll: string;
  datum?: string;
}

export interface Nyckeltal {
  nettoomsattning?: number | null;
  resultat_efter_finansiella?: number | null;
  arets_resultat?: number | null;
  eget_kapital?: number | null;
  balansomslutning?: number | null;
  soliditet?: number | null;
  antal_anstallda?: number | null;
  vinstmarginal?: number | null;
  roe?: number | null;
}

export interface KoncernNyckeltal {
  koncern_nettoomsattning?: number | null;
  koncern_rorelseresultat?: number | null;
  koncern_resultat_efter_finansiella?: number | null;
  koncern_arets_resultat?: number | null;
  koncern_eget_kapital?: number | null;
  koncern_balansomslutning?: number | null;
  minoritetsandel?: number | null;
  goodwill?: number | null;
  koncern_soliditet?: number | null;
}

export interface Adress {
  utdelningsadress?: string;
  postnummer?: string;
  postort?: string;
  land?: string;
  // Besöksadress-fält (om tillgängliga)
  besoksadress?: string;
  // C/O-adress
  co_adress?: string;
}

export interface SNIKod {
  kod: string;
  klartext: string;
}

export interface DatakallaFel {
  falt: string;
  typ: string;
  beskrivning: string;
  dataproducent: string;
}

export interface OrganisationsNamn {
  namn: string;
  typ: string;
  sprak?: string;
}

// =============================================================================
// Företagsinformation
// =============================================================================

export interface CompanyInfo {
  org_nummer: string;
  namn: string;
  organisationsform: string;
  organisationsform_kod?: string;
  juridisk_form?: string;
  registreringsdatum: string;
  status: string;
  avregistreringsdatum?: string;
  avregistreringsorsak?: string;
  adress: Adress;
  verksamhet?: string;
  sni_koder: SNIKod[];
  sate?: string;
  pagaende_konkurs?: { datum: string; typ: string };
  pagaende_likvidation?: { datum: string; typ: string };
  reklamsparr?: boolean;
  verksam_organisation?: boolean;
  registreringsland?: { kod: string; klartext: string };
  namnskyddslopnummer?: number;
  infort_hos_scb?: string;
  alla_namn?: OrganisationsNamn[];
  datakalla_fel?: DatakallaFel[];
}

// =============================================================================
// Årsredovisning
// =============================================================================

export interface BalansrakningPost {
  immateriella?: number;
  materiella?: number;
  finansiella?: number;
  varulager?: number;
  kundfordringar?: number;
  kassa_bank?: number;
  summa_omsattning?: number;
  summa_tillgangar?: number;
}

export interface BalansrakningSkulder {
  aktiekapital?: number;
  balanserat_resultat?: number;
  arets_resultat?: number;
  summa_eget_kapital?: number;
  langfristiga_skulder?: number;
  kortfristiga_skulder?: number;
  leverantorsskulder?: number;
  summa_skulder?: number;
}

export interface Balansrakning {
  tillgangar: BalansrakningPost;
  eget_kapital_skulder: BalansrakningSkulder;
}

export interface Resultatrakning {
  nettoomsattning?: number;
  ovriga_rorelseinktakter?: number;
  summa_intakter?: number;
  varor_handelsvaror?: number;
  ovriga_externa_kostnader?: number;
  personalkostnader?: number;
  avskrivningar?: number;
  rorelseresultat?: number;
  finansiella_intakter?: number;
  finansiella_kostnader?: number;
  resultat_efter_finansiella?: number;
  skatt?: number;
  arets_resultat?: number;
}

export interface Arsredovisning {
  org_nummer: string;
  foretag_namn: string;
  rakenskapsar_start: string;
  rakenskapsar_slut: string;
  nyckeltal: Nyckeltal;
  personer: Person[];
  balansrakning: Balansrakning;
  resultatrakning: Resultatrakning;
  noter: Record<string, string>;
  metadata: Record<string, string>;
}

export interface FullArsredovisning extends Arsredovisning {
  styrelse: Person[];
  revisorer: Person[];
  vd?: Person;
  forvaltningsberattelse: Record<string, string>;
  flerarsdata: FlerarsData[];
  roda_flaggor: RodFlagga[];
}

// =============================================================================
// Riskanalys
// =============================================================================

export interface RodFlagga {
  typ: string;
  allvarlighet: 'kritisk' | 'varning' | 'info';
  beskrivning: string;
  varde?: unknown;
  rekommendation?: string;
}

// =============================================================================
// Trendanalys
// =============================================================================

export interface FlerarsData {
  period: string;
  nyckeltal: Nyckeltal;
}

export interface Trendanalys {
  org_nummer: string;
  foretag_namn: string;
  perioder: string[];
  nyckeltal_serie: Record<string, (number | null)[]>;
  tillvaxt: Record<string, number | null>;
  prognos: Record<string, number | null>;
}

// =============================================================================
// Nätverk
// =============================================================================

export interface PersonBolag {
  org_nummer: string;
  namn: string;
  roll: string;
  period?: string;
}

export interface PersonNetwork {
  namn: string;
  bolag: PersonBolag[];
}

// =============================================================================
// Taxonomi
// =============================================================================

export interface TaxonomiInfo {
  version: string;
  typ: 'K2' | 'K3' | 'K3K' | 'REVISION' | 'FASTSTALLELSE';
  entry_point: string;
  ar_arkiverad: boolean;
  varning?: string;
}

// =============================================================================
// Revisionsberättelse
// =============================================================================

export interface Revisionsberattelse {
  revisor_namn?: string;
  revisor_titel?: string;
  revisionsbolag?: string;
  uttalande_arsredovisning?: string;
  uttalande_koncernredovisning?: string;
  uttalande_forvaltning?: string;
  grund_for_uttalande?: string;
  anmarkningar: string[];
  ovrigt?: string;
  datum?: string;
  ort?: string;
  ar_ren: boolean;
  typ: 'standard' | 'koncern' | 'forenklad';
}

// =============================================================================
// Fastställelseintyg
// =============================================================================

export interface Faststallelseintyg {
  arsstamma_datum?: string;
  intygsdatum?: string;
  utdelning_totalt?: number;
  utdelning_per_aktie?: number;
  balanseras_i_ny_rakning?: number;
  undertecknare: string[];
}

// =============================================================================
// Utökad information
// =============================================================================

export interface OdefiniertBegrepp {
  namn: string;
  varde?: number;
}

export interface AndradRubrik {
  ursprunglig: string;
  ny: string;
}

export interface Notkoppling {
  not_nummer: string;
}

export interface UtokadInformation {
  ar_fullstandigt_taggad: boolean;
  odefinierade_begrepp: OdefiniertBegrepp[];
  andrade_rubriker: AndradRubrik[];
  notkopplingar: Notkoppling[];
}

// =============================================================================
// BAS-kontomappning
// =============================================================================

export interface BASMapping {
  begrepp: string;
  bas_konto?: string;
  beskrivning?: string;
}

// =============================================================================
// API-svar
// =============================================================================

export interface ApiError {
  type?: string;
  instance?: string;
  timestamp?: string;
  requestId?: string;
  status: number;
  title: string;
  detail: string;
}

export interface DokumentInfo {
  id: string;
  typ: string;
  rakenskapsperiod: {
    fran: string;
    till: string;
  };
  inlamningsdatum: string;

  // Kompatibilitet: vissa flöden/exponeringar använder andra fältnamn.
  // Dessa är inte nödvändiga för intern logik, men gör verktygsutdata stabilare.
  dokumentId?: string;
  filformat?: string;
  rapporteringsperiodTom?: string;
  registreringstidpunkt?: string;
}

export interface OrganisationResponse {
  organisationer: Array<{
    identitetsbeteckning: {
      beteckning: string;
      typ: string;
    };
    organisationsnamn?: {
      organisationsnamnLista?: Array<{
        namn: string;
        typ?: string;
      }>;
      fel?: { typ: string; felBeskrivning: string };
    };
    organisationsform?: {
      organisationsform?: string;
      juridiskForm?: string;
      fel?: { typ: string; felBeskrivning: string };
    };
    organisationsdatum?: {
      registreringsdatum?: string;
      fel?: { typ: string; felBeskrivning: string };
    };
    avregistreradOrganisation?: {
      avregistreringsdatum?: string;
      orsak?: string;
      fel?: { typ: string; felBeskrivning: string };
    };
    postadressOrganisation?: {
      utdelningsadress?: string;
      postnummer?: string;
      postort?: string;
      fel?: { typ: string; felBeskrivning: string };
    };
    verksamhetsbeskrivning?: {
      beskrivning?: string;
      fel?: { typ: string; felBeskrivning: string };
    };
    naringsgrenOrganisation?: {
      naringsgrenLista?: Array<{
        kod: string;
        beskrivning: string;
      }>;
      fel?: { typ: string; felBeskrivning: string };
    };
    sateOrganisation?: {
      lan?: string;
    };
    pagandeAvvecklingsEllerOmstruktureringsforfarande?: {
      forfarandeLista?: Array<{
        typ: string;
        datum?: string;
      }>;
    };
    organisationReklamsparr?: {
      sparr?: boolean;
    };
    verksamOrganisation?: {
      verksam?: boolean;
    };
  }>;
}

export interface DokumentlistaResponse {
  dokument: DokumentInfo[];
}

// =============================================================================
// Cache
// =============================================================================

export interface CacheEntry {
  key: string;
  value: string;
  category: string;
  created_at: string;
  expires_at: string;
  hit_count: number;
}

export interface CacheStats {
  total_entries: number;
  expired_entries: number;
  db_size_bytes: number;
  categories: Record<string, { count: number; hits: number }>;
}

// =============================================================================
// MCP Error
// =============================================================================

export interface MCPErrorResponse {
  isError: true;
  errorCode: ErrorCode;
  message: string;
  details: Record<string, unknown>;
}

// =============================================================================
// Export Types
// =============================================================================

export interface ExportResult {
  success: boolean;
  filepath?: string;
  filename?: string;
  error?: string;
}

// =============================================================================
// Input Schemas (för Zod)
// =============================================================================

export interface OrgNummerInput {
  org_nummer: string;
}

export interface FinansiellDataInput extends OrgNummerInput {
  index?: number;
  response_format?: ResponseFormat;
}

export interface TrendInput extends OrgNummerInput {
  antal_ar?: number;
}

export interface NetworkInput {
  namn: string;
}

export interface SearchInput {
  foretag_namn: string;
  max_results?: number;
}

export interface ExportInput extends OrgNummerInput {
  format: ExportFormat;
}

export interface TaxonomiInput extends OrgNummerInput {
  index?: number;
}

export interface StatusInput {
  include_details?: boolean;
}

export interface KoncernInput extends OrgNummerInput {
  inkludera_dotterbolag?: boolean;
}
