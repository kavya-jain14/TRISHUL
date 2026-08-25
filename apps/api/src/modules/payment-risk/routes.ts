import { timingSafeEqual } from 'node:crypto';
import { IdentifierSchema } from '@trishul/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { InvalidRequestError, UnauthorizedError } from '../../domain/errors.js';
import type { PaymentRiskService } from './service.js';

export interface PaymentRiskRouteOptions {
  enforceServiceToken?: boolean;
  serviceToken?: string;
}

export function registerPaymentRiskRoutes(
  app: FastifyInstance,
  service: PaymentRiskService,
  options: PaymentRiskRouteOptions = {},
): void {
  if (options.enforceServiceToken && !options.serviceToken) {
    throw new Error(
      'A payment-risk service token is required when service authentication is enforced.',
    );
  }

  app.post('/api/v1/risk/evaluate', async (request, reply) => {
    authorizeProvider(request, options);
    const result = await service.evaluate(request.body, idempotencyKey(request));
    return reply.status(result.replayed ? 200 : 201).send(result);
  });

  app.get<{ Params: { paymentReference: string } }>(
    '/api/v1/risk/evaluations/:paymentReference/latest',
    async (request) => {
      authorizeProvider(request, options);
      const paymentReference = IdentifierSchema.parse(request.params.paymentReference);
      return { assessment: await service.latest(paymentReference) };
    },
  );
}

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidRequestError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'The Idempotency-Key header is required for this write.',
    );
  }
  return value;
}

function authorizeProvider(request: FastifyRequest, options: PaymentRiskRouteOptions): void {
  if (!options.enforceServiceToken) return;
  const supplied = request.headers['x-trishul-service-token'];
  const expected = options.serviceToken ?? '';
  if (
    typeof supplied !== 'string' ||
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied, 'utf8'), Buffer.from(expected, 'utf8'))
  ) {
    throw new UnauthorizedError(
      'PAYMENT_RISK_SERVICE_AUTH_REQUIRED',
      'A valid internal provider service token is required.',
    );
  }
}
