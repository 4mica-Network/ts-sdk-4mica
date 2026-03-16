import { toBytes, encodeAbiParameters, decodeAbiParameters, type Hex } from 'viem';
import { VerificationError } from './errors';
import { PaymentGuaranteeClaims, PaymentGuaranteeValidationPolicyV2 } from './models';
import { parseU256, hexFromBytes, ensureHexPrefix } from './utils';

const CLAIMS_ENCODED_BYTES = 32 * 10;
// Minimum bytes for a valid outer envelope: uint64 + bytes offset + bytes length
const MIN_ENVELOPE_BYTES = 32 * 2 + 32;
const CLAIM_TYPES = [
  { type: 'bytes32' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'address' },
  { type: 'address' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'address' },
  { type: 'uint64' },
  { type: 'uint64' },
] as const;

// V2 adds: validation_registry_address, validation_request_hash, validation_chain_id,
//          validator_address, validator_agent_id, min_validation_score,
//          validation_subject_hash, required_validation_tag (dynamic string)
const CLAIM_TYPES_V2 = [
  { type: 'bytes32' }, // domain
  { type: 'uint256' }, // tab_id
  { type: 'uint256' }, // req_id
  { type: 'address' }, // client (user)
  { type: 'address' }, // recipient
  { type: 'uint256' }, // amount
  { type: 'uint256' }, // total_amount
  { type: 'address' }, // asset
  { type: 'uint64' }, // timestamp
  { type: 'uint64' }, // version
  { type: 'address' }, // validation_registry_address
  { type: 'bytes32' }, // validation_request_hash
  { type: 'uint64' }, // validation_chain_id
  { type: 'address' }, // validator_address
  { type: 'uint256' }, // validator_agent_id
  { type: 'uint8' }, // min_validation_score
  { type: 'bytes32' }, // validation_subject_hash
  { type: 'string' }, // required_validation_tag (dynamic)
] as const;

function ensureDomainBytes(domain: string | Uint8Array): Uint8Array {
  const bytes = typeof domain === 'string' ? toBytes(domain) : domain;
  if (bytes.length !== 32) {
    throw new VerificationError('domain separator must be 32 bytes');
  }
  return bytes;
}

function normalizeHexBytes(data: string | Uint8Array): Hex {
  if (typeof data === 'string') {
    return ensureHexPrefix(data);
  }
  return hexFromBytes(data);
}

export function encodeGuaranteeClaims(claims: PaymentGuaranteeClaims): string {
  if (claims.version === 1) {
    const domain = ensureDomainBytes(claims.domain);
    const encoded = encodeAbiParameters(CLAIM_TYPES, [
      hexFromBytes(domain),
      parseU256(claims.tabId),
      parseU256(claims.reqId),
      claims.userAddress as Hex,
      claims.recipientAddress as Hex,
      parseU256(claims.amount),
      parseU256(claims.totalAmount),
      claims.assetAddress as Hex,
      BigInt(claims.timestamp),
      BigInt(claims.version),
    ]);
    return encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'bytes' }],
      [BigInt(claims.version), encoded]
    );
  }

  if (claims.version === 2) {
    if (!claims.validationPolicy) {
      throw new VerificationError('V2 guarantee claims missing validationPolicy');
    }
    const p = claims.validationPolicy;
    const domain = ensureDomainBytes(claims.domain);
    const encoded = encodeAbiParameters(CLAIM_TYPES_V2, [
      hexFromBytes(domain),
      parseU256(claims.tabId),
      parseU256(claims.reqId),
      claims.userAddress as Hex,
      claims.recipientAddress as Hex,
      parseU256(claims.amount),
      parseU256(claims.totalAmount),
      claims.assetAddress as Hex,
      BigInt(claims.timestamp),
      BigInt(claims.version),
      p.validationRegistryAddress as Hex,
      ensureHexPrefix(p.validationRequestHash),
      BigInt(p.validationChainId),
      p.validatorAddress as Hex,
      p.validatorAgentId,
      p.minValidationScore,
      ensureHexPrefix(p.validationSubjectHash),
      p.requiredValidationTag,
    ]);
    return encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'bytes' }],
      [BigInt(claims.version), encoded]
    );
  }

  throw new VerificationError(`unsupported guarantee claims version: ${claims.version}`);
}

export function decodeGuaranteeClaims(data: string | Uint8Array): PaymentGuaranteeClaims {
  const hex = normalizeHexBytes(data);
  const byteLen = (hex.length - 2) / 2;

  // Try to decode as unwrapped V1 (legacy)
  if (byteLen === CLAIMS_ENCODED_BYTES) {
    return decodeV1Claims(hex);
  }

  // Decode outer envelope to get version
  if (byteLen < MIN_ENVELOPE_BYTES) {
    throw new VerificationError(`unexpected guarantee claims length: ${byteLen} bytes`);
  }

  const [version, wrapped] = decodeAbiParameters([{ type: 'uint64' }, { type: 'bytes' }], hex);

  if (version === 1n) {
    const innerHex = wrapped as Hex;
    const innerByteLen = (innerHex.length - 2) / 2;
    if (innerByteLen !== CLAIMS_ENCODED_BYTES) {
      throw new VerificationError(`unexpected V1 claims inner length: ${innerByteLen} bytes`);
    }
    return decodeV1Claims(innerHex);
  }

  if (version === 2n) {
    return decodeV2Claims(wrapped as Hex);
  }

  throw new VerificationError(`unsupported guarantee claims version: ${version}`);
}

function decodeV1Claims(encoded: Hex): PaymentGuaranteeClaims {
  let decoded: ReturnType<typeof decodeAbiParameters<typeof CLAIM_TYPES>>;
  try {
    decoded = decodeAbiParameters(CLAIM_TYPES, encoded);
  } catch (err) {
    throw new VerificationError(`failed to decode V1 guarantee claims: ${String(err)}`);
  }
  const [
    domain,
    tabId,
    reqId,
    user,
    recipient,
    amount,
    totalAmount,
    asset,
    timestamp,
    claimsVersion,
  ] = decoded;

  if (claimsVersion !== 1n) {
    throw new VerificationError(`unsupported guarantee claims version: ${claimsVersion}`);
  }

  return {
    domain: toBytes(domain as Hex),
    userAddress: user as string,
    recipientAddress: recipient as string,
    tabId: parseU256(tabId),
    reqId: parseU256(reqId),
    amount: parseU256(amount),
    totalAmount: parseU256(totalAmount),
    assetAddress: asset as string,
    timestamp: Number(timestamp),
    version: Number(claimsVersion),
  };
}

function decodeV2Claims(encoded: Hex): PaymentGuaranteeClaims {
  let decoded: ReturnType<typeof decodeAbiParameters<typeof CLAIM_TYPES_V2>>;
  try {
    decoded = decodeAbiParameters(CLAIM_TYPES_V2, encoded);
  } catch (err) {
    throw new VerificationError(`failed to decode V2 guarantee claims: ${String(err)}`);
  }
  const [
    domain,
    tabId,
    reqId,
    user,
    recipient,
    amount,
    totalAmount,
    asset,
    timestamp,
    claimsVersion,
    validationRegistryAddress,
    validationRequestHash,
    validationChainId,
    validatorAddress,
    validatorAgentId,
    minValidationScore,
    validationSubjectHash,
    requiredValidationTag,
  ] = decoded;

  if (claimsVersion !== 2n) {
    throw new VerificationError(`expected V2 claims version, got: ${claimsVersion}`);
  }

  const validationPolicy: PaymentGuaranteeValidationPolicyV2 = {
    validationRegistryAddress: validationRegistryAddress as string,
    validationRequestHash: validationRequestHash as string,
    validationChainId: Number(validationChainId),
    validatorAddress: validatorAddress as string,
    validatorAgentId: parseU256(validatorAgentId),
    minValidationScore: Number(minValidationScore),
    validationSubjectHash: validationSubjectHash as string,
    requiredValidationTag: requiredValidationTag as string,
  };

  return {
    domain: toBytes(domain as Hex),
    userAddress: user as string,
    recipientAddress: recipient as string,
    tabId: parseU256(tabId),
    reqId: parseU256(reqId),
    amount: parseU256(amount),
    totalAmount: parseU256(totalAmount),
    assetAddress: asset as string,
    timestamp: Number(timestamp),
    version: Number(claimsVersion),
    validationPolicy,
  };
}
