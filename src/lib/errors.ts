/**
 * Bolagsverket MCP Server - Felhantering
 */

import { ErrorCode, MCPErrorResponse } from '../types/index.js';

/**
 * Skapa strukturerat MCP-felmeddelande
 */
export function createMCPError(
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {}
): MCPErrorResponse {
  return {
    isError: true,
    errorCode: code,
    message,
    details,
  };
}

/**
 * Formatera fel som JSON-sträng för MCP-svar
 */
export function handleError(
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {}
): string {
  const error = createMCPError(code, message, details);
  console.error(`[ERROR] ${code}: ${message}`, details);
  return JSON.stringify(error, null, 2);
}

/**
 * Hantera HTTP-fel från API
 */
export function handleHttpError(status: number, detail: string): string {
  let code = ErrorCode.API_ERROR;
  let message = `HTTP ${status}: ${detail}`;

  switch (status) {
    case 400:
      code = ErrorCode.INVALID_INPUT;
      message = `Ogiltig begäran: ${detail}`;
      break;
    case 401:
      code = ErrorCode.AUTH_ERROR;
      message = `Ej autentiserad: ${detail}`;
      break;
    case 403:
      code = ErrorCode.AUTH_ERROR;
      message = `Åtkomst nekad: ${detail}`;
      break;
    case 404:
      code = ErrorCode.COMPANY_NOT_FOUND;
      message = `Ej funnen: ${detail}`;
      break;
    case 500:
      code = ErrorCode.API_ERROR;
      message = `Serverfel hos Bolagsverket: ${detail}`;
      break;
  }

  return handleError(code, message, { status });
}

/**
 * Konvertera okänt fel till strukturerat fel
 */
export function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return { message: 'Okänt fel' };
}

/**
 * Wrapper för att fånga och formatera fel i verktyg
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  errorCode: ErrorCode = ErrorCode.UNKNOWN_ERROR,
  context: Record<string, unknown> = {}
): Promise<T | string> {
  try {
    return await fn();
  } catch (error) {
    const { message } = normalizeError(error);
    return handleError(errorCode, message, context);
  }
}

/**
 * Typeguard för MCPErrorResponse
 */
export function isMCPError(value: unknown): value is MCPErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isError' in value &&
    (value as MCPErrorResponse).isError === true
  );
}
