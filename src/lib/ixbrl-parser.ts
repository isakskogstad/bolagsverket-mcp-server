/**
 * Bolagsverket MCP Server - iXBRL Parser
 * Parsar iXBRL-dokument (inline XBRL) med Cheerio.
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
 * Parser för iXBRL-dokument från Bolagsverket.
 */
export class IXBRLParser {
  private $: CheerioAPI;

  constructor(xhtmlContent: string) {
    this.$ = cheerio.load(xhtmlContent, { xmlMode: true });
  }

  /**
   * Hämta numeriskt värde från iXBRL-tagg.
   */
  private getValue(namePattern: string, contextRef: string): number | null {
    const $ = this.$;
    const selector = `ix\\:nonFraction[name*="${namePattern}"][contextRef="${contextRef}"], ` +
                     `ix\\:nonfraction[name*="${namePattern}"][contextRef="${contextRef}"]`;
    
    const element = $(selector).first();
    if (element.length === 0) return null;

    let text = element.text().trim().replace(/\s/g, '').replace(',', '.');
    
    // Hantera sign-attribut
    const sign = element.attr('sign');
    if (sign === '-') text = `-${text.replace('-', '')}`;

    // Hantera format-attribut
    const format = element.attr('format');
    if (format?.includes('numdotdecimal')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else if (format?.includes('numcommadecimal')) {
      text = text.replace(/,/g, '');
    }

    const scale = parseInt(element.attr('scale') || '0', 10);
    const value = parseFloat(text);
    
    return isNaN(value) ? null : Math.round(value * Math.pow(10, scale));
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
   * Hämta nyckeltal för angiven period.
   */
  getNyckeltal(period = 'period0'): Nyckeltal {
    const balans = period === 'period0' ? 'balans0' : 'balans1';
    
    const nyckeltal: Nyckeltal = {
      nettoomsattning: this.getValue('Nettoomsattning', period),
      resultat_efter_finansiella: this.getValue('ResultatEfterFinansiellaPoster', period),
      arets_resultat: this.getValue('AretsResultat', period),
      eget_kapital: this.getValue('EgetKapital', balans),
      balansomslutning: this.getValue('Tillgangar', balans),
      antal_anstallda: this.getValue('MedelantaletAnstallda', period),
    };

    if (nyckeltal.eget_kapital && nyckeltal.balansomslutning && nyckeltal.balansomslutning > 0) {
      nyckeltal.soliditet = Math.round((nyckeltal.eget_kapital / nyckeltal.balansomslutning) * 1000) / 10;
    }
    if (nyckeltal.nettoomsattning && nyckeltal.arets_resultat && nyckeltal.nettoomsattning > 0) {
      nyckeltal.vinstmarginal = Math.round((nyckeltal.arets_resultat / nyckeltal.nettoomsattning) * 1000) / 10;
    }
    if (nyckeltal.eget_kapital && nyckeltal.arets_resultat && nyckeltal.eget_kapital > 0) {
      nyckeltal.roe = Math.round((nyckeltal.arets_resultat / nyckeltal.eget_kapital) * 1000) / 10;
    }

    return nyckeltal;
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
   * Hämta balansräkning.
   */
  getBalansrakning(period = 'balans0'): Balansrakning {
    return {
      tillgangar: {
        immateriella: this.getValue('ImmateriellAnlaggningstillgangar', period) ?? undefined,
        materiella: this.getValue('MateriellaAnlaggningstillgangar', period) ?? undefined,
        finansiella: this.getValue('FinansiellaAnlaggningstillgangar', period) ?? undefined,
        varulager: this.getValue('VarulagerMm', period) ?? undefined,
        kundfordringar: this.getValue('Kundfordringar', period) ?? undefined,
        kassa_bank: this.getValue('KassaBank', period) ?? undefined,
        summa_omsattning: this.getValue('Omsattningstillgangar', period) ?? undefined,
        summa_tillgangar: this.getValue('Tillgangar', period) ?? undefined,
      },
      eget_kapital_skulder: {
        aktiekapital: this.getValue('Aktiekapital', period) ?? undefined,
        balanserat_resultat: this.getValue('BalanseratResultat', period) ?? undefined,
        arets_resultat: this.getValue('AretsResultatEgetKapital', period) ?? undefined,
        summa_eget_kapital: this.getValue('EgetKapital', period) ?? undefined,
        langfristiga_skulder: this.getValue('LangfristigaSkulder', period) ?? undefined,
        kortfristiga_skulder: this.getValue('KortfristigaSkulder', period) ?? undefined,
        leverantorsskulder: this.getValue('Leverantorsskulder', period) ?? undefined,
        summa_skulder: this.getValue('Skulder', period) ?? undefined,
      },
    };
  }

  /**
   * Hämta resultaträkning.
   */
  getResultatrakning(period = 'period0'): Resultatrakning {
    return {
      nettoomsattning: this.getValue('Nettoomsattning', period) ?? undefined,
      ovriga_rorelseinktakter: this.getValue('OvrigaRorelseintakter', period) ?? undefined,
      summa_intakter: this.getValue('RorelseintakterLagerforandringarMm', period) ?? undefined,
      varor_handelsvaror: this.getValue('HandelsvarorKostnader', period) ?? undefined,
      ovriga_externa_kostnader: this.getValue('OvrigaExternaKostnader', period) ?? undefined,
      personalkostnader: this.getValue('Personalkostnader', period) ?? undefined,
      avskrivningar: this.getValue('AvskrivningarNedskrivningarMateriellaImmateriellaAnlaggningstillgangar', period) ?? undefined,
      rorelseresultat: this.getValue('Rorelseresultat', period) ?? undefined,
      finansiella_intakter: this.getValue('FinansiellaIntakter', period) ?? undefined,
      finansiella_kostnader: this.getValue('FinansiellaKostnader', period) ?? undefined,
      resultat_efter_finansiella: this.getValue('ResultatEfterFinansiellaPoster', period) ?? undefined,
      skatt: this.getValue('SkattAretsResultat', period) ?? undefined,
      arets_resultat: this.getValue('AretsResultat', period) ?? undefined,
    };
  }

  /**
   * Extrahera personer (styrelse, revisorer etc).
   */
  getPersoner(): Person[] {
    const $ = this.$;
    const personer: Person[] = [];
    const seen = new Set<string>();

    const patterns = [
      { fornamn: 'UnderskriftFaststallelseintygForetradareTilltalsnamn', efternamn: 'UnderskriftFaststallelseintygForetradareEfternamn', roll: 'UnderskriftFaststallelseintygForetradareForetradarroll', defaultRoll: 'Företrädare' },
      { fornamn: 'UnderskriftHandlingTilltalsnamn', efternamn: 'UnderskriftHandlingEfternamn', defaultRoll: 'Styrelseledamot' },
      { fornamn: 'UnderskriftRevisionsberattelseRevisorTilltalsnamn', efternamn: 'UnderskriftRevisionsberattelseRevisorEfternamn', roll: 'UnderskriftRevisionsberattelseRevisorTitel', defaultRoll: 'Revisor' },
    ];

    for (const pattern of patterns) {
      $(`ix\\:nonNumeric[name*="${pattern.fornamn}"], ix\\:nonnumeric[name*="${pattern.fornamn}"]`).each((_, el) => {
        const $el = $(el);
        const fornamn = $el.text().trim();
        const tupleRef = $el.attr('tupleref');
        let efternamn = '';
        let roll = pattern.defaultRoll;

        if (tupleRef) {
          const $efternamn = $(`[name*="${pattern.efternamn}"][tupleref="${tupleRef}"]`).first();
          if ($efternamn.length) efternamn = $efternamn.text().trim();
          if (pattern.roll) {
            const $roll = $(`[name*="${pattern.roll}"][tupleref="${tupleRef}"]`).first();
            if ($roll.length) roll = $roll.text().trim();
          }
        }

        const key = `${fornamn}|${efternamn}|${roll}`;
        if (fornamn && !seen.has(key)) {
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
    return this.getTextValue('Foretagsnamn') || this.getTextValue('NamnPaHandelsbolagKommanditbolag') || this.getTextValue('NamnPaForetagetEllerForeningen');
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
