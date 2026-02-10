import { describe, expect, it } from 'vitest';
import { decodeGuaranteeClaims, encodeGuaranteeClaims } from '../src/guarantee';
import { PaymentGuaranteeClaims } from '../src/models';
import { encodeAbiParameters } from 'viem';
import { VerificationError } from '../src/errors';

describe('guarantee codec', () => {
  it('round trips guarantee claims', () => {
    const claims: PaymentGuaranteeClaims = {
      domain: new Uint8Array(32),
      userAddress: '0x0000000000000000000000000000000000000001',
      recipientAddress: '0x0000000000000000000000000000000000000002',
      tabId: 1n,
      reqId: 2n,
      amount: 3n,
      totalAmount: 4n,
      assetAddress: '0x0000000000000000000000000000000000000000',
      timestamp: 123456,
      version: 1,
    };
    const encoded = encodeGuaranteeClaims(claims);
    const decoded = decodeGuaranteeClaims(encoded);
    expect(decoded.userAddress).toBe(claims.userAddress);
    expect(decoded.recipientAddress).toBe(claims.recipientAddress);
    expect(decoded.tabId).toBe(claims.tabId);
    expect(decoded.amount).toBe(claims.amount);
  });

  it('rejects unsupported guarantee version on encode', () => {
    const claims: PaymentGuaranteeClaims = {
      domain: new Uint8Array(32),
      userAddress: '0x0000000000000000000000000000000000000001',
      recipientAddress: '0x0000000000000000000000000000000000000002',
      tabId: 1n,
      reqId: 2n,
      amount: 3n,
      totalAmount: 4n,
      assetAddress: '0x0000000000000000000000000000000000000000',
      timestamp: 123456,
      version: 2,
    };
    expect(() => encodeGuaranteeClaims(claims)).toThrow(VerificationError);
  });

  it('rejects invalid domain size', () => {
    const claims: PaymentGuaranteeClaims = {
      domain: new Uint8Array(31),
      userAddress: '0x0000000000000000000000000000000000000001',
      recipientAddress: '0x0000000000000000000000000000000000000002',
      tabId: 1n,
      reqId: 2n,
      amount: 3n,
      totalAmount: 4n,
      assetAddress: '0x0000000000000000000000000000000000000000',
      timestamp: 123456,
      version: 1,
    };
    expect(() => encodeGuaranteeClaims(claims)).toThrow(VerificationError);
  });

  it('rejects invalid wrapped claims version', () => {
    const raw = encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'bytes' }],
      [2n, '0x' + '00'.repeat(32 * 10)]
    );
    expect(() => decodeGuaranteeClaims(raw)).toThrow(VerificationError);
  });

  it('rejects invalid claims length', () => {
    expect(() => decodeGuaranteeClaims('0x1234')).toThrow(VerificationError);
  });

  it('rejects unsupported claims version inside payload', () => {
    const encoded = encodeAbiParameters(
      [
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
      ],
      [
        '0x' + '00'.repeat(32),
        1n,
        2n,
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        3n,
        4n,
        '0x0000000000000000000000000000000000000000',
        5n,
        2n,
      ]
    );
    expect(() => decodeGuaranteeClaims(encoded)).toThrow(VerificationError);
  });
});
