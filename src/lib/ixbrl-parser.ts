/**
 * Bolagsverket MCP Server - iXBRL Parser
 * Parsar iXBRL-dokument (inline XBRL) med Cheerio.
 * Stödjer K2, K3 och K3K taxonomier.
 */

import * as cheerio from 'cheerio';
import type {
  Nyckeltal,
  KoncernNyckeltal,
  Person,
  Balansrakning,
  Resultatrakning,
  Revisionsberattelse,
  Faststallelseintyg,
  TaxonomiInfo,
  UtokadInformation,
  OdefiniertBegrepp,
  Notkoppling,
} from '../types/index.js';

type CheerioAPI = cheerio.CheerioAPI;

/**
 * Alternativa namnmönster för iXBRL-element.
 * Olika taxonomiversioner och dokumenttyper kan använda olika namngivning.
 * Utökad lista för att hantera alla vanliga varianter i svenska årsredovisningar.
 */
const ELEMENT_ALIASES: Record<string, string[]> = {
  // Resultat - utökade varianter
  'Nettoomsattning': [
    'Nettoomsattning', 'NettoOmsattning', 'Nettoomsättning', 'RorelseintakterNetto',
    'Nettoomsättningen', 'Omsattning', 'Omsättning', 'ForetagetstNettoomsattning',
    'Intakter', 'SummaIntakter', 'RorelseIntakter', 'Rörelseintäkter',
    // K2/K3 specifika
    'NettoomsattningAB', 'NettoomsattningHB', 'SalesRevenue', 'NetSales',
    'RorelseintakterLagerforandringarMm', 'Rorelseintakter',
  ],
  'ResultatEfterFinansiellaPoster': [
    'ResultatEfterFinansiellaPoster', 'ResultatEfterFinansiellaIntakterKostnader',
    'ResultatForeBokslutsdispositioner', 'ResultatEfterFinPoster',
    'AretsResultatForeBokslutsdispositioner', 'ResultatFinansiella',
    'ResultatEfterFinansiellaKostnader', 'ProfitLossAfterFinancialItems',
  ],
  'AretsResultat': [
    'AretsResultat', 'ÅretsResultat', 'Arsresultat', 'NetResultat',
    'ResultatAretsResultat', 'Årsresultat', 'AretsResultatEfterSkatt',
    'NettoResultat', 'ProfitLoss', 'ResultatEfterSkatt', 'Resultat',
    'NetIncome', 'AretsOverskott', 'AretsUnderskott',
  ],
  'Rorelseresultat': [
    'Rorelseresultat', 'RörelseResultat', 'Rörelseresultat',
    'RorelseResultat', 'OperatingProfit', 'OperatingIncome',
    'RorelseresultatForeFin', 'ResultatForeFinansiellaPoster',
  ],

  // Balans - utökade varianter
  'EgetKapital': [
    'EgetKapital', 'SummaEgetKapital', 'EgetKapitalOchSkulder', 'TotalEgetKapital',
    'Eget_kapital', 'SummaEK', 'TotalEquity', 'Equity', 'EgetKapitalSumma',
    'EgetKapitalInklAretsResultat', 'SummaEgetKapitalSkulder',
    'EgetKapitalOchObeskattadeReserver',
  ],
  'Tillgangar': [
    'Tillgangar', 'SummaTillgangar', 'Balansomslutning', 'TotalTillgangar',
    'TotalAssets', 'Assets', 'SummaBalansrakning', 'SummaTillgångar',
    'BalansomslutningTillgangar', 'SummaAnlaggningstillgangarOmsattningstillgangar',
  ],

  // Personal - utökade varianter
  'MedelantaletAnstallda': [
    'MedelantaletAnstallda', 'AntalAnstallda', 'GenomsnittligtAntalAnstallda',
    'Medelantal', 'MedeltAnstallda', 'PersonalMedeltal', 'Anstallda',
    'AverageNumberOfEmployees', 'NumberOfEmployees', 'Employees',
    'AntaletAnstallda', 'MedelAntalAnstallda',
  ],
};

/**
 * Namespace-prefix varianter att söka efter.
 * Olika taxonomier använder olika namespace-prefix.
 */
const NAMESPACE_PREFIXES = [
  'ix:', 'ix2:', 'ix3:', 'xbrli:', 'ixt:', 'se-gen-base:',
  'se-k2-base:', 'se-k3-base:', 'se-cd-base:',
];

/**
 * Interface för att spåra parservarningar.
 */
export interface ParseWarning {
  typ: 'MISSING_DATA' | 'INCONSISTENT_DATA' | 'PARSE_ERROR' | 'TAXONOMY_MISMATCH';
  falt: string;
  beskrivning: string;
  varde?: unknown;
}

/**
 * Parser för iXBRL-dokument från Bolagsverket.
 */
export class IXBRLParser {
  private $: CheerioAPI;
  private warnings: ParseWarning[] = [];
  private detectedContexts: { periods: string[]; balances: string[] } | null = null;

  constructor(xhtmlContent: string) {
    this.$ = cheerio.load(xhtmlContent, { xmlMode: true });
    // Detektera kontexter vid initiering
    this.detectContexts();
  }

  /**
   * Detektera tillgängliga kontext-referensvärden i dokumentet.
   * Olika dokument använder olika namngivning (period0, CurrentPeriod, etc.)
   */
  private detectContexts(): void {
    const $ = this.$;
    const periodContexts = new Set<string>();
    const balanceContexts = new Set<string>();

    // Hitta alla xbrli:context-element
    $('xbrli\\:context, context, [id]').each((_, el) => {
      const $el = $(el);
      const id = $el.attr('id');
      if (!id) return;

      // Kontrollera om detta är en period eller instant-kontext
      const hasPeriod = $el.find('xbrli\\:period, period').length > 0;
      const hasInstant = $el.find('xbrli\\:instant, instant').length > 0;
      const hasStartEnd = $el.find('xbrli\\:startDate, startDate, xbrli\\:endDate, endDate').length > 0;

      if (hasInstant) {
        balanceContexts.add(id);
      } else if (hasStartEnd || hasPeriod) {
        periodContexts.add(id);
      }
    });

    // Fallback: hitta alla contextRef-attribut
    $('[contextRef]').each((_, el) => {
      const contextRef = $(el).attr('contextRef');
      if (contextRef) {
        // Gissa baserat på namnmönster
        const lowerRef = contextRef.toLowerCase();
        if (lowerRef.includes('instant') || lowerRef.includes('balans') || lowerRef.includes('balance')) {
          balanceContexts.add(contextRef);
        } else if (lowerRef.includes('period') || lowerRef.includes('duration') || lowerRef.includes('current')) {
          periodContexts.add(contextRef);
        } else {
          // Lägg till i båda som fallback
          periodContexts.add(contextRef);
          balanceContexts.add(contextRef);
        }
      }
    });

    // Sortera och spara - prioritera kortare namn (vanligtvis mer generella)
    const sortByLength = (a: string, b: string) => a.length - b.length;

    this.detectedContexts = {
      periods: Array.from(periodContexts).sort(sortByLength),
      balances: Array.from(balanceContexts).sort(sortByLength),
    };

    if (periodContexts.size > 0 || balanceContexts.size > 0) {
      console.error(`[IXBRLParser] Detekterade kontexter: perioder=${Array.from(periodContexts).join(', ')}, balanser=${Array.from(balanceContexts).join(', ')}`);
    }
  }

  /**
   * Hämta detekterade kontextreferenser med fallbacks.
   */
  private getContextRefs(type: 'period' | 'balance', requestedRef: string): string[] {
    const refs: string[] = [requestedRef];

    // Lägg till standard-varianter
    if (type === 'period') {
      refs.push('period0', 'period1', 'CurrentPeriod', 'CurrentYear', 'instant0', 'duration0', 'duration1');
    } else {
      refs.push('balans0', 'balans1', 'instant0', 'instant1', 'CurrentInstant', 'Balance', 'BalanceAtPeriodEnd');
    }

    // Lägg till detekterade kontexter
    if (this.detectedContexts) {
      const detected = type === 'period' ? this.detectedContexts.periods : this.detectedContexts.balances;
      for (const ctx of detected) {
        if (!refs.includes(ctx)) {
          refs.push(ctx);
        }
      }
    }

    return refs;
  }

  /**
   * Hämta parservarningar.
   */
  getWarnings(): ParseWarning[] {
    return [...this.warnings];
  }

  /**
   * Lägg till en varning.
   */
  private addWarning(typ: ParseWarning['typ'], falt: string, beskrivning: string, varde?: unknown) {
    this.warnings.push({ typ, falt, beskrivning, varde });
  }

  /**
   * Hämta numeriskt värde från iXBRL-tagg med fallback till alternativa namn.
   * Utökad för att stödja fler namespace-varianter och kontext-mönster.
   */
  private getValue(namePattern: string, contextRef: string): number | null {
    const $ = this.$;

    // Hämta alla alternativa namn för detta mönster
    const patterns = ELEMENT_ALIASES[namePattern] || [namePattern];

    for (const pattern of patterns) {
      // Bygg selektorer med alla namespace-varianter
      const selectors: string[] = [];

      // Namespace-varianter för iXBRL
      for (const ns of ['ix', 'ix2', 'ix3', 'xbrli', 'ixt']) {
        selectors.push(`${ns}\\:nonFraction[name*="${pattern}"][contextRef="${contextRef}"]`);
        selectors.push(`${ns}\\:nonfraction[name*="${pattern}"][contextRef="${contextRef}"]`);
        selectors.push(`${ns}\\:NonFraction[name*="${pattern}"][contextRef="${contextRef}"]`);
      }

      // Generisk selector utan specifikt namespace
      selectors.push(`[name*="${pattern}"][contextRef="${contextRef}"]`);

      // Case-insensitive variant (små bokstäver i mönster)
      const lowerPattern = pattern.toLowerCase();
      if (lowerPattern !== pattern) {
        selectors.push(`[name*="${lowerPattern}"][contextRef="${contextRef}"]`);
      }

      const selector = selectors.join(', ');

      const element = $(selector).first();
      if (element.length === 0) continue;

      let text = element.text().trim().replace(/\s/g, '');

      // Hantera tomma element eller element med enbart whitespace
      if (!text || text === '-' || text === '—' || text === '–') continue;

      // Hantera europeiskt decimalformat (1.234,56 -> 1234.56)
      if (text.includes(',')) {
        // Kontrollera om det är 1.234,56 format (punkter som tusentalsavgränsare)
        if (text.match(/\d+\.\d+,\d+/)) {
          text = text.replace(/\./g, '').replace(',', '.');
        } else if (text.match(/^\d{1,3}(\.\d{3})+,\d+$/)) {
          // 1.234.567,89 format
          text = text.replace(/\./g, '').replace(',', '.');
        } else {
          // Annars är det 1234,56 format
          text = text.replace(',', '.');
        }
      }

      // Hantera sign-attribut
      const sign = element.attr('sign');
      if (sign === '-') text = `-${text.replace('-', '')}`;

      // Hantera format-attribut
      const format = element.attr('format');
      if (format?.includes('numdotdecimal')) {
        // Format: 1,234.56 -> 1234.56
        text = text.replace(/,/g, '');
      } else if (format?.includes('numcommadecimal')) {
        // Format: 1.234,56 -> 1234.56
        text = text.replace(/\./g, '').replace(',', '.');
      }

      const scale = parseInt(element.attr('scale') || '0', 10);
      const decimals = element.attr('decimals');
      const value = parseFloat(text);

      if (!isNaN(value)) {
        return Math.round(value * Math.pow(10, scale));
      }
    }

    return null;
  }

  /**
   * Försök hitta värde genom att söka i hela dokumentet utan specifik kontextref.
   * Används som fallback när standard-sökningen inte hittar något.
   */
  private getValueAnyContext(namePattern: string): { value: number; contextRef: string } | null {
    const $ = this.$;
    const patterns = ELEMENT_ALIASES[namePattern] || [namePattern];

    for (const pattern of patterns) {
      // Sök efter element med detta namnmönster, oavsett kontext
      const selector = `[name*="${pattern}"]`;
      const elements = $(selector);

      if (elements.length === 0) continue;

      // Försök hitta det första elementet med ett giltigt numeriskt värde
      for (let i = 0; i < elements.length; i++) {
        const element = $(elements[i]);
        const contextRef = element.attr('contextRef');
        if (!contextRef) continue;

        let text = element.text().trim().replace(/\s/g, '');
        if (!text || text === '-' || text === '—' || text === '–') continue;

        // Hantera format
        if (text.includes(',')) {
          if (text.match(/\d+\.\d+,\d+/) || text.match(/^\d{1,3}(\.\d{3})+,\d+$/)) {
            text = text.replace(/\./g, '').replace(',', '.');
          } else {
            text = text.replace(',', '.');
          }
        }

        const sign = element.attr('sign');
        if (sign === '-') text = `-${text.replace('-', '')}`;

        const scale = parseInt(element.attr('scale') || '0', 10);
        const value = parseFloat(text);

        if (!isNaN(value)) {
          return { value: Math.round(value * Math.pow(10, scale)), contextRef };
        }
      }
    }

    return null;
  }

  /**
   * Hämta textvärde från iXBRL-tagg.
   */
  private getTextValue(namePattern: string, contextRef?: string): string | null {
    const $ = this.$;
    let selector = `ix\\:nonNumeric[name*="${namePattern}"], ix\\:nonnumeric[name*="${namePattern}"]`;
    if (contextRef) {
      selector = `ix\\:nonNumeric[name*="${namePattern}"][contextRef="${contextRef}"], ` +
                 `ix\\:nonnumeric[name*="${namePattern}"][contextRef="${contextRef}"]`;
    }
    const element = $(selector).first();
    return element.length > 0 ? element.text().trim() : null;
  }

  /**
   * Hämta nyckeltal för angiven period med sanitetskontroller.
   * Använder utökad kontextdetektering och fallback-sökning.
   */
  getNyckeltal(period = 'period0'): Nyckeltal {
    const balans = period === 'period0' ? 'balans0' : 'balans1';

    // Hämta utökade kontextreferenser baserat på detekterade kontexter
    const periodRefs = this.getContextRefs('period', period);
    const balansRefs = this.getContextRefs('balance', balans);

    // Funktion för att hitta värde med fallback-perioder och sist global sökning
    const getValueWithFallback = (pattern: string, refs: string[], useGlobalFallback = true): number | null => {
      // Första försöket: specifika kontextreferenser
      for (const ref of refs) {
        const val = this.getValue(pattern, ref);
        if (val !== null) return val;
      }

      // Andra försöket: sök utan specifik kontext om tillåtet
      if (useGlobalFallback) {
        const anyResult = this.getValueAnyContext(pattern);
        if (anyResult) {
          console.error(`[IXBRLParser] Hittade ${pattern} via global sökning med kontext: ${anyResult.contextRef}`);
          return anyResult.value;
        }
      }

      return null;
    };

    const nyckeltal: Nyckeltal = {
      nettoomsattning: getValueWithFallback('Nettoomsattning', periodRefs),
      resultat_efter_finansiella: getValueWithFallback('ResultatEfterFinansiellaPoster', periodRefs),
      arets_resultat: getValueWithFallback('AretsResultat', periodRefs),
      eget_kapital: getValueWithFallback('EgetKapital', balansRefs),
      balansomslutning: getValueWithFallback('Tillgangar', balansRefs),
      antal_anstallda: getValueWithFallback('MedelantaletAnstallda', periodRefs),
    };

    // Sanitetskontroller för finansiella data
    this.validateFinancialConsistency(nyckeltal);

    // Beräkna härledda nyckeltal
    if (nyckeltal.eget_kapital != null && nyckeltal.balansomslutning && nyckeltal.balansomslutning > 0) {
      nyckeltal.soliditet = Math.round((nyckeltal.eget_kapital / nyckeltal.balansomslutning) * 1000) / 10;
    }
    if (nyckeltal.nettoomsattning && nyckeltal.arets_resultat != null && nyckeltal.nettoomsattning > 0) {
      nyckeltal.vinstmarginal = Math.round((nyckeltal.arets_resultat / nyckeltal.nettoomsattning) * 1000) / 10;
    }
    if (nyckeltal.eget_kapital && nyckeltal.eget_kapital > 0 && nyckeltal.arets_resultat != null) {
      nyckeltal.roe = Math.round((nyckeltal.arets_resultat / nyckeltal.eget_kapital) * 1000) / 10;
    }

    // Kontrollera om vi fick tillräckligt med data
    const grundFields = ['nettoomsattning', 'resultat_efter_finansiella', 'arets_resultat',
                        'eget_kapital', 'balansomslutning', 'antal_anstallda'];
    const fieldsWithData = grundFields.filter(k => (nyckeltal as any)[k] !== null && (nyckeltal as any)[k] !== undefined).length;

    if (fieldsWithData < 2) {
      this.addWarning('MISSING_DATA', 'nyckeltal',
        `Endast ${fieldsWithData} av 6 grundnyckeltal kunde extraheras. Dokumentet kan ha annorlunda struktur.`);
    } else if (fieldsWithData < 4) {
      // Info-varning för delvis extrahering
      console.error(`[IXBRLParser] Partiell extraktion: ${fieldsWithData} av 6 grundnyckeltal extraherade.`);
    }

    return nyckeltal;
  }

  /**
   * Validera att finansiella data är internt konsistenta.
   */
  private validateFinancialConsistency(nyckeltal: Nyckeltal): void {
    const { resultat_efter_finansiella, arets_resultat, nettoomsattning, eget_kapital } = nyckeltal;

    // Kontroll 1: Resultat efter finansiella vs årets resultat
    // Normalt: årets resultat = resultat efter finansiella - skatt (+/- bokslutsdispositioner)
    // Så om ena är positiv och andra är negativ (med stor differens) är något fel
    if (resultat_efter_finansiella != null && arets_resultat != null) {
      const rafSign = Math.sign(resultat_efter_finansiella);
      const arSign = Math.sign(arets_resultat);

      // Om tecknen skiljer sig åt (exkl. 0) och differensen är stor
      if (rafSign !== 0 && arSign !== 0 && rafSign !== arSign) {
        const diff = Math.abs(resultat_efter_finansiella - arets_resultat);
        const maxAbs = Math.max(Math.abs(resultat_efter_finansiella), Math.abs(arets_resultat));

        // Om differensen är mer än 200% av det största värdet
        if (diff > maxAbs * 2) {
          this.addWarning('INCONSISTENT_DATA', 'resultat',
            `Resultat efter finansiella (${resultat_efter_finansiella}) och årets resultat (${arets_resultat}) har olika tecken med stor differens. Kontrollera data.`,
            { resultat_efter_finansiella, arets_resultat });
        }
      }
    }

    // Kontroll 2: Negativt eget kapital med positiva resultat över tid
    if (eget_kapital != null && eget_kapital < 0 && arets_resultat != null && arets_resultat > 0) {
      // Detta kan vara korrekt men bör noteras
      this.addWarning('INCONSISTENT_DATA', 'eget_kapital',
        `Negativt eget kapital (${eget_kapital}) trots positivt årsresultat (${arets_resultat}). Kan indikera ansamlade förluster.`,
        { eget_kapital, arets_resultat });
    }

    // Kontroll 3: Extrem vinstmarginal
    if (nettoomsattning && nettoomsattning > 0 && arets_resultat != null) {
      const vinstmarginal = (arets_resultat / nettoomsattning) * 100;
      if (Math.abs(vinstmarginal) > 500) {
        this.addWarning('INCONSISTENT_DATA', 'vinstmarginal',
          `Extrem vinstmarginal (${vinstmarginal.toFixed(1)}%) indikerar möjligt parsningsfel.`,
          { vinstmarginal, nettoomsattning, arets_resultat });
      }
    }
  }

  /**
   * Hämta koncernnyckeltal (K3K).
   */
  getKoncernNyckeltal(period = 'period0'): KoncernNyckeltal {
    const balans = period === 'period0' ? 'balans0' : 'balans1';
    const koncern: KoncernNyckeltal = {
      koncern_nettoomsattning: this.getValue('KoncernensNettoomsattning', period),
      koncern_rorelseresultat: this.getValue('KoncernensRorelseresultat', period),
      koncern_resultat_efter_finansiella: this.getValue('KoncernensResultatEfterFinansiellaPoster', period),
      koncern_arets_resultat: this.getValue('KoncernensAretsResultat', period),
      koncern_eget_kapital: this.getValue('KoncernensEgetKapital', balans),
      koncern_balansomslutning: this.getValue('KoncernensTillgangar', balans),
      minoritetsandel: this.getValue('Minoritetsandelar', balans),
      goodwill: this.getValue('Goodwill', balans),
    };

    if (koncern.koncern_eget_kapital && koncern.koncern_balansomslutning && koncern.koncern_balansomslutning > 0) {
      koncern.koncern_soliditet = Math.round((koncern.koncern_eget_kapital / koncern.koncern_balansomslutning) * 1000) / 10;
    }
    return koncern;
  }

  /**
   * Hämta balansräkning med utökad kontextdetektering.
   */
  getBalansrakning(period = 'balans0'): Balansrakning {
    const balansRefs = this.getContextRefs('balance', period);

    // Funktion för att hitta värde med fallback
    const getVal = (pattern: string): number | undefined => {
      for (const ref of balansRefs) {
        const val = this.getValue(pattern, ref);
        if (val !== null) return val;
      }
      // Fallback: global sökning
      const anyResult = this.getValueAnyContext(pattern);
      return anyResult?.value ?? undefined;
    };

    return {
      tillgangar: {
        immateriella: getVal('ImmateriellAnlaggningstillgangar'),
        materiella: getVal('MateriellaAnlaggningstillgangar'),
        finansiella: getVal('FinansiellaAnlaggningstillgangar'),
        varulager: getVal('VarulagerMm'),
        kundfordringar: getVal('Kundfordringar'),
        kassa_bank: getVal('KassaBank'),
        summa_omsattning: getVal('Omsattningstillgangar'),
        summa_tillgangar: getVal('Tillgangar'),
      },
      eget_kapital_skulder: {
        aktiekapital: getVal('Aktiekapital'),
        balanserat_resultat: getVal('BalanseratResultat'),
        arets_resultat: getVal('AretsResultatEgetKapital'),
        summa_eget_kapital: getVal('EgetKapital'),
        langfristiga_skulder: getVal('LangfristigaSkulder'),
        kortfristiga_skulder: getVal('KortfristigaSkulder'),
        leverantorsskulder: getVal('Leverantorsskulder'),
        summa_skulder: getVal('Skulder'),
      },
    };
  }

  /**
   * Hämta resultaträkning med utökad kontextdetektering.
   */
  getResultatrakning(period = 'period0'): Resultatrakning {
    const periodRefs = this.getContextRefs('period', period);

    // Funktion för att hitta värde med fallback
    const getVal = (pattern: string): number | undefined => {
      for (const ref of periodRefs) {
        const val = this.getValue(pattern, ref);
        if (val !== null) return val;
      }
      // Fallback: global sökning
      const anyResult = this.getValueAnyContext(pattern);
      return anyResult?.value ?? undefined;
    };

    return {
      nettoomsattning: getVal('Nettoomsattning'),
      ovriga_rorelseinktakter: getVal('OvrigaRorelseintakter'),
      summa_intakter: getVal('RorelseintakterLagerforandringarMm'),
      varor_handelsvaror: getVal('HandelsvarorKostnader'),
      ovriga_externa_kostnader: getVal('OvrigaExternaKostnader'),
      personalkostnader: getVal('Personalkostnader'),
      avskrivningar: getVal('AvskrivningarNedskrivningarMateriellaImmateriellaAnlaggningstillgangar'),
      rorelseresultat: getVal('Rorelseresultat'),
      finansiella_intakter: getVal('FinansiellaIntakter'),
      finansiella_kostnader: getVal('FinansiellaKostnader'),
      resultat_efter_finansiella: getVal('ResultatEfterFinansiellaPoster'),
      skatt: getVal('SkattAretsResultat'),
      arets_resultat: getVal('AretsResultat'),
    };
  }

  /**
   * Extrahera personer (styrelse, revisorer etc).
   * Utökad för att hantera fler namnmönster och fallbacks.
   */
  getPersoner(): Person[] {
    const $ = this.$;
    const personer: Person[] = [];
    const seen = new Set<string>();

    // Utökade mönster för att hitta personer i olika dokumentformat
    const patterns = [
      // Fastställelseintyg-signaturer
      { fornamn: 'UnderskriftFaststallelseintygForetradareTilltalsnamn', efternamn: 'UnderskriftFaststallelseintygForetradareEfternamn', roll: 'UnderskriftFaststallelseintygForetradareForetradarroll', defaultRoll: 'Företrädare' },
      // Handling-signaturer (styrelse)
      { fornamn: 'UnderskriftHandlingTilltalsnamn', efternamn: 'UnderskriftHandlingEfternamn', roll: 'UnderskriftHandlingForetradareroll', defaultRoll: 'Styrelseledamot' },
      // Revisionsberättelse
      { fornamn: 'UnderskriftRevisionsberattelseRevisorTilltalsnamn', efternamn: 'UnderskriftRevisionsberattelseRevisorEfternamn', roll: 'UnderskriftRevisionsberattelseRevisorTitel', defaultRoll: 'Revisor' },
      // Generiska underskrifter
      { fornamn: 'UnderskriftFornamn', efternamn: 'UnderskriftEfternamn', roll: 'UnderskriftRoll', defaultRoll: 'Företrädare' },
      // Styrelse-specifika
      { fornamn: 'StyrelseTilltalsnamn', efternamn: 'StyrelseEfternamn', roll: 'StyrelseRoll', defaultRoll: 'Styrelseledamot' },
      { fornamn: 'LedamotTilltalsnamn', efternamn: 'LedamotEfternamn', defaultRoll: 'Styrelseledamot' },
      // VD
      { fornamn: 'VDTilltalsnamn', efternamn: 'VDEfternamn', defaultRoll: 'Verkställande direktör' },
      { fornamn: 'VerkstallendeDirektorTilltalsnamn', efternamn: 'VerkstallendeDirektorEfternamn', defaultRoll: 'Verkställande direktör' },
    ];

    // Bygg selektorer för alla namespace-varianter
    const buildNameSelector = (pattern: string): string => {
      const selectors = [];
      for (const ns of ['ix', 'ix2', 'ix3', 'xbrli']) {
        selectors.push(`${ns}\\:nonNumeric[name*="${pattern}"]`);
        selectors.push(`${ns}\\:nonnumeric[name*="${pattern}"]`);
        selectors.push(`${ns}\\:NonNumeric[name*="${pattern}"]`);
      }
      selectors.push(`[name*="${pattern}"]`);
      return selectors.join(', ');
    };

    for (const patternDef of patterns) {
      const selector = buildNameSelector(patternDef.fornamn);
      $(selector).each((_, el) => {
        const $el = $(el);
        const fornamn = $el.text().trim();
        const tupleRef = $el.attr('tupleref') || $el.attr('tupleRef');
        const contextRef = $el.attr('contextRef') || $el.attr('contextref');
        let efternamn = '';
        let roll = patternDef.defaultRoll;

        // Försök hitta efternamn via tupleRef
        if (tupleRef) {
          const efternamnSelector = buildNameSelector(patternDef.efternamn);
          const $efternamn = $(`${efternamnSelector}[tupleref="${tupleRef}"], ${efternamnSelector}[tupleRef="${tupleRef}"]`).first();
          if ($efternamn.length) {
            efternamn = $efternamn.text().trim();
          }
          if (patternDef.roll) {
            const rollSelector = buildNameSelector(patternDef.roll);
            const $roll = $(`${rollSelector}[tupleref="${tupleRef}"], ${rollSelector}[tupleRef="${tupleRef}"]`).first();
            if ($roll.length) {
              roll = $roll.text().trim() || patternDef.defaultRoll;
            }
          }
        }

        // Fallback: försök hitta efternamn via contextRef om tupleRef inte finns
        if (!efternamn && contextRef) {
          const efternamnSelector = buildNameSelector(patternDef.efternamn);
          const $efternamn = $(`${efternamnSelector}[contextRef="${contextRef}"], ${efternamnSelector}[contextref="${contextRef}"]`).first();
          if ($efternamn.length) {
            efternamn = $efternamn.text().trim();
          }
        }

        // Fallback: sök efter närliggande efternamn-element
        if (!efternamn) {
          // Sök i samma container-element
          const $parent = $el.parent();
          const efternamnSelector = buildNameSelector(patternDef.efternamn);
          const $siblingEfternamn = $parent.find(efternamnSelector).first();
          if ($siblingEfternamn.length) {
            efternamn = $siblingEfternamn.text().trim();
          }
        }

        // Kontrollera att vi har ett meningsfullt namn
        if (fornamn && fornamn.length > 1) {
          // Undvik dubbletter
          const key = `${fornamn}|${efternamn}|${roll}`.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            personer.push({
              fornamn: fornamn,
              efternamn: efternamn,
              roll: roll,
            });
          }
        }
      });
    }

    // Fallback: om inga personer hittades, prova att söka efter generiska namnmönster
    if (personer.length === 0) {
      console.error('[IXBRLParser] Inga personer hittade med standardmönster, försöker fallback-sökning...');

      // Sök efter element som innehåller "Tilltalsnamn" eller "Fornamn"
      $('[name*="Tilltalsnamn"], [name*="tilltalsnamn"], [name*="Fornamn"], [name*="fornamn"]').each((_, el) => {
        const $el = $(el);
        const fornamn = $el.text().trim();
        if (!fornamn || fornamn.length < 2) return;

        // Sök efter efternamn-element i närheten
        const $parent = $el.parent();
        const $efternamn = $parent.find('[name*="Efternamn"], [name*="efternamn"]').first();
        const efternamn = $efternamn.length ? $efternamn.text().trim() : '';

        // Sök efter roll
        const $roll = $parent.find('[name*="Roll"], [name*="roll"], [name*="Titel"], [name*="titel"]').first();
        const roll = $roll.length ? $roll.text().trim() : 'Okänd roll';

        const key = `${fornamn}|${efternamn}|${roll}`.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          personer.push({ fornamn, efternamn, roll });
        }
      });
    }

    return personer;
  }

  /**
   * Extrahera styrelse, revisorer och VD separat.
   */
  getPersonerDetaljerad(): { styrelse: Person[]; revisorer: Person[]; vd: Person | null } {
    const personer = this.getPersoner();
    const styrelse: Person[] = [];
    const revisorer: Person[] = [];
    let vd: Person | null = null;

    for (const person of personer) {
      const rollLower = person.roll.toLowerCase();
      if (rollLower.includes('revisor')) revisorer.push(person);
      else if (rollLower.includes('vd') || rollLower.includes('verkställande')) vd = person;
      else if (rollLower.includes('ordförande')) styrelse.unshift(person);
      else styrelse.push(person);
    }
    return { styrelse, revisorer, vd };
  }

  /**
   * Hämta taxonomi-information.
   */
  getTaxonomiInfo(): TaxonomiInfo | null {
    const $ = this.$;
    const schemaRef = $('link\\:schemaRef, schemaRef').attr('xlink:href') || '';
    
    let typ: TaxonomiInfo['typ'] = 'K2';
    if (schemaRef.includes('k3k') || schemaRef.includes('koncern')) typ = 'K3K';
    else if (schemaRef.includes('k3')) typ = 'K3';
    else if (schemaRef.includes('revision')) typ = 'REVISION';
    else if (schemaRef.includes('faststallelse')) typ = 'FASTSTALLELSE';

    const versionMatch = schemaRef.match(/(\d{4}-\d{2}-\d{2})/);
    const version = versionMatch ? versionMatch[1] : 'unknown';
    const arArkiverad = version < '2020-01-01';

    return {
      version, typ, entry_point: schemaRef, ar_arkiverad: arArkiverad,
      varning: arArkiverad ? 'Denna taxonomi är arkiverad och stöds ej längre av Bolagsverket' : undefined,
    };
  }

  /**
   * Hämta revisionsberättelse.
   */
  getRevisionsberattelse(): Revisionsberattelse | null {
    const revisorNamn = this.getTextValue('UnderskriftRevisionsberattelseRevisorTilltalsnamn');
    if (!revisorNamn) return null;

    const efternamn = this.getTextValue('UnderskriftRevisionsberattelseRevisorEfternamn') || '';
    const anmarkningar: string[] = [];
    const $ = this.$;

    $('ix\\:nonNumeric[name*="Anmarkning"], ix\\:nonnumeric[name*="Anmarkning"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 10) anmarkningar.push(text);
    });

    return {
      revisor_namn: `${revisorNamn} ${efternamn}`.trim(),
      revisor_titel: this.getTextValue('UnderskriftRevisionsberattelseRevisorTitel') ?? undefined,
      revisionsbolag: this.getTextValue('Revisionsbolag') ?? undefined,
      anmarkningar, ar_ren: anmarkningar.length === 0, typ: 'standard',
    };
  }

  /**
   * Hämta fastställelseintyg.
   */
  getFaststallelseintyg(): Faststallelseintyg | null {
    const arsstammaDatum = this.getTextValue('ArsstammaDatum');
    const undertecknare: string[] = [];
    const $ = this.$;
    
    $('[name*="UnderskriftFaststallelseintyg"]').each((_, el) => {
      const namn = $(el).text().trim();
      if (namn && !undertecknare.includes(namn)) undertecknare.push(namn);
    });

    if (!arsstammaDatum && undertecknare.length === 0) return null;

    return {
      arsstamma_datum: arsstammaDatum ?? undefined,
      intygsdatum: this.getTextValue('FaststallelseDatum') ?? undefined,
      utdelning_totalt: this.getValue('Utdelning', 'period0') ?? undefined,
      utdelning_per_aktie: this.getValue('UtdelningPerAktie', 'period0') ?? undefined,
      balanseras_i_ny_rakning: this.getValue('BalanserasINyRakning', 'period0') ?? undefined,
      undertecknare,
    };
  }

  /**
   * Hämta utökad information (extension taxonomy).
   */
  getUtokadInformation(): UtokadInformation {
    const $ = this.$;
    const odefinierade: OdefiniertBegrepp[] = [];
    const notkopplingar: Notkoppling[] = [];

    $('[name*="extension"], [name*="Extension"]').each((_, el) => {
      const namn = $(el).attr('name') || '';
      const text = $(el).text().trim();
      if (namn.includes('nonFraction') || namn.includes('nonfraction')) {
        const value = parseFloat(text.replace(/\s/g, '').replace(',', '.'));
        odefinierade.push({ namn: namn.split(':').pop() || namn, varde: isNaN(value) ? undefined : value });
      }
    });

    $('[name*="Not"], [name*="not"]').each((_, el) => {
      const ref = $(el).attr('name');
      const match = ref?.match(/Not(\d+)/i);
      if (match) notkopplingar.push({ not_nummer: match[1] });
    });

    return { ar_fullstandigt_taggad: odefinierade.length === 0, odefinierade_begrepp: odefinierade, andrade_rubriker: [], notkopplingar };
  }

  getForetanamn(): string | null {
    // Prova flera olika mönster för företagsnamn
    const patterns = [
      'Foretagsnamn',
      'Företagsnamn',
      'ForetagsNamn',
      'NamnPaHandelsbolagKommanditbolag',
      'NamnPaForetagetEllerForeningen',
      'OrganisationensNamn',
      'Organisationsnamn',
      'Foretag',
      'Bolagsnamn',
      'CompanyName',
    ];

    for (const pattern of patterns) {
      const namn = this.getTextValue(pattern);
      if (namn && namn.length > 1) {
        return namn.trim();
      }
    }

    // Försök hitta i title-element
    const $ = this.$;
    const titleNamn = $('title').first().text().trim();
    if (titleNamn && titleNamn.length > 1 && !titleNamn.toLowerCase().includes('årsredovisning')) {
      // Rensa bort vanliga suffix
      const cleaned = titleNamn
        .replace(/\s*[-–]\s*årsredovisning.*/i, '')
        .replace(/\s*årsredovisning.*/i, '')
        .trim();
      if (cleaned.length > 1) {
        return cleaned;
      }
    }

    // Fallback: leta efter ix:nonNumeric med name som innehåller "namn" eller "name"
    const namnElement = $('[name*="namn"], [name*="Namn"], [name*="name"], [name*="Name"]')
      .filter((_, el) => {
        const text = $(el).text().trim();
        // Filtrera bort för korta eller för långa värden
        return text.length > 2 && text.length < 100 && !text.match(/^\d+$/);
      })
      .first();

    if (namnElement.length > 0) {
      return namnElement.text().trim();
    }

    return null;
  }

  getFlerarsOversikt(): Record<string, Nyckeltal> {
    const oversikt: Record<string, Nyckeltal> = {};
    for (let i = 0; i < 4; i++) {
      const period = `period${i}`;
      const nyckeltal = this.getNyckeltal(period);
      if (nyckeltal.nettoomsattning !== null || nyckeltal.arets_resultat !== null) oversikt[period] = nyckeltal;
    }
    return oversikt;
  }

  getForvaltningsberattelse(): Record<string, string> {
    const getText = (pattern: string) => {
      const $ = this.$;
      let longest = '';
      $(`[name*="${pattern}"]`).each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > longest.length) longest = text;
      });
      return longest.length > 50 ? longest : '';
    };

    return {
      verksamheten: getText('Verksamheten'),
      vasentliga_handelser: getText('VasentligaHandelser'),
      framtida_utveckling: getText('ForvantadFramtidaUtveckling'),
      resultatdisposition: getText('Resultatdisposition'),
    };
  }
}
