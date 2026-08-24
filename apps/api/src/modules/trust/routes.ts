import { TrustChallengeRequestSchema, TrustVerificationRequestSchema } from '@trishul/contracts';
import type { TrustAccessService } from '@trishul/trust';
import type { FastifyInstance } from 'fastify';

export function registerTrustRoutes(app: FastifyInstance, service: TrustAccessService): void {
  app.post('/api/v1/trust/challenges', async (request, reply) => {
    const challenge = service.createChallenge(TrustChallengeRequestSchema.parse(request.body));
    return reply.status(201).send({ challenge });
  });

  app.post('/api/v1/trust/verify', async (request) =>
    service.verify(TrustVerificationRequestSchema.parse(request.body)),
  );
}
