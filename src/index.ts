#!/usr/bin/env node
/**
 * Bolagsverket MCP Server
 * MCP-server för Bolagsverkets API "Värdefulla datamängder"
 * 
 * Verktyg för att analysera svenska företag via årsredovisningar
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as api from './api-client.js';

// Server version
const VERSION = '1.0.0';

// Skapa MCP-server
export const server = new McpServer({
  name: 'bolagsverket-mcp-server',
  version: VERSION,
});

// ============================================
// TOOL: Analysera företag (fullständig)
// ============================================
server.tool(
  'bolagsverket_analyze_full',
  'Komplett årsredovisningsanalys av ett företag. Inkluderar finansiell data, nyckeltal och riskindikatorer.',
  {
    organisationsnummer: z.string().describe('Organisationsnummer (10 siffror)'),
    year: z.number().optional().describe('Räkenskapsår (valfritt, senaste om ej angivet)'),
  },
  async ({ organisationsnummer, year }) => {
    try {
      const [company, report] = await Promise.all([
        api.getCompanyInfo(organisationsnummer),
        api.getAnnualReport(organisationsnummer, year),
      ]);
      
      const keyFigures = api.calculateKeyFigures(report);
      const risks = api.analyzeRisks(report);
      
      const analysis = {
        foretag: {
          namn: company.namn,
          organisationsnummer: api.formatOrgNr(company.organisationsnummer),
          bolagsform: company.bolagsform,
          status: company.status,
        },
        rakenskapsperiod: report.rakenskapsperiod,
        finansiellData: report.data,
        nyckeltal: keyFigures,
        riskindikatorer: risks,
        taxonomi: report.taxonomi,
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(analysis, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Fel: ${error instanceof Error ? error.message : 'Okänt fel'}`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================
// TOOL: Riskanalys
// ============================================
server.tool(
  'bolagsverket_risk_check',
  'Identifiera röda flaggor och varningar i ett företags årsredovisning.',
  {
    organisationsnummer: z.string().describe('Organisationsnummer (10 siffror)'),
    year: z.number().optional().describe('Räkenskapsår (valfritt)'),
  },
  async ({ organisationsnummer, year }) => {
    try {
      const report = await api.getAnnualReport(organisationsnummer, year);
      const company = await api.getCompanyInfo(organisationsnummer);
      const risks = api.analyzeRisks(report);
      
      const result = {
        foretag: {
          namn: company.namn,
          organisationsnummer: api.formatOrgNr(company.organisationsnummer),
        },
        rakenskapsperiod: report.rakenskapsperiod,
        riskindikatorer: risks,
        sammanfattning: {
          kritiska: risks.filter(r => r.type === 'critical').length,
          varningar: risks.filter(r => r.type === 'warning').length,
          info: risks.filter(r => r.type === 'info').length,
        },
        bedomning: risks.some(r => r.type === 'critical') 
          ? 'HÖG RISK' 
          : risks.some(r => r.type === 'warning')
            ? 'MEDELHÖG RISK'
            : 'LÅG RISK',
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Fel: ${error instanceof Error ? error.message : 'Okänt fel'}`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================
// TOOL: Sök företag
// ============================================
server.tool(
  'bolagsverket_search',
  'Sök efter företag utan att veta organisationsnummer. Sök på namn, ort eller bransch.',
  {
    query: z.string().describe('Sökterm (företagsnamn, ort, etc.)'),
    page: z.number().optional().describe('Sidnummer (standard: 1)'),
    pageSize: z.number().optional().describe('Antal resultat per sida (standard: 20, max: 100)'),
    status: z.string().optional().describe('Filtrera på status (aktiv, avregistrerad, etc.)'),
    bolagsform: z.string().optional().describe('Filtrera på bolagsform (AB, HB, etc.)'),
  },
  async ({ query, page, pageSize, status, bolagsform }) => {
    try {
      const result = await api.searchCompanies(query, {
        page,
        pageSize,
        status,
        bolagsform,
      });
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            sokning: query,
            antal: result.totalCount,
            sida: result.page,
            sidstorlek: result.pageSize,
            foretag: result.companies.map(c => ({
              namn: c.namn,
              organisationsnummer: api.formatOrgNr(c.organisationsnummer),
              bolagsform: c.bolagsform,
              status: c.status,
            })),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Fel: ${error instanceof Error ? error.message : 'Okänt fel'}`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================
// TOOL: Nyckeltal
// ============================================
server.tool(
  'bolagsverket_key_figures',
  'Beräkna och visa nyckeltal för ett företag (soliditet, likviditet, lönsamhet).',
  {
    organisationsnummer: z.string().describe('Organisationsnummer (10 siffror)'),
    year: z.number().optional().describe('Räkenskapsår (valfritt)'),
  },
  async ({ organisationsnummer, year }) => {
    try {
      const [company, report] = await Promise.all([
        api.getCompanyInfo(organisationsnummer),
        api.getAnnualReport(organisationsnummer, year),
      ]);
      
      const keyFigures = api.calculateKeyFigures(report);
      
      const result = {
        foretag: {
          namn: company.namn,
          organisationsnummer: api.formatOrgNr(company.organisationsnummer),
        },
        rakenskapsperiod: report.rakenskapsperiod,
        nyckeltal: {
          soliditet: keyFigures.soliditet 
            ? `${keyFigures.soliditet.toFixed(1)}%`
            : 'Ej beräkningsbar',
          kassalikviditet: keyFigures.kassalikviditet
            ? `${keyFigures.kassalikviditet.toFixed(1)}%`
            : 'Ej beräkningsbar',
          vinstmarginal: keyFigures.vinstmarginal
            ? `${keyFigures.vinstmarginal.toFixed(1)}%`
            : 'Ej beräkningsbar',
          avkastningEgetKapital: keyFigures.avkastningEgetKapital
            ? `${keyFigures.avkastningEgetKapital.toFixed(1)}%`
            : 'Ej beräkningsbar',
          avkastningTotaltKapital: keyFigures.avkastningTotaltKapital
            ? `${keyFigures.avkastningTotaltKapital.toFixed(1)}%`
            : 'Ej beräkningsbar',
        },
        ravaarden: keyFigures,
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Fel: ${error instanceof Error ? error.message : 'Okänt fel'}`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================
// TOOL: Företagsinfo
// ============================================
server.tool(
  'bolagsverket_company_info',
  'Hämta grundläggande information om ett företag (namn, adress, status).',
  {
    organisationsnummer: z.string().describe('Organisationsnummer (10 siffror)'),
  },
  async ({ organisationsnummer }) => {
    try {
      const company = await api.getCompanyInfo(organisationsnummer);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            namn: company.namn,
            organisationsnummer: api.formatOrgNr(company.organisationsnummer),
            bolagsform: company.bolagsform,
            status: company.status,
            registreringsdatum: company.registreringsdatum,
            adress: company.adress,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Fel: ${error instanceof Error ? error.message : 'Okänt fel'}`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================
// TOOL: Serverstatus
// ============================================
server.tool(
  'bolagsverket_server_status',
  'Visa serverstatus, cache-statistik och tillgängliga verktyg.',
  {},
  async () => {
    const cacheStats = api.getCacheStats();
    
    const status = {
      server: 'bolagsverket-mcp-server',
      version: VERSION,
      status: 'online',
      timestamp: new Date().toISOString(),
      cache: {
        entries: cacheStats.entries,
        oldestEntryAge: cacheStats.oldestEntry 
          ? `${Math.round(cacheStats.oldestEntry / 1000)}s`
          : null,
      },
      tools: [
        'bolagsverket_analyze_full',
        'bolagsverket_risk_check',
        'bolagsverket_search',
        'bolagsverket_key_figures',
        'bolagsverket_company_info',
        'bolagsverket_server_status',
      ],
    };
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(status, null, 2),
      }],
    };
  }
);

// ============================================
// RESOURCE: API-dokumentation
// ============================================
server.resource(
  'docs://api',
  'API-dokumentation för Bolagsverket MCP Server',
  async () => ({
    contents: [{
      uri: 'docs://api',
      mimeType: 'text/markdown',
      text: `# Bolagsverket MCP Server

## Tillgängliga verktyg

### bolagsverket_analyze_full
Komplett årsredovisningsanalys av ett företag.

**Parametrar:**
- \`organisationsnummer\` (obligatorisk): 10-siffrigt organisationsnummer
- \`year\` (valfri): Specifikt räkenskapsår

### bolagsverket_risk_check
Identifiera röda flaggor och varningar.

### bolagsverket_search
Sök efter företag på namn, ort eller bransch.

### bolagsverket_key_figures
Beräkna nyckeltal (soliditet, likviditet, lönsamhet).

### bolagsverket_company_info
Hämta grundläggande företagsinformation.

### bolagsverket_server_status
Visa serverstatus och cache-statistik.

## Datakälla

Data hämtas från Bolagsverkets API "Värdefulla datamängder".
https://foretagsfakta.bolagsverket.se
`,
    }],
  })
);

// ============================================
// START SERVER (STDIO)
// ============================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[Bolagsverket MCP] Server v${VERSION} started (STDIO)`);
}

main().catch((error) => {
  console.error('[Bolagsverket MCP] Fatal error:', error);
  process.exit(1);
});

export { server as McpServer };
