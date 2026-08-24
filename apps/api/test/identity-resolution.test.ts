import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { tokenDigest, TrustSession } from '@trishul/trust';

describe('Identity Resolution API', () => {
  const apps: FastifyInstance[] = [];

  it('allows an investigator to request resolution and a supervisor to approve it', async () => {
    const app = buildApp({
      enforceTrustAccess: false,
    });
    apps.push(app);

    // 1. Create a fake investigator session
    const investigatorSession: TrustSession = {
      sessionId: randomUUID(),
      subjectId: 'investigator:1',
      role: 'INVESTIGATOR',
      capabilities: ['CASE_READ', 'IDENTITY_RESOLUTION'],
      purpose: 'INVESTIGATION',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    
    // @ts-expect-error test backdoor
    app.addHook('preHandler', async (request) => {
      // @ts-expect-error
      if (request.headers.authorization === 'Bearer TEST-INVESTIGATOR') {
        // @ts-expect-error
        request.trustSession = investigatorSession;
      }
      // @ts-expect-error
      if (request.headers.authorization === 'Bearer TEST-SUPERVISOR') {
        // @ts-expect-error
        request.trustSession = {
          ...investigatorSession,
          subjectId: 'supervisor:1',
          role: 'SUPERVISOR',
        };
      }
    });

    await app.ready();

    const requestRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:123/identity-resolution',
      headers: { authorization: 'Bearer TEST-INVESTIGATOR' }
    });

    expect(requestRes.statusCode).toBe(201);
    const reqBody = requestRes.json();
    expect(reqBody.status).toBe('PENDING');
    const requestId = reqBody.requestId;

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/identity-resolution/${requestId}/approve`,
      headers: { authorization: 'Bearer TEST-SUPERVISOR' },
      payload: { approved: true }
    });

    expect(approveRes.statusCode).toBe(200);
    const approveBody = approveRes.json();
    expect(approveBody.status).toBe('APPROVED');
    expect(approveBody.pii).toBeDefined();
    expect(approveBody.pii.name).toBe('John Doe');
  });
});
