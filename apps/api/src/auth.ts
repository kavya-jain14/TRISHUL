export type ApiPermission =
  | "trace:read"
  | "ledger:read"
  | "ledger:write"
  | "case:read"
  | "case:write"
  | "alert:read"
  | "alert:write"
  | "operations:read"
  | "operations:write";

export type ApiPrincipal = {
  subject: string;
  roles: readonly string[];
};

export type AuthorizationRequest = {
  authorizationHeader: string | undefined;
  permission: ApiPermission;
  caseId?: string;
};

/** Vatsal's trust/access implementation plugs in behind this boundary. */
export interface ApiAuthorizer {
  authorize(request: AuthorizationRequest): Promise<ApiPrincipal>;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class DenyAllAuthorizer implements ApiAuthorizer {
  async authorize(): Promise<ApiPrincipal> {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "A valid authorization credential is required.");
  }
}
