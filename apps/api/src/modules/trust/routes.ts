import {
  TrustChallengeRequestSchema,
  TrustIssuerRegistrationRequestSchema,
  TrustRevocationRequestSchema,
  TrustVerificationRequestSchema,
} from '@trishul/contracts';
import type { TrustAccessService } from '@trishul/trust';
import type { FastifyInstance } from 'fastify';

export function registerTrustRoutes(app: FastifyInstance, service: TrustAccessService): void {
  app.post('/api/v1/trust/challenges', async (request, reply) => {
    const challenge = await service.createChallenge(TrustChallengeRequestSchema.parse(request.body));
    return reply.status(201).send({ challenge });
  });

  app.post('/api/v1/trust/verify', async (request) =>
    service.verify(TrustVerificationRequestSchema.parse(request.body)),
  );

  app.post('/api/v1/trust/present', async (request) =>
    service.verify(TrustVerificationRequestSchema.parse(request.body)),
  );

  app.get('/api/v1/trust/issuers', async () => {
    return service.getIssuers();
  });

  app.post('/api/v1/trust/issuers', async (request, reply) => {
    // Basic Admin API Key for demo purposes
    if (request.headers['x-admin-api-key'] !== process.env.ADMIN_API_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const req = TrustIssuerRegistrationRequestSchema.parse(request.body);
    await service.registerIssuer(req.issuerId, req.publicKeyPem, req.active);
    return reply.status(201).send({ success: true });
  });

  app.post('/api/v1/trust/revocations', async (request, reply) => {
    // Basic Admin API Key for demo purposes
    if (request.headers['x-admin-api-key'] !== process.env.ADMIN_API_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const req = TrustRevocationRequestSchema.parse(request.body);
    await service.revokeCredential(req.credentialId);
    return reply.status(201).send({ success: true });
  });

  app.get('/api/v1/trust/audit', async (request, reply) => {
    // Require AUDITOR role? Wait, admin key is fine for this demo endpoint
    if (request.headers['x-admin-api-key'] !== process.env.ADMIN_API_KEY) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    return service.getTrustAudit();
  });
}
