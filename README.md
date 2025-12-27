# Bolagsverket MCP Server (TypeScript)

MCP-server för att hämta och analysera företagsdata från Bolagsverkets API.

## Remote MCP Server (Claude.ai / ChatGPT)

Anslut till den hostade servern:

```
URL: https://bolagsverket-mcp-ts.onrender.com/mcp
Transport: Streamable HTTP
```

### Ansluta via Claude.ai

1. Gå till Claude.ai Settings → Integrations → Add MCP Server
2. Ange URL: `https://bolagsverket-mcp-ts.onrender.com/mcp`
3. Klicka "Connect"

### Ansluta via ChatGPT

Använd samma URL: `https://bolagsverket-mcp-ts.onrender.com/mcp`

## Installation (lokal utveckling)

```bash
npm install
npm run build
```

## Användning

### Claude Desktop (lokal)

Lägg till i `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bolagsverket": {
      "command": "node",
      "args": ["/path/to/bolagsverket-mcp-ts/dist/server.js"]
    }
  }
}
```

### Remote MCP (Streamable HTTP)

Starta servern med HTTP-transport:

```bash
npm run start:http
```

Eller med miljövariabel:

```bash
MCP_TRANSPORT=http npm start
```

### Deploy på Render

1. Anslut GitHub-repot till Render
2. Välj "Web Service"
3. Använd render.yaml för automatisk konfiguration

Alternativt manuell konfiguration:
- Build Command: `npm install && npm run build`
- Start Command: `node dist/server.js --http`
- Environment: `PORT=10000`, `MCP_TRANSPORT=http`

Endpoints:
- Health check: `https://your-app.onrender.com/health`
- MCP (primär): `https://your-app.onrender.com/` eller `https://your-app.onrender.com/mcp`
- SSE (legacy): `https://your-app.onrender.com/sse`

### Utveckling

```bash
npm run dev       # stdio
npm run dev:sse   # SSE/HTTP på port 3000
```

## Verktyg

| Verktyg | Beskrivning |
|---------|-------------|
| `bolagsverket_analyze_full` | Fullständig analys med nyckeltal, röda flaggor, styrelse |
| `bolagsverket_get_basic_info` | Grundläggande företagsinformation |
| `bolagsverket_get_address` | Endast adressinformation |
| `bolagsverket_get_verksamhet` | Verksamhetsbeskrivning och SNI-koder |
| `bolagsverket_get_company_status` | Status (aktiv, konkurs, likvidation) |
| `bolagsverket_get_nyckeltal` | Finansiella nyckeltal |
| `bolagsverket_get_styrelse` | Styrelse, VD och revisorer |
| `bolagsverket_list_arsredovisningar` | Lista tillgängliga årsredovisningar |
| `bolagsverket_risk_check` | Riskanalys med röda flaggor |
| `bolagsverket_trend` | Trendanalys över flera år |

## Resurser

| URI | Beskrivning |
|-----|-------------|
| `bolagsverket://company/{org}` | Företagsinformation |
| `bolagsverket://financials/{org}` | Nyckeltal |
| `bolagsverket://nyckeltal/{org}/{index}` | Nyckeltal för specifik årsredovisning |
| `bolagsverket://people/{org}` | Styrelse och revisorer |
| `bolagsverket://risk/{org}` | Riskbedömning |
| `bolagsverket://annual-reports/{org}` | Lista årsredovisningar |
| `bolagsverket://server-info` | Serverinformation |

## Prompts

| Prompt | Beskrivning |
|--------|-------------|
| `due-diligence` | Komplett due diligence-analys |
| `konkurrensjamforelse` | Jämför flera företag |
| `annual-report-summary` | Sammanfatta årsredovisning |
| `snabbkontroll` | Snabb statuskontroll |

## Miljövariabler

```bash
BOLAGSVERKET_CLIENT_ID=...      # OAuth2 client ID
BOLAGSVERKET_CLIENT_SECRET=...  # OAuth2 client secret
```

## Cache

SQLite-cache i `~/.cache/bolagsverket_mcp/cache.db`:

- Årsredovisningar: 30 dagar
- Företagsinfo: 1 dag
- Dokumentlistor: 7 dagar

## Licens

MIT
