/**
 * Bolagsverket MCP Server - Formatting Utilities
 * Formattering av output för MCP-svar.
 */

import type { Nyckeltal, RodFlagga, Person, CompanyInfo, Arsredovisning } from '../types/index.js';

/**
 * Formatera belopp med tusentalsavgränsare.
 */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('sv-SE').format(value);
}

/**
 * Formatera belopp i SEK.
 */
export function formatSEK(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${formatAmount(value)} kr`;
}

/**
 * Formatera procent.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(1)} %`;
}

/**
 * Formatera nyckeltal som markdown-tabell.
 */
export function formatNyckeltalTable(nyckeltal: Nyckeltal, titel?: string): string {
  const lines: string[] = [];
  
  if (titel) lines.push(`## ${titel}`, '');
  
  lines.push('| Nyckeltal | Värde |');
  lines.push('|-----------|------:|');
  
  const data: Array<[string, number | null | undefined, string]> = [
    ['Nettoomsättning', nyckeltal.nettoomsattning, 'kr'],
    ['Resultat efter fin. poster', nyckeltal.resultat_efter_finansiella, 'kr'],
    ['Årets resultat', nyckeltal.arets_resultat, 'kr'],
    ['Eget kapital', nyckeltal.eget_kapital, 'kr'],
    ['Balansomslutning', nyckeltal.balansomslutning, 'kr'],
    ['Soliditet', nyckeltal.soliditet, '%'],
    ['Vinstmarginal', nyckeltal.vinstmarginal, '%'],
    ['ROE', nyckeltal.roe, '%'],
    ['Antal anställda', nyckeltal.antal_anstallda, 'st'],
  ];

  for (const [label, value, unit] of data) {
    if (value != null) {
      const formatted = unit === '%' ? `${value.toFixed(1)} %` :
                       unit === 'st' ? `${value} st` :
                       formatSEK(value);
      lines.push(`| ${label} | ${formatted} |`);
    }
  }

  return lines.join('\n');
}

/**
 * Formatera röda flaggor.
 */
export function formatRodaFlaggor(flaggor: RodFlagga[]): string {
  if (flaggor.length === 0) {
    return '✅ Inga röda flaggor identifierade.';
  }

  const lines: string[] = ['## ⚠️ Röda flaggor', ''];

  for (const flagga of flaggor) {
    const icon = flagga.allvarlighet === 'kritisk' ? '🔴' :
                 flagga.allvarlighet === 'varning' ? '🟡' : 'ℹ️';
    
    lines.push(`${icon} **${flagga.typ}**: ${flagga.beskrivning}`);
    
    if (flagga.rekommendation) {
      lines.push(`   _${flagga.rekommendation}_`);
    }
  }

  return lines.join('\n');
}

/**
 * Formatera personlista.
 */
export function formatPersoner(personer: Person[], titel?: string): string {
  if (personer.length === 0) return '';

  const lines: string[] = [];
  if (titel) lines.push(`## ${titel}`, '');

  for (const person of personer) {
    const namn = `${person.fornamn} ${person.efternamn}`.trim();
    lines.push(`- **${namn}** (${person.roll})`);
  }

  return lines.join('\n');
}

/**
 * Formatera komplett årsredovisning.
 */
export function formatArsredovisning(arsredovisning: Arsredovisning): string {
  const lines: string[] = [
    `# ${arsredovisning.foretag_namn}`,
    '',
    `**Organisationsnummer:** ${arsredovisning.org_nummer}`,
    `**Räkenskapsår:** ${arsredovisning.rakenskapsar_start} – ${arsredovisning.rakenskapsar_slut}`,
    '',
  ];

  lines.push(formatNyckeltalTable(arsredovisning.nyckeltal, 'Nyckeltal'));
  
  if (arsredovisning.personer.length > 0) {
    lines.push('', formatPersoner(arsredovisning.personer, 'Styrelse och ledning'));
  }

  return lines.join('\n');
}

/**
 * Exportera till JSON med formatering.
 */
export function exportToJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Exportera till CSV.
 */
export function exportToCsv(data: Record<string, unknown>[], headers?: string[]): string {
  if (data.length === 0) return '';

  const keys = headers || Object.keys(data[0]);
  const lines: string[] = [keys.join(';')];

  for (const row of data) {
    const values = keys.map(key => {
      const val = row[key];
      if (val === null || val === undefined) return '';
      if (typeof val === 'string' && val.includes(';')) return `"${val}"`;
      return String(val);
    });
    lines.push(values.join(';'));
  }

  return lines.join('\n');
}

/**
 * Formatera jämförelsetabell för flera företag.
 */
export function formatComparisonTable(companies: Array<{ info: CompanyInfo; nyckeltal: Nyckeltal }>): string {
  const lines: string[] = [
    '| Företag | Omsättning | Resultat | Soliditet | Anställda |',
    '|---------|------------|----------|-----------|-----------|',
  ];

  for (const { info, nyckeltal } of companies) {
    lines.push([
      '',
      info.namn,
      formatSEK(nyckeltal.nettoomsattning),
      formatSEK(nyckeltal.arets_resultat),
      formatPercent(nyckeltal.soliditet),
      nyckeltal.antal_anstallda?.toString() || '-',
      '',
    ].join(' | '));
  }

  return lines.join('\n');
}

/**
 * Formatera trenddata som tabell.
 */
export function formatTrendTable(
  perioder: string[],
  serier: Record<string, (number | null)[]>
): string {
  const lines: string[] = [
    `| Nyckeltal | ${perioder.join(' | ')} |`,
    `|-----------|${perioder.map(() => '------:').join('|')}|`,
  ];

  const labels: Record<string, string> = {
    nettoomsattning: 'Omsättning',
    arets_resultat: 'Resultat',
    eget_kapital: 'Eget kapital',
    soliditet: 'Soliditet',
  };

  for (const [key, values] of Object.entries(serier)) {
    const label = labels[key] || key;
    const formatted = values.map(v => v !== null ? formatAmount(v) : '-');
    lines.push(`| ${label} | ${formatted.join(' | ')} |`);
  }

  return lines.join('\n');
}

/**
 * Beräkna tillväxt mellan två värden.
 */
export function calculateGrowth(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * Formatera tillväxt med pil.
 */
export function formatGrowth(growth: number | null): string {
  if (growth === null) return '-';
  const arrow = growth > 0 ? '📈' : growth < 0 ? '📉' : '➡️';
  return `${arrow} ${growth > 0 ? '+' : ''}${growth.toFixed(1)}%`;
}
