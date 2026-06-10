export class AppError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentification requise.") {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Acces refuse.") {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Ressource introuvable.") {
    super(message, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Requete invalide.") {
    super(message, 400);
  }
}

export const getErrorStatusCode = (error: unknown, fallback = 500): number =>
  error instanceof AppError ? error.statusCode : fallback;

export const getErrorMessage = (error: unknown, fallback = "Erreur inconnue."): string =>
  error instanceof Error ? error.message : fallback;
