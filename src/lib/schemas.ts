/**
 * Bolagsverket MCP Server - Zod Schemas
 * Input-validering för alla tools.
 */

import { z } from 'zod';

// Validera org-nummer format
const orgNummerSchema = z.string()
  .min(10, 'Organisationsnummer måste vara minst 10 siffror')
  .max(13, 'Organisationsnummer får vara max 13 tecken')
  .transform(val => val.replace(/[-\s]/g, ''));

export const OrgNummerInput = z.object({
  org_nummer: orgNummerSchema,
});

export const FinansiellDataInput = z.object({
  org_nummer: orgNummerSchema,
  index: z.number().int().min(0).default(0),
  response_format: z.enum(['text', 'json']).default('text'),
});

export const TrendInput = z.object({
  org_nummer: orgNummerSchema,
  antal_ar: z.number().int().min(2).max(10).default(4),
});

export const SearchInput = z.object({
  foretag_namn: z.string().min(2, 'Sökterm måste vara minst 2 tecken'),
  max_results: z.number().int().min(1).max(50).default(10),
});

export const NetworkInput = z.object({
  namn: z.string().min(2, 'Namn måste vara minst 2 tecken'),
});

export const ExportInput = z.object({
  org_nummer: orgNummerSchema,
  format: z.enum(['pdf', 'excel', 'csv', 'json', 'word', 'powerpoint']),
});

export const TaxonomiInput = z.object({
  org_nummer: orgNummerSchema,
  index: z.number().int().min(0).default(0),
});

export const StatusInput = z.object({
  include_details: z.boolean().default(false),
});

export const KoncernInput = z.object({
  org_nummer: orgNummerSchema,
  inkludera_dotterbolag: z.boolean().default(false),
});

export const RiskCheckInput = z.object({
  org_nummer: orgNummerSchema,
  inkludera_historik: z.boolean().default(true),
});

export const BASMappingInput = z.object({
  begrepp: z.string().min(1),
});

export const DocumentInput = z.object({
  org_nummer: orgNummerSchema,
  index: z.number().int().min(0).default(0),
});

export const CompareInput = z.object({
  org_nummer_lista: z.array(orgNummerSchema).min(2).max(10),
});

// Type exports
export type OrgNummerInputType = z.infer<typeof OrgNummerInput>;
export type FinansiellDataInputType = z.infer<typeof FinansiellDataInput>;
export type TrendInputType = z.infer<typeof TrendInput>;
export type SearchInputType = z.infer<typeof SearchInput>;
export type NetworkInputType = z.infer<typeof NetworkInput>;
export type ExportInputType = z.infer<typeof ExportInput>;
export type TaxonomiInputType = z.infer<typeof TaxonomiInput>;
export type StatusInputType = z.infer<typeof StatusInput>;
export type KoncernInputType = z.infer<typeof KoncernInput>;
export type RiskCheckInputType = z.infer<typeof RiskCheckInput>;
export type BASMappingInputType = z.infer<typeof BASMappingInput>;
export type DocumentInputType = z.infer<typeof DocumentInput>;
export type CompareInputType = z.infer<typeof CompareInput>;
