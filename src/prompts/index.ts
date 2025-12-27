/**
 * Bolagsverket MCP Server - Prompts
 * Workflow-mallar för vanliga uppgifter.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Registrera alla prompts.
 */
export function registerPrompts(server: McpServer): void {
  // Due diligence
  server.prompt(
    'due-diligence',
    'Komplett due diligence-analys av ett företag',
    { org_nummer: z.string().describe('Organisationsnummer för företaget') },
    async (args) => {
      const orgNummer = args.org_nummer || '[ORGANISATIONSNUMMER]';
      
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Genomför en komplett due diligence-analys av företaget med organisationsnummer ${orgNummer}.

Använd följande verktyg i ordning:

1. **bolagsverket_get_basic_info** - Hämta grundläggande företagsinformation
2. **bolagsverket_analyze_full** - Fullständig finansiell analys
3. **bolagsverket_risk_check** - Identifiera röda flaggor
4. **bolagsverket_trend** - Analysera historisk utveckling

Sammanställ sedan en rapport med följande sektioner:

## Sammanfattning
- Kort översikt av företaget och dess verksamhet
- Övergripande bedömning (Rekommenderas / Med reservation / Avrådes)

## Företagsinformation
- Namn, organisationsform, registreringsdatum
- Adress och verksamhetsbeskrivning
- SNI-koder

## Finansiell ställning
- Senaste nyckeltal (omsättning, resultat, soliditet)
- Jämförelse med föregående år
- Trend över tid

## Riskbedömning
- Identifierade röda flaggor
- Pågående förfaranden (konkurs, likvidation)
- Rekommendationer

## Styrelse och ledning
- Styrelseledamöter och revisorer
- Eventuella anmärkningar

Avsluta med en tydlig rekommendation och eventuella uppföljningsfrågor.`,
            },
          },
        ],
      };
    }
  );

  // Konkurrensjämförelse
  server.prompt(
    'konkurrensjamforelse',
    'Jämför finansiella nyckeltal mellan flera företag',
    { org_nummer_lista: z.string().describe('Kommaseparerad lista med organisationsnummer') },
    async (args) => {
      const orgLista = args.org_nummer_lista || '[ORG1, ORG2, ORG3]';
      
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Genomför en konkurrensjämförelse mellan följande företag: ${orgLista}

För varje företag, använd:
- **bolagsverket_get_basic_info** - Grundläggande info
- **bolagsverket_get_nyckeltal** - Finansiella nyckeltal

Skapa sedan en jämförande analys med:

## Företagsöversikt
Kort presentation av varje företag (namn, verksamhet, storlek)

## Finansiell jämförelse

| Nyckeltal | Företag 1 | Företag 2 | Företag 3 |
|-----------|-----------|-----------|-----------|
| Omsättning | | | |
| Resultat | | | |
| Soliditet | | | |
| Anställda | | | |

## Styrkor och svagheter
För varje företag, identifiera:
- Finansiella styrkor
- Potentiella svagheter
- Konkurrensfördelar

## Sammanfattning
- Vilket företag har starkast finansiell ställning?
- Vilket företag växer snabbast?
- Övergripande rekommendation`,
            },
          },
        ],
      };
    }
  );

  // Årsredovisningssammanfattning
  server.prompt(
    'annual-report-summary',
    'Sammanfatta en årsredovisning i klartext',
    {
      org_nummer: z.string().describe('Organisationsnummer'),
      index: z.string().optional().describe('Årsredovisningsindex (0 = senaste)'),
    },
    async (args) => {
      const orgNummer = args.org_nummer || '[ORGANISATIONSNUMMER]';
      const index = args.index || '0';
      
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Sammanfatta årsredovisningen för ${orgNummer} (index: ${index}) i klartext.

Använd:
- **bolagsverket_analyze_full** med org_nummer="${orgNummer}" och index=${index}

Skriv sedan en lättförståelig sammanfattning som täcker:

## Om företaget
Vad gör företaget? Hur länge har det funnits?

## Årets resultat
- Hur gick det ekonomiskt?
- Ökade eller minskade omsättningen?
- Gick företaget med vinst eller förlust?

## Finansiell hälsa
- Är företaget stabilt? (soliditet)
- Finns det varningssignaler?

## Styrelse och ledning
- Vilka leder företaget?
- Har det skett förändringar?

## Slutsats
En mening som sammanfattar företagets läge.

Skriv för en läsare utan ekonomisk bakgrund. Undvik facktermer eller förklara dem.`,
            },
          },
        ],
      };
    }
  );

  // Snabbkontroll
  server.prompt(
    'snabbkontroll',
    'Snabb kontroll av ett företag (status, röda flaggor)',
    { org_nummer: z.string().describe('Organisationsnummer') },
    async (args) => {
      const orgNummer = args.org_nummer || '[ORGANISATIONSNUMMER]';
      
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Gör en snabbkontroll av ${orgNummer}.

Använd:
1. **bolagsverket_get_company_status** - Kontrollera status
2. **bolagsverket_risk_check** - Identifiera varningar

Svara kortfattat:

✅/⚠️/❌ **[Företagsnamn]**

**Status:** Aktivt/Avregistrerat/Konkurs/Likvidation
**Röda flaggor:** X st (eller "Inga")

Om det finns varningar, lista dem kort.
Avsluta med: "Rekommenderas" / "Kräver vidare utredning" / "Avrådes"`,
            },
          },
        ],
      };
    }
  );

  console.error('[Prompts] Registrerade 4 prompts');
}
