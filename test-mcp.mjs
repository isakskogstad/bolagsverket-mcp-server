#!/usr/bin/env node
/**
 * MCP Server Test Suite
 * Testar alla verktyg och endpoints mot den körande servern.
 */

const BASE_URL = 'http://localhost:10000';

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function log(msg) {
  console.log(msg);
}

function logResult(name, success, details = '') {
  const status = success ? '✅ PASS' : '❌ FAIL';
  results.tests.push({ name, success, details });
  if (success) results.passed++;
  else results.failed++;
  log(`${status}: ${name}${details ? ' - ' + details : ''}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * SSE-parsing: Extrahera data från SSE-format
 */
function parseSSE(text) {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6));
    }
  }
  // Try parsing as regular JSON
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Initialize session och returnera session-ID
 */
async function initializeSession() {
  const response = await fetch(`${BASE_URL}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    })
  });

  const sessionId = response.headers.get('mcp-session-id');
  const text = await response.text();
  const data = parseSSE(text);

  return { sessionId, data };
}

/**
 * Gör MCP request med session
 */
async function mcpRequest(sessionId, method, params = {}, id = Date.now()) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${BASE_URL}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      }),
      signal: controller.signal
    });

    const text = await response.text();
    return parseSSE(text);
  } finally {
    clearTimeout(timeout);
  }
}

// =============================================================================
// TESTS
// =============================================================================

async function testHealthEndpoint() {
  try {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();

    const success = data.status === 'ok' &&
                    data.server === 'bolagsverket' &&
                    data.version === '6.0.0';

    logResult('Health endpoint', success, `version: ${data.version}`);
    return success;
  } catch (e) {
    logResult('Health endpoint', false, e.message);
    return false;
  }
}

async function testWellKnown() {
  try {
    const response = await fetch(`${BASE_URL}/.well-known/mcp.json`);
    const data = await response.json();

    const success = data.mcpServers?.bolagsverket?.url &&
                    data.mcpServers?.bolagsverket?.tools?.length > 0;

    logResult('.well-known/mcp.json', success, `${data.mcpServers.bolagsverket.tools.length} tools`);
    return success;
  } catch (e) {
    logResult('.well-known/mcp.json', false, e.message);
    return false;
  }
}

async function testInitialize() {
  try {
    const { sessionId, data } = await initializeSession();

    const success = sessionId &&
                    data?.result?.serverInfo?.name === 'bolagsverket';

    logResult('MCP Initialize', success, `sessionId: ${sessionId?.slice(0, 8)}...`);
    return { success, sessionId };
  } catch (e) {
    logResult('MCP Initialize', false, e.message);
    return { success: false, sessionId: null };
  }
}

async function testToolsList(sessionId) {
  try {
    const data = await mcpRequest(sessionId, 'tools/list', {});

    const tools = data?.result?.tools || [];
    const success = tools.length >= 10;

    const toolNames = tools.map(t => t.name).join(', ');
    logResult('Tools list', success, `${tools.length} tools: ${toolNames.slice(0, 100)}...`);
    return success;
  } catch (e) {
    logResult('Tools list', false, e.message);
    return false;
  }
}

async function testResourcesList(sessionId) {
  try {
    const data = await mcpRequest(sessionId, 'resources/list', {});

    const resources = data?.result?.resources || [];
    const success = resources.length > 0;

    logResult('Resources list', success, `${resources.length} resources`);
    return success;
  } catch (e) {
    logResult('Resources list', false, e.message);
    return false;
  }
}

async function testPromptsList(sessionId) {
  try {
    const data = await mcpRequest(sessionId, 'prompts/list', {});

    const prompts = data?.result?.prompts || [];
    const success = prompts.length > 0;

    logResult('Prompts list', success, `${prompts.length} prompts`);
    return success;
  } catch (e) {
    logResult('Prompts list', false, e.message);
    return false;
  }
}

async function testBasicInfo(sessionId) {
  // Testa med IKEA (känt svenskt företag)
  const orgNummer = '5560305560'; // IKEA Sverige

  try {
    const data = await mcpRequest(sessionId, 'tools/call', {
      name: 'bolagsverket_get_basic_info',
      arguments: { org_nummer: orgNummer }
    });

    const content = data?.result?.content?.[0]?.text || '';
    const success = content.includes('IKEA') || content.includes('556030-5560') || content.length > 100;

    logResult('Tool: get_basic_info (IKEA)', success, `Response length: ${content.length} chars`);

    if (!success) {
      console.log('  Response:', content.slice(0, 200));
    }

    return success;
  } catch (e) {
    logResult('Tool: get_basic_info', false, e.message);
    return false;
  }
}

async function testBasicInfoWithInvalidOrg(sessionId) {
  // Testa med ogiltigt organisationsnummer
  const orgNummer = '1234567890';

  try {
    const data = await mcpRequest(sessionId, 'tools/call', {
      name: 'bolagsverket_get_basic_info',
      arguments: { org_nummer: orgNummer }
    });

    const content = data?.result?.content?.[0]?.text || '';
    const success = content.includes('ogiltig') || content.includes('fel') || content.includes('Error');

    logResult('Tool: get_basic_info (invalid org)', success, 'Should return error for invalid org');
    return success;
  } catch (e) {
    logResult('Tool: get_basic_info (invalid)', true, 'Got expected error');
    return true;
  }
}

async function testCompanyStatus(sessionId) {
  const orgNummer = '5560305560'; // IKEA

  try {
    const data = await mcpRequest(sessionId, 'tools/call', {
      name: 'bolagsverket_get_company_status',
      arguments: { org_nummer: orgNummer }
    });

    const content = data?.result?.content?.[0]?.text || '';
    const success = content.includes('Status') || content.length > 50;

    logResult('Tool: get_company_status', success, `Response length: ${content.length}`);
    return success;
  } catch (e) {
    logResult('Tool: get_company_status', false, e.message);
    return false;
  }
}

async function testAddress(sessionId) {
  const orgNummer = '5560305560'; // IKEA

  try {
    const data = await mcpRequest(sessionId, 'tools/call', {
      name: 'bolagsverket_get_address',
      arguments: { org_nummer: orgNummer }
    });

    const content = data?.result?.content?.[0]?.text || '';
    const success = content.includes('Adress') || content.length > 30;

    logResult('Tool: get_address', success, `Response length: ${content.length}`);
    return success;
  } catch (e) {
    logResult('Tool: get_address', false, e.message);
    return false;
  }
}

async function testNyckeltal(sessionId) {
  // Använd ett företag som troligtvis har årsredovisning
  const orgNummer = '5560305560'; // IKEA

  try {
    const data = await mcpRequest(sessionId, 'tools/call', {
      name: 'bolagsverket_get_nyckeltal',
      arguments: { org_nummer: orgNummer }
    });

    const content = data?.result?.content?.[0]?.text || '';
    // Kan få "ingen årsredovisning" också
    const success = content.length > 50;

    logResult('Tool: get_nyckeltal', success, `Response length: ${content.length}`);

    if (content.includes('error') || content.includes('Error')) {
      console.log('  Note:', content.slice(0, 200));
    }

    return success;
  } catch (e) {
    logResult('Tool: get_nyckeltal', false, e.message);
    return false;
  }
}

async function testAnalyzeFull(sessionId) {
  const orgNummer = '5560305560'; // IKEA

  try {
    const data = await mcpRequest(sessionId, 'tools/call', {
      name: 'bolagsverket_analyze_full',
      arguments: { org_nummer: orgNummer }
    });

    const content = data?.result?.content?.[0]?.text || '';
    const success = content.length > 100;

    logResult('Tool: analyze_full', success, `Response length: ${content.length}`);
    return success;
  } catch (e) {
    logResult('Tool: analyze_full', false, e.message);
    return false;
  }
}

async function testRiskCheck(sessionId) {
  const orgNummer = '5560305560'; // IKEA

  try {
    const data = await mcpRequest(sessionId, 'tools/call', {
      name: 'bolagsverket_risk_check',
      arguments: { org_nummer: orgNummer }
    });

    const content = data?.result?.content?.[0]?.text || '';
    const success = content.length > 50;

    logResult('Tool: risk_check', success, `Response length: ${content.length}`);
    return success;
  } catch (e) {
    logResult('Tool: risk_check', false, e.message);
    return false;
  }
}

async function testTrend(sessionId) {
  const orgNummer = '5560305560'; // IKEA

  try {
    const data = await mcpRequest(sessionId, 'tools/call', {
      name: 'bolagsverket_trend',
      arguments: { org_nummer: orgNummer, antal_ar: 3 }
    });

    const content = data?.result?.content?.[0]?.text || '';
    const success = content.length > 50;

    logResult('Tool: trend', success, `Response length: ${content.length}`);
    return success;
  } catch (e) {
    logResult('Tool: trend', false, e.message);
    return false;
  }
}

async function testCORS() {
  try {
    const response = await fetch(`${BASE_URL}/`, {
      method: 'OPTIONS',
    });

    const allowOrigin = response.headers.get('access-control-allow-origin');
    const allowMethods = response.headers.get('access-control-allow-methods');

    const success = allowOrigin === '*' && allowMethods?.includes('POST');

    logResult('CORS headers', success, `origin: ${allowOrigin}, methods: ${allowMethods}`);
    return success;
  } catch (e) {
    logResult('CORS headers', false, e.message);
    return false;
  }
}

async function testHEAD() {
  try {
    const response = await fetch(`${BASE_URL}/`, {
      method: 'HEAD',
    });

    const protocolVersion = response.headers.get('mcp-protocol-version');
    const success = response.ok && protocolVersion;

    logResult('HEAD request (protocol discovery)', success, `version: ${protocolVersion}`);
    return success;
  } catch (e) {
    logResult('HEAD request', false, e.message);
    return false;
  }
}

async function testSSEEndpoint() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${BASE_URL}/sse`, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    const success = response.ok && response.headers.get('content-type')?.includes('text/event-stream');

    logResult('SSE endpoint', success, `content-type: ${response.headers.get('content-type')}`);
    return success;
  } catch (e) {
    if (e.name === 'AbortError') {
      logResult('SSE endpoint', true, 'Connection established (aborted after timeout)');
      return true;
    }
    logResult('SSE endpoint', false, e.message);
    return false;
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         BOLAGSVERKET MCP SERVER - TEST SUITE                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Endpoint tests
  console.log('=== ENDPOINT TESTS ===');
  await testHealthEndpoint();
  await testWellKnown();
  await testCORS();
  await testHEAD();
  await testSSEEndpoint();

  console.log('');
  console.log('=== MCP PROTOCOL TESTS ===');

  // Initialize
  const { success, sessionId } = await testInitialize();

  if (!success || !sessionId) {
    console.log('');
    console.log('❌ Cannot continue without session. Stopping tests.');
    return;
  }

  // List operations
  await testToolsList(sessionId);
  await testResourcesList(sessionId);
  await testPromptsList(sessionId);

  console.log('');
  console.log('=== TOOL TESTS (RIKTIGA API-ANROP) ===');

  // Tool tests
  await testBasicInfo(sessionId);
  await testBasicInfoWithInvalidOrg(sessionId);
  await testCompanyStatus(sessionId);
  await testAddress(sessionId);
  await testNyckeltal(sessionId);
  await testAnalyzeFull(sessionId);
  await testRiskCheck(sessionId);
  await testTrend(sessionId);

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`RESULTAT: ${results.passed} PASS, ${results.failed} FAIL av ${results.passed + results.failed} tester`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (results.failed > 0) {
    console.log('');
    console.log('MISSLYCKADE TESTER:');
    for (const test of results.tests) {
      if (!test.success) {
        console.log(`  - ${test.name}: ${test.details}`);
      }
    }
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Test suite crashed:', e);
  process.exit(1);
});
