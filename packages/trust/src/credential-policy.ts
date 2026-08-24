export interface CredentialPolicyInput {
  issuerTrusted: boolean;
  signatureValid: boolean;
  revoked: boolean;
  nonceFresh: boolean;
  roleMatches: boolean;
  purposeAllowed: boolean;
}

export interface CredentialPolicyResult {
  status: 'VERIFIED' | 'INVALID' | 'REVOKED';
  reasonCodes: string[];
  policyVersion: 'credential-policy-v1';
}

export function evaluateCredentialPolicy(input: CredentialPolicyInput): CredentialPolicyResult {
  if (input.revoked) {
    return {
      status: 'REVOKED',
      reasonCodes: ['CREDENTIAL_REVOKED'],
      policyVersion: 'credential-policy-v1',
    };
  }

  const reasonCodes: string[] = [];
  if (!input.issuerTrusted) reasonCodes.push('ISSUER_NOT_TRUSTED');
  if (!input.signatureValid) reasonCodes.push('SIGNATURE_INVALID');
  if (!input.nonceFresh) reasonCodes.push('NONCE_REPLAY_OR_EXPIRED');
  if (!input.roleMatches) reasonCodes.push('ROLE_MISMATCH');
  if (!input.purposeAllowed) reasonCodes.push('PURPOSE_NOT_ALLOWED');

  return {
    status: reasonCodes.length === 0 ? 'VERIFIED' : 'INVALID',
    reasonCodes: reasonCodes.length === 0 ? ['TRUST_PROPERTIES_VERIFIED'] : reasonCodes,
    policyVersion: 'credential-policy-v1',
  };
}
