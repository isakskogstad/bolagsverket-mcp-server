/**
 * Bolagsverket MCP Server - Zod Schemas
 * Input-validering för alla verktyg.
 */

import { z } from 'zod';

/**
 * Organisationsnummer-schema med Luhn-validering.
 */
export const OrgNummerSchema = z.string()
  .min(10, 'Organisationsnummer måste vara minst 10 siffror')
  .max(13, 'Organisationsnummer får vara max 13 tecken')
  .transform(val => val.replace(/[-\s]/g, ''))
  .refine(val => /^\d{10,12}$/.test(val), {
    message: 'Organisationsnummer måste innehålla 10-12 siffror',
  });

/**
 * Response-format.
 */
export const ResponseFormatSchema = z.enum(['text', 'json']).default('text');

/**
 * Export-format.
 */
export const ExportFormatSchema = z.enum(['pdf', 'excel', 'csv', 'json', 'word', 'powerpoint']);

/**
 * Grundläggande org-nummer input.
 */
export const OrgNummerInputSchema = z.object({
  org_nummer: OrgNummerSchema.describe('Organisationsnummer (10 eller 12 siffror)'),
});

/**
 * Finansiell data input.
 */
export const FinansiellDataInputSchema = z.object({
  org_nummer: OrgNummerSchema.describe('Organisationsnummer'),
  index: z.number().int().min(0).default(0).describe('Index för årsredovisning (0 = senaste)'),
  response_format: ResponseFormatSchema.describe('Svarsformat: text eller json'),
});

/**
 * Trend-analys input.
 */
export const TrendInputSchema = z.object({
  org_nummer: OrgNummerSchema.describe('Organisationsnummer'),
  antal_ar: z.number().int().min(2).max(10).default(4).describe('Antal år att analysera'),
});

/**
 * Sök-input.
 */
export const SearchInputSchema = z.object({
  foretag_namn: z.string().min(2).describe('Företagsnamn att söka efter'),
  max_results: z.number().int().min(1).max(50).default(10).describe('Max antal resultat'),
});

/**
 * Nätverks-input.
 */
export const NetworkInputSchema = z.object({
  namn: z.string().min(2).describe('Personnamn att söka kopplingar för'),
});

/**
 * Export-input.
 */
export const ExportInputSchema = z.object({
  org_nummer: OrgNummerSchema.describe('Organisationsnummer'),
  format: ExportFormatSchema.describe('Exportformat'),
});

/**
 * Taxonomi-input.
 */
export const TaxonomiInputSchema = z.object({
  org_nummer: OrgNummerSchema.describe('Organisationsnummer'),
  index: z.number().int().min(0).default(0).describe('Index för årsredovisning'),
});

/**
 * Status-input.
 */
export const StatusInputSchema = z.object({
  include_details: z.boolean().default(false).describe('Inkludera detaljerad statistik'),
});

/**
 * Koncern-input.
 */
export const KoncernInputSchema = z.object({
  org_nummer: OrgNummerSchema.describe('Organisationsnummer för moderbolag'),
  inkludera_dotterbolag: z.boolean().default(false).describe('Försök identifiera dotterbolag'),
});

/**
 * BAS-mappning input.
 */
export const BASMappingInputSchema = z.object({
  begrepp: z.string().min(1).describe('iXBRL-begrepp att mappa'),
});

/**
 * Dokument-input.
 */
export const DokumentInputSchema = z.object({
  org_nummer: OrgNummerSchema.describe('Organisationsnummer'),
  index: z.number().int().min(0).default(0).describe('Index för årsredovisning'),
});

/**
 * Full analys input.
 */
export const FullAnalysInputSchema = z.object({
  org_nummer: OrgNummerSchema.describe('Organisationsnummer'),
  index: z.number().int().min(0).default(0).describe('Index för årsredovisning (0 = senaste)'),
  inkludera_koncern: z.boolean().default(false).describe('Inkludera koncerndata om tillgängligt'),
  response_format: ResponseFormatSchema.describe('Svarsformat'),
});

/**
 * Hjälpfunktion för att validera och extrahera input.
 */
export function parseInput<T>(schema: z.ZodSchema<T>, input: unknown): T {
  return schema.parse(input);
}

/**
 * Validera utan att kasta fel.
 */
export function safeParseInput<T>(schema: z.ZodSchema<T>, input: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
  return { success: false, error: errors };
}
