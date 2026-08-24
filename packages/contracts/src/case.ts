import { z } from "zod";

export const caseStateSchema = z.enum([
  "NORMAL",
  "ANOMALOUS",
  "WATCH",
  "REPORTED",
  "ACTIVE_CASE",
  "TRACE",
  "PREDICT",
  "ABSTAIN",
  "INTERVENTION",
  "MONITORING",
  "OUTCOME",
  "CLOSED"
]);

export type CaseState = z.infer<typeof caseStateSchema>;

export const complaintSchema = z
  .object({
    caseId: z.string().min(1),
    complaintId: z.string().min(1),
    transactionId: z.string().min(1),
    amountPaise: z.int().positive(),
    reportedAt: z.iso.datetime({ offset: true }),
    fraudContext: z.string().min(1),
    payerReference: z.string().min(1),
    beneficiaryReference: z.string().min(1),
    sourceUrls: z.array(z.url()).min(1)
  })
  .strict();

export type Complaint = z.infer<typeof complaintSchema>;

export const createComplaintRequestSchema = complaintSchema
  .extend({ idempotencyKey: z.string().min(1) })
  .strict();

export type CreateComplaintRequest = z.infer<typeof createComplaintRequestSchema>;

export const resolveTransactionRequestSchema = z
  .object({ transactionId: z.string().min(1), maxHops: z.int().min(1).max(4).default(4) })
  .strict();

export type ResolveTransactionRequest = z.infer<typeof resolveTransactionRequestSchema>;

export const muleRiskStateSchema = z.enum(["NORMAL", "ANOMALOUS", "WATCH", "SUSPECTED_MULE", "CONFIRMED"]);
export type MuleRiskState = z.infer<typeof muleRiskStateSchema>;

export const evidenceGateStateSchema = z.enum(["PREDICT", "ABSTAIN"]);
export const confidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_EVIDENCE"]);
export type EvidenceGateState = z.infer<typeof evidenceGateStateSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;

export const geoCandidateSchema = z
  .object({
    locationId: z.string().min(1),
    label: z.string().min(1),
    latitude: z.number().gte(-90).lte(90),
    longitude: z.number().gte(-180).lte(180),
    historicalWeight: z.number().positive()
  })
  .strict();

export type GeoCandidate = z.infer<typeof geoCandidateSchema>;

export const authorisedRoleSchema = z.enum(["LAW_ENFORCEMENT", "BANK_ANALYST"]);
export const accessPurposeSchema = z.enum(["FRAUD_INVESTIGATION", "BANK_ESCALATION"]);
export type AuthorisedRole = z.infer<typeof authorisedRoleSchema>;
export type AccessPurpose = z.infer<typeof accessPurposeSchema>;

export const trustChallengeRequestSchema = z.object({
  caseId: z.string().min(1), role: authorisedRoleSchema, purpose: accessPurposeSchema
}).strict();

export const credentialPresentationSchema = z.object({
  challengeId: z.string().min(1), credentialId: z.string().min(1), nonce: z.string().min(1)
}).strict();

export const evidenceAnchorRequestSchema = z.object({
  caseId: z.string().min(1), evidenceId: z.string().min(1), content: z.string().min(1),
  idempotencyKey: z.string().min(1), anchoredAt: z.iso.datetime({ offset: true })
}).strict();

export const interventionStateSchema = z.enum([
  "ACTIVE_INTERVENTION_WINDOW", "ELEVATED_HORIZON", "MONITORING", "CASH_OUT_MAY_HAVE_OCCURRED", "CLOSED"
]);
export const alertSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type InterventionState = z.infer<typeof interventionStateSchema>;
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;

export const alertJobPayloadSchema = z.object({
  alertId: z.string().min(1),
  caseId: z.string().min(1),
  severity: alertSeveritySchema,
  kind: z.enum(["TRACE_RISK", "EVIDENCE_INTEGRITY", "INTERVENTION", "SYSTEM"]),
  title: z.string().min(1),
  message: z.string().min(1),
  sourceEventId: z.string().min(1).optional(),
  sourceUrls: z.array(z.url()).default([]),
  createdAt: z.iso.datetime({ offset: true })
}).strict();

export type AlertJobPayload = z.infer<typeof alertJobPayloadSchema>;

export const caseActionRequestSchema = z.object({
  idempotencyKey: z.string().min(1),
  action: z.enum(["ALERT_BANK", "ALERT_LEA", "ESCALATE_CASE", "ADD_ANALYST_NOTE", "MARK_OUTCOME"]),
  rationale: z.string().min(1),
  sourceUrls: z.array(z.url()).min(1),
  occurredAt: z.iso.datetime({ offset: true })
}).strict();

