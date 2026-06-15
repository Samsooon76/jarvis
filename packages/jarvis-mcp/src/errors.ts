export class JarvisApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "JarvisApiError";
    this.statusCode = statusCode;
  }
}

export const toToolErrorText = (error: unknown): string => {
  if (error instanceof JarvisApiError) {
    return `Jarvis API (${error.statusCode}): ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Erreur inconnue pendant l'appel Jarvis.";
};