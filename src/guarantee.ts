import { toBytes, encodeAbiParameters, decodeAbiParameters, type Hex } from 'viem';
import { VerificationError } from './errors';
import { PaymentGuaranteeClaims } from './models';
import { parseU256, hexFromBytes } from './utils';

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

function ensureDomainBytes(domain: string | Uint8Array): Uint8Array {
  const bytes = typeof domain === 'string' ? toBytes(domain) : domain;
  if (bytes.length !== 32) {
    throw new VerificationError('domain separator must be 32 bytes');
  }
  return bytes;
}

export function encodeGuaranteeClaims(claims: PaymentGuaranteeClaims): string {
  if (claims.version !== 1) {
    throw new VerificationError(`unsupported guarantee claims version: ${claims.version}`);
  }

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

export function decodeGuaranteeClaims(data: string | Uint8Array): PaymentGuaranteeClaims {
  const rawBytes = typeof data === 'string' ? toBytes(data) : data;
  const [version, encoded] = decodeAbiParameters([{ type: 'uint64' }, { type: 'bytes' }], rawBytes);
  if (version !== 1n) {
    throw new VerificationError(`unsupported guarantee claims version: ${version}`);
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
  ] = decodeAbiParameters(CLAIM_TYPES, encoded as Hex);

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
