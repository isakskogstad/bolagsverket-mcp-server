/**
 * Bolagsverket MCP Server - Validators
 * Validering av organisationsnummer med Luhn-algoritm.
 */

/**
 * Rensa organisationsnummer från bindestreck och mellanslag.
 */
export function cleanOrgNummer(orgNummer: string): string {
  return orgNummer.replace(/[-\s]/g, '');
}

/**
 * Formatera organisationsnummer med bindestreck (NNNNNN-NNNN).
 */
export function formatOrgNummer(orgNummer: string): string {
  const clean = cleanOrgNummer(orgNummer);
  if (clean.length === 10) {
    return `${clean.slice(0, 6)}-${clean.slice(6)}`;
  }
  return clean;
}

/**
 * Luhn-algoritmen för validering av kontrollsiffra.
 * 
 * Bolagsverkets API kräver giltig kontrollsiffra och returnerar
 * 'Identitetsbeteckning har ogiltig kontrollsiffra.' vid fel.
 * 
 * Algoritmen:
 * 1. Dubblera varannan siffra från höger (börja med näst sista)
 * 2. Om resultatet > 9, subtrahera 9
 * 3. Summera alla siffror
 * 4. Om summan är delbar med 10 är numret giltigt
 */
export function luhnChecksum(number: string): boolean {
  const digits = number.split('').map(d => parseInt(d, 10));
  
  // Dubblera varannan siffra från höger (index -2, -4, -6, ...)
  for (let i = digits.length - 2; i >= 0; i -= 2) {
    digits[i] *= 2;
    if (digits[i] > 9) {
      digits[i] -= 9;
    }
  }
  
  const sum = digits.reduce((acc, val) => acc + val, 0);
  return sum % 10 === 0;
}

/**
 * Validering av organisationsnummer.
 */
export interface ValidationResult {
  valid: boolean;
  cleanNumber: string;
  error?: string;
}

/**
 * Validera organisationsnummer inklusive Luhn-kontroll.
 * 
 * Organisationsnummer i Sverige:
 * - 10 siffror för företag (NNNNNN-NNNN)
 * - 12 siffror för personnummer (ÅÅÅÅMMDD-NNNN)
 * 
 * Tredje siffran måste vara >= 2 för organisationsnummer
 * (skiljer från personnummer där månad är 01-12).
 */
export function validateOrgNummer(orgNummer: string): ValidationResult {
  let clean = cleanOrgNummer(orgNummer);
  
  // Kontrollera att det bara är siffror
  if (!/^\d+$/.test(clean)) {
    return {
      valid: false,
      cleanNumber: clean,
      error: 'Organisationsnummer får endast innehålla siffror',
    };
  }
  
  // Hantera personnummer (12 siffror) - ta bort sekelsiffror
  if (clean.length === 12) {
    // ÅÅÅÅMMDDNNNN -> ÅÅMMDDNNNN
    clean = clean.slice(2);
  }
  
  // Kontrollera längd
  if (clean.length !== 10) {
    return {
      valid: false,
      cleanNumber: clean,
      error: 'Organisationsnummer måste vara 10 eller 12 siffror',
    };
  }
  
  // Luhn-validering
  if (!luhnChecksum(clean)) {
    return {
      valid: false,
      cleanNumber: clean,
      error: 'Organisationsnummer har ogiltig kontrollsiffra',
    };
  }
  
  return {
    valid: true,
    cleanNumber: clean,
  };
}

/**
 * Snabb validering utan Luhn (för sökningar etc).
 */
export function isValidOrgNummerFormat(orgNummer: string): boolean {
  const clean = cleanOrgNummer(orgNummer);
  return /^\d{10}$/.test(clean) || /^\d{12}$/.test(clean);
}

/**
 * Extrahera år från räkenskapsperiod (YYYY-MM-DD).
 */
export function extractYear(dateString: string): number | null {
  const match = dateString.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Formatera belopp i SEK med tusentalsavgränsare.
 */
export function formatSEK(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) {
    return '-';
  }
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Formatera procent.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '-';
  }
  return `${value.toFixed(1)} %`;
}
