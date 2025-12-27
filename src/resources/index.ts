/**
 * Bolagsverket MCP Server - Resources
 * URI-baserade resurser för företagsdata.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fetchCompanyInfo } from '../lib/company-service.js';
import { fetchAndParseArsredovisning, fetchDokumentlistaForOrg, fetchFullArsredovisning } from '../lib/arsredovisning-service.js';
import { validateOrgNummer } from '../lib/validators.js';
import { cacheManager } from '../lib/cache-manager.js';
import { SERVER_CONFIG } from '../lib/config.js';

/**
 * Registrera alla resurser.
 */
export function registerResources(server: McpServer): void {
  // Company info
  server.resource(
    'bolagsverket://company/{org}',
    'Företagsinformation för ett specifikt organisationsnummer',
    async (uri) => {
      const org = uri.pathname.split('/').pop() || '';
      const validation = validateOrgNummer(org);
      if (!validation.valid) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: validation.error }) }] };
      }
      
      try {
        const info = await fetchCompanyInfo(validation.cleanNumber);
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(info, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Okänt fel';
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: msg }) }] };
      }
    }
  );

  // Financials
  server.resource(
    'bolagsverket://financials/{org}',
    'Finansiella nyckeltal från senaste årsredovisning',
    async (uri) => {
      const org = uri.pathname.split('/').pop() || '';
      const validation = validateOrgNummer(org);
      if (!validation.valid) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: validation.error }) }] };
      }

      try {
        const { arsredovisning } = await fetchAndParseArsredovisning(validation.cleanNumber, 0);
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              org_nummer: arsredovisning.org_nummer,
              foretag_namn: arsredovisning.foretag_namn,
              rakenskapsar_slut: arsredovisning.rakenskapsar_slut,
              nyckeltal: arsredovisning.nyckeltal,
            }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Okänt fel';
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: msg }) }] };
      }
    }
  );

  // Nyckeltal för specifikt år
  server.resource(
    'bolagsverket://nyckeltal/{org}/{index}',
    'Nyckeltal för specifik årsredovisning (index 0 = senaste)',
    async (uri) => {
      const parts = uri.pathname.split('/').filter(Boolean);
      const org = parts[0] || '';
      const index = parseInt(parts[1] || '0', 10);
      
      const validation = validateOrgNummer(org);
      if (!validation.valid) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: validation.error }) }] };
      }

      try {
        const { arsredovisning, dokumentInfo } = await fetchAndParseArsredovisning(validation.cleanNumber, index);
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              org_nummer: arsredovisning.org_nummer,
              foretag_namn: arsredovisning.foretag_namn,
              rakenskapsperiod: dokumentInfo.rakenskapsperiod,
              nyckeltal: arsredovisning.nyckeltal,
              balansrakning: arsredovisning.balansrakning,
              resultatrakning: arsredovisning.resultatrakning,
            }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Okänt fel';
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: msg }) }] };
      }
    }
  );

  // People
  server.resource(
    'bolagsverket://people/{org}',
    'Styrelse och revisorer från senaste årsredovisning',
    async (uri) => {
      const org = uri.pathname.split('/').pop() || '';
      const validation = validateOrgNummer(org);
      if (!validation.valid) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: validation.error }) }] };
      }

      try {
        const { arsredovisning } = await fetchAndParseArsredovisning(validation.cleanNumber, 0);
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              org_nummer: arsredovisning.org_nummer,
              foretag_namn: arsredovisning.foretag_namn,
              personer: arsredovisning.personer,
            }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Okänt fel';
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: msg }) }] };
      }
    }
  );

  // Risk
  server.resource(
    'bolagsverket://risk/{org}',
    'Riskbedömning med röda flaggor',
    async (uri) => {
      const org = uri.pathname.split('/').pop() || '';
      const validation = validateOrgNummer(org);
      if (!validation.valid) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: validation.error }) }] };
      }

      try {
        const [companyInfo, fullAr] = await Promise.all([
          fetchCompanyInfo(validation.cleanNumber),
          fetchFullArsredovisning(validation.cleanNumber, 0),
        ]);

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              org_nummer: companyInfo.org_nummer,
              foretag_namn: companyInfo.namn,
              status: companyInfo.status,
              pagaende_konkurs: companyInfo.pagaende_konkurs,
              pagaende_likvidation: companyInfo.pagaende_likvidation,
              roda_flaggor: fullAr.roda_flaggor,
            }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Okänt fel';
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: msg }) }] };
      }
    }
  );

  // Annual reports list
  server.resource(
    'bolagsverket://annual-reports/{org}',
    'Lista över tillgängliga årsredovisningar',
    async (uri) => {
      const org = uri.pathname.split('/').pop() || '';
      const validation = validateOrgNummer(org);
      if (!validation.valid) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: validation.error }) }] };
      }

      try {
        const dokument = await fetchDokumentlistaForOrg(validation.cleanNumber);
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ org_nummer: validation.cleanNumber, antal: dokument.length, dokument }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Okänt fel';
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: msg }) }] };
      }
    }
  );

  // Server info
  server.resource(
    'bolagsverket://server-info',
    'Information om MCP-servern',
    async (uri) => {
      const cacheStats = cacheManager.getStats();
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ name: SERVER_CONFIG.NAME, version: SERVER_CONFIG.VERSION, cache: cacheStats }, null, 2),
        }],
      };
    }
  );

  console.error('[Resources] Registrerade 7 resurser');
}
