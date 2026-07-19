const VERSION_1_SIGNATURES: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bASIA[0-9A-Z]{16}\b/,
  /\bsk-(?:live|proj)-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35})\b/,
  /(?:^|[\n\r])\s*(?:authorization|api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["']?(?:Bearer\s+)?[A-Za-z0-9_./+=-]{24,}["']?\s*(?:$|[\n\r])/i,
];

export type SecretPolicyEvaluator = (text: string) => boolean;

export function containsHighConfidenceSecretV1(text: string): boolean {
  return VERSION_1_SIGNATURES.some((signature) => signature.test(text));
}

export function secretPolicyEvaluator(admissionPolicyVersion: number): SecretPolicyEvaluator {
  if (admissionPolicyVersion === 1) return containsHighConfidenceSecretV1;
  throw new RangeError("Unsupported admission policy version.");
}
