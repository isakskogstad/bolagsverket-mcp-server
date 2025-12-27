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
 */
const ELEMENT_ALIASES: Record<string, string[]> = {
  // Resultat
  'Nettoomsattning': ['Nettoomsattning', 'NettoOmsattning', 'Nettoomsättning', 'RorelseintakterNetto'],
  'ResultatEfterFinansiellaPoster': ['ResultatEfterFinansiellaPoster', 'ResultatEfterFinansiellaIntakterKostnader', 'ResultatForeBokslutsdispositioner'],
  'AretsResultat': ['AretsResultat', 'ÅretsResultat', 'Arsresultat', 'NetResultat', 'ResultatAretsResultat'],
  'Rorelseresultat': ['Rorelseresultat', 'RörelseResultat', 'Rörelseresultat'],

  // Balans
  'EgetKapital': ['EgetKapital', 'SummaEgetKapital', 'EgetKapitalOchSkulder', 'TotalEgetKapital'],
  'Tillgangar': ['Tillgangar', 'SummaTillgangar', 'Balansomslutning', 'TotalTillgangar'],

  // Personal
  'MedelantaletAnstallda': ['MedelantaletAnstallda', 'AntalAnstallda', 'GenomsnittligtAntalAnstallda', 'Medelantal'],
};

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

  constructor(xhtmlContent: string) {
    this.$ = cheerio.load(xhtmlContent, { xmlMode: true });
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
   */
  private getValue(namePattern: string, contextRef: string): number | null {
    const $ = this.$;

    // Hämta alla alternativa namn för detta mönster
    const patterns = ELEMENT_ALIASES[namePattern] || [namePattern];

    for (const pattern of patterns) {
      // Bygg selector med både stor och liten bokstav för ix-namespace
      const selector = `ix\\:nonFraction[name*="${pattern}"][contextRef="${contextRef}"], ` +
                       `ix\\:nonfraction[name*="${pattern}"][contextRef="${contextRef}"], ` +
                       `[name*="${pattern}"][contextRef="${contextRef}"]`;

      const element = $(selector).first();
      if (element.length === 0) continue;

      let text = element.text().trim().replace(/\s/g, '');

      // Hantera europeiskt decimalformat (1.234,56 -> 1234.56)
      if (text.includes(',')) {
        // Kontrollera om det är 1.234,56 format (punkter som tusentalsavgränsare)
        if (text.match(/\d+\.\d+,\d+/)) {
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
      const value = parseFloat(text);

      if (!isNaN(value)) {
        return Math.round(value * Math.pow(10, scale));
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
   */
  getNyckeltal(period = 'period0'): Nyckeltal {
    const balans = period === 'period0' ? 'balans0' : 'balans1';

    // Försök också med alternativa period-/balansnamn
    const periodAlts = [period, `instant${period.slice(-1)}`, `duration${period.slice(-1)}`];
    const balansAlts = [balans, `instant${balans.slice(-1)}`, `balance${balans.slice(-1)}`];

    // Funktion för att hitta värde med fallback-perioder
    const getValueWithFallback = (pattern: string, refs: string[]): number | null => {
      for (const ref of refs) {
        const val = this.getValue(pattern, ref);
        if (val !== null) return val;
      }
      return null;
    };

    const nyckeltal: Nyckeltal = {
      nettoomsattning: getValueWithFallback('Nettoomsattning', periodAlts),
      resultat_efter_finansiella: getValueWithFallback('ResultatEfterFinansiellaPoster', periodAlts),
      arets_resultat: getValueWithFallback('AretsResultat', periodAlts),
      eget_kapital: getValueWithFallback('EgetKapital', balansAlts),
      balansomslutning: getValueWithFallback('Tillgangar', balansAlts),
      antal_anstallda: getValueWithFallback('MedelantaletAnstallda', periodAlts),
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
    const fieldsWithData = Object.values(nyckeltal).filter(v => v !== null && v !== undefined).length;
    if (fieldsWithData < 2) {
      this.addWarning('MISSING_DATA', 'nyckeltal',
        `Endast ${fieldsWithData} av 6 grundnyckeltal kunde extraheras. Dokumentet kan ha annorlunda struktur.`);
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
