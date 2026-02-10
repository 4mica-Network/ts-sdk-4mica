import { toBytes, encodeAbiParameters, decodeAbiParameters, type Hex } from 'viem';
import { VerificationError } from './errors';
import { PaymentGuaranteeClaims } from './models';
import { parseU256, hexFromBytes } from './utils';

const CLAIMS_ENCODED_BYTES = 32 * 10;
const WRAPPED_CLAIMS_BYTES = 32 * 2 + 32 + CLAIMS_ENCODED_BYTES;
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

function normalizeHexBytes(data: string | Uint8Array): Hex {
  if (typeof data === 'string') {
    return (data.startsWith('0x') ? data : `0x${data}`) as Hex;
  }
  return hexFromBytes(data);
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
  const hex = normalizeHexBytes(data);
  const byteLen = (hex.length - 2) / 2;

  let encoded: Hex;
  if (byteLen === CLAIMS_ENCODED_BYTES) {
    encoded = hex;
  } else {
    if (byteLen !== WRAPPED_CLAIMS_BYTES) {
      throw new VerificationError(`unexpected guarantee claims length: ${byteLen} bytes`);
    }
    const [version, wrapped] = decodeAbiParameters([{ type: 'uint64' }, { type: 'bytes' }], hex);
    if (version !== 1n) {
      throw new VerificationError(`unsupported guarantee claims version: ${version}`);
    }
    encoded = wrapped as Hex;
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
  ] = decodeAbiParameters(CLAIM_TYPES, encoded);

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
