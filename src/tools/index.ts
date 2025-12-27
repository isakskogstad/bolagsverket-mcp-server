/**
 * Bolagsverket MCP Server - Tool Registration
 * Registrerar alla verktyg på MCP-servern.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Import tools
import * as analyzeFull from './analyze-full.js';
import * as basicInfo from './basic-info.js';
import * as nyckeltal from './nyckeltal.js';
import * as riskTrend from './risk-trend.js';

// Zod-scheman för verktyg
const OrgNummerZod = z.object({
  org_nummer: z.string().describe('Organisationsnummer (10 eller 12 siffror)'),
});

const FinansiellDataZod = z.object({
  org_nummer: z.string().describe('Organisationsnummer'),
  index: z.number().optional().default(0).describe('Index för årsredovisning (0 = senaste)'),
  response_format: z.enum(['text', 'json']).optional().default('text').describe('Svarsformat'),
});

const FullAnalysZod = z.object({
  org_nummer: z.string().describe('Organisationsnummer'),
  index: z.number().optional().default(0).describe('Index för årsredovisning'),
  inkludera_koncern: z.boolean().optional().default(false).describe('Inkludera koncerndata'),
  response_format: z.enum(['text', 'json']).optional().default('text').describe('Svarsformat'),
});

const TrendZod = z.object({
  org_nummer: z.string().describe('Organisationsnummer'),
  antal_ar: z.number().optional().default(4).describe('Antal år att analysera'),
});

/**
 * Hjälpfunktion för att skapa MCP tool response.
 * Kontrollerar om resultatet är ett fel och sätter isError-flaggan korrekt.
 */
function createToolResponse(result: string): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  // Kontrollera om resultatet är ett felmeddelande (JSON med isError: true)
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === 'object' && parsed.isError === true) {
      return {
        content: [{ type: 'text' as const, text: result }],
        isError: true,
      };
    }
  } catch {
    // Inte JSON, fortsätt som vanligt
  }

  return { content: [{ type: 'text' as const, text: result }] };
}

/**
 * Registrera alla verktyg på servern.
 */
export function registerTools(server: McpServer): void {
  // Analyze full
  server.tool(
    analyzeFull.TOOL_NAME,
    analyzeFull.TOOL_DESCRIPTION,
    FullAnalysZod.shape,
    async (args) => {
      const result = await analyzeFull.analyzeFull(args);
      return createToolResponse(result);
    }
  );

  // Basic info
  server.tool(
    basicInfo.TOOL_NAME,
    basicInfo.TOOL_DESCRIPTION,
    OrgNummerZod.shape,
    async (args) => {
      const result = await basicInfo.getBasicInfo(args);
      return createToolResponse(result);
    }
  );

  // Address
  server.tool(
    basicInfo.ADDRESS_TOOL_NAME,
    basicInfo.ADDRESS_TOOL_DESCRIPTION,
    OrgNummerZod.shape,
    async (args) => {
      const result = await basicInfo.getAddress(args);
      return createToolResponse(result);
    }
  );

  // Verksamhet
  server.tool(
    basicInfo.VERKSAMHET_TOOL_NAME,
    basicInfo.VERKSAMHET_TOOL_DESCRIPTION,
    OrgNummerZod.shape,
    async (args) => {
      const result = await basicInfo.getVerksamhet(args);
      return createToolResponse(result);
    }
  );

  // Status
  server.tool(
    basicInfo.STATUS_TOOL_NAME,
    basicInfo.STATUS_TOOL_DESCRIPTION,
    OrgNummerZod.shape,
    async (args) => {
      const result = await basicInfo.getCompanyStatus(args);
      return createToolResponse(result);
    }
  );

  // Nyckeltal
  server.tool(
    nyckeltal.TOOL_NAME,
    nyckeltal.TOOL_DESCRIPTION,
    FinansiellDataZod.shape,
    async (args) => {
      const result = await nyckeltal.getNyckeltal(args);
      return createToolResponse(result);
    }
  );

  // Styrelse
  server.tool(
    nyckeltal.STYRELSE_TOOL_NAME,
    nyckeltal.STYRELSE_TOOL_DESCRIPTION,
    FinansiellDataZod.shape,
    async (args) => {
      const result = await nyckeltal.getStyrelse(args);
      return createToolResponse(result);
    }
  );

  // Dokumentlista
  server.tool(
    nyckeltal.DOKUMENTLISTA_TOOL_NAME,
    nyckeltal.DOKUMENTLISTA_TOOL_DESCRIPTION,
    FinansiellDataZod.shape,
    async (args) => {
      const result = await nyckeltal.listArsredovisningar(args);
      return createToolResponse(result);
    }
  );

  // Risk check
  server.tool(
    riskTrend.RISK_TOOL_NAME,
    riskTrend.RISK_TOOL_DESCRIPTION,
    FinansiellDataZod.shape,
    async (args) => {
      const result = await riskTrend.riskCheck(args);
      return createToolResponse(result);
    }
  );

  // Trend
  server.tool(
    riskTrend.TREND_TOOL_NAME,
    riskTrend.TREND_TOOL_DESCRIPTION,
    TrendZod.shape,
    async (args) => {
      const result = await riskTrend.trendAnalysis(args);
      return createToolResponse(result);
    }
  );

  console.error('[Tools] Registrerade 10 verktyg');
}

// Re-export
export { analyzeFull, basicInfo, nyckeltal, riskTrend };
