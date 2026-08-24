import { IdentifierSchema, type TrustCapability, type TrustSession } from '@trishul/contracts';
import { TrustAccessError, type TrustAccessService } from '@trishul/trust';
import type { FastifyInstance, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    trustSession?: TrustSession;
  }
}

export function registerTrustAccessGuard(app: FastifyInstance, service: TrustAccessService): void {
  app.addHook('preHandler', async (request) => {
    if (request.method === 'OPTIONS') return;
    const path = request.url.split('?', 1)[0] ?? request.url;
    if (path.includes('/identity-resolution')) return;
    const caseMatch = /^\/api\/v1\/cases\/([^/]+)/.exec(path);
    if (caseMatch?.[1]) {
      const id = IdentifierSchema.parse(decodeURIComponent(caseMatch[1]));
      const capability: TrustCapability =
        request.method === 'GET'
          ? 'CASE_READ'
          : path.includes('/evidence-anchors')
            ? 'EVIDENCE_ANCHOR'
            : 'CASE_WRITE';
      const session = await service.authorize(bearerToken(request), capability, id);
      request.trustSession = session;
      return;
    }

    if (request.method === 'POST' && path.startsWith('/api/v1/accounts/')) {
      const body = request.body as { caseId?: unknown } | null;
      const id = IdentifierSchema.parse(body?.caseId);
      const session = await service.authorize(bearerToken(request), 'CASE_WRITE', id);
      request.trustSession = session;
    }
  });
}

export async function authorizeBearerRequest(
  request: FastifyRequest,
  service: TrustAccessService,
  capability: TrustCapability,
  caseId: string,
) {
  return service.authorize(bearerToken(request), capability, caseId);
}

function bearerToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  const match =
    typeof authorization === 'string'
      ? /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(authorization)
      : null;
  if (!match?.[1]) {
    throw new TrustAccessError(
      'TRUST_SESSION_REQUIRED',
      'A verified Bearer trust session is required.',
      401,
      ['BEARER_TOKEN_REQUIRED'],
    );
  }
  return match[1];
}
