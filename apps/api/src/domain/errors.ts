export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, reference: string) {
    super('NOT_FOUND', `${entity} ${reference} was not found`, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 409, details);
  }
}

export class InvalidRequestError extends DomainError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 400, details);
  }
}

export class ForbiddenError extends DomainError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 403, details);
  }
}
