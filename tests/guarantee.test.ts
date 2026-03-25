import { describe, expect, it } from 'vitest';
import { decodeGuaranteeClaims, encodeGuaranteeClaims } from '../src/guarantee';
import { PaymentGuaranteeClaims } from '../src/models';
import { encodeAbiParameters } from 'viem';
import { VerificationError } from '../src/errors';

const V2_POLICY = {
  validationRegistryAddress: '0x0000000000000000000000000000000000000011',
  validationRequestHash: '0x' + 'ab'.repeat(32),
  validationChainId: 1,
  validatorAddress: '0x0000000000000000000000000000000000000022',
  validatorAgentId: 42n,
  minValidationScore: 80,
  validationSubjectHash: '0x' + 'cd'.repeat(32),
  requiredValidationTag: 'trust-level-1',
};

const CORE_V2_CLAIMS_FIXTURE =
  '0x0000000000000000000000000000000000000000000000000000000000000002' +
  '0000000000000000000000000000000000000000000000000000000000000040' +
  '0000000000000000000000000000000000000000000000000000000000000280' +
  '0000000000000000000000000000000000000000000000000000000000000020' +
  '9cd1412ea9d30818b689816af28dcce875486ac570999c00831562851d25a500' +
  'd8ae198e8ba5f7142484a7bbff09cf8748e2f9af86db85eb72ac6493fd05bb58' +
  '0000000000000000000000000000000000000000000000000000000000000003' +
  '000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266' +
  '000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266' +
  '00000000000000000000000000000000000000000000000000000000000003e8' +
  '00000000000000000000000000000000000000000000000000000000000003e8' +
  '000000000000000000000000036cbd53842c5426634e7929541ec2318f3dcf7e' +
  '0000000000000000000000000000000000000000000000000000000069b9780b' +
  '0000000000000000000000000000000000000000000000000000000000000002' +
  '0000000000000000000000008004cb1bf31daf7788923b405b754f57aceb4272' +
  'e576cdb1317db2498821c043ae03757feaa87cecde960bf28ce81a36991c820c' +
  '0000000000000000000000000000000000000000000000000000000000014a34' +
  '000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266' +
  '0000000000000000000000000000000000000000000000000000000000000001' +
  '0000000000000000000000000000000000000000000000000000000000000050' +
  '142eec1e05385bff20ad4162a317a0e8ba27edbb6be5c88fd7466a0e1577951d' +
  '0000000000000000000000000000000000000000000000000000000000000240' +
  '0000000000000000000000000000000000000000000000000000000000000000';

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
      version: 99,
    };
    expect(() => encodeGuaranteeClaims(claims)).toThrow(VerificationError);
  });

  it('rejects V2 encode when validationPolicy is missing', () => {
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

  it('round trips V2 guarantee claims', () => {
    const claims: PaymentGuaranteeClaims = {
      domain: new Uint8Array(32),
      userAddress: '0x0000000000000000000000000000000000000001',
      recipientAddress: '0x0000000000000000000000000000000000000002',
      tabId: 5n,
      reqId: 6n,
      amount: 100n,
      totalAmount: 200n,
      assetAddress: '0x0000000000000000000000000000000000000000',
      timestamp: 999999,
      version: 2,
      validationPolicy: V2_POLICY,
    };
    const encoded = encodeGuaranteeClaims(claims);
    const decoded = decodeGuaranteeClaims(encoded);

    expect(decoded.version).toBe(2);
    expect(decoded.userAddress).toBe(claims.userAddress);
    expect(decoded.recipientAddress).toBe(claims.recipientAddress);
    expect(decoded.tabId).toBe(claims.tabId);
    expect(decoded.reqId).toBe(claims.reqId);
    expect(decoded.amount).toBe(claims.amount);
    expect(decoded.totalAmount).toBe(claims.totalAmount);
    expect(decoded.timestamp).toBe(claims.timestamp);

    const policy = decoded.validationPolicy!;
    expect(policy.validationRegistryAddress.toLowerCase()).toBe(
      V2_POLICY.validationRegistryAddress.toLowerCase()
    );
    expect(policy.validationRequestHash).toBe(V2_POLICY.validationRequestHash);
    expect(policy.validationChainId).toBe(V2_POLICY.validationChainId);
    expect(policy.validatorAddress.toLowerCase()).toBe(V2_POLICY.validatorAddress.toLowerCase());
    expect(policy.validatorAgentId).toBe(V2_POLICY.validatorAgentId);
    expect(policy.minValidationScore).toBe(V2_POLICY.minValidationScore);
    expect(policy.validationSubjectHash).toBe(V2_POLICY.validationSubjectHash);
    expect(policy.requiredValidationTag).toBe(V2_POLICY.requiredValidationTag);
  });

  it('decodes a core-generated V2 guarantee payload', () => {
    const decoded = decodeGuaranteeClaims(CORE_V2_CLAIMS_FIXTURE);
    expect(decoded.version).toBe(2);
    expect(decoded.tabId).toBe(
      98007183069934757906524387733029274172219001426496776304406352132712568306520n
    );
    expect(decoded.reqId).toBe(3n);
    expect(decoded.amount).toBe(1000n);
    expect(decoded.totalAmount).toBe(1000n);
    expect(decoded.assetAddress.toLowerCase()).toBe('0x036cbd53842c5426634e7929541ec2318f3dcf7e');
    expect(decoded.validationPolicy?.validationChainId).toBe(84532);
    expect(decoded.validationPolicy?.validatorAgentId).toBe(1n);
    expect(decoded.validationPolicy?.minValidationScore).toBe(80);
    expect(decoded.validationPolicy?.requiredValidationTag).toBe('');
  });

  it('V1 and V2 decoded with correct version field', () => {
    const v1: PaymentGuaranteeClaims = {
      domain: new Uint8Array(32),
      userAddress: '0x0000000000000000000000000000000000000001',
      recipientAddress: '0x0000000000000000000000000000000000000002',
      tabId: 1n,
      reqId: 0n,
      amount: 1n,
      totalAmount: 1n,
      assetAddress: '0x0000000000000000000000000000000000000000',
      timestamp: 1,
      version: 1,
    };
    const v2: PaymentGuaranteeClaims = { ...v1, version: 2, validationPolicy: V2_POLICY };
    expect(decodeGuaranteeClaims(encodeGuaranteeClaims(v1)).version).toBe(1);
    expect(decodeGuaranteeClaims(encodeGuaranteeClaims(v2)).version).toBe(2);
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

  it('rejects unsupported wrapped claims version', () => {
    const raw = encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'bytes' }],
      [99n, '0x' + '00'.repeat(32 * 10)]
    );
    expect(() => decodeGuaranteeClaims(raw)).toThrow(VerificationError);
  });

  it('rejects invalid claims length', () => {
    expect(() => decodeGuaranteeClaims('0x1234')).toThrow(VerificationError);
  });

  it('decodes legacy unwrapped V1 format (no outer envelope)', () => {
    // The decoder accepts raw 320-byte V1 ABI encoding without the (uint64, bytes) wrapper
    const rawV1 = encodeAbiParameters(
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
        11n,
        22n,
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        33n,
        44n,
        '0x0000000000000000000000000000000000000000',
        555n,
        1n,
      ]
    );
    const decoded = decodeGuaranteeClaims(rawV1);
    expect(decoded.version).toBe(1);
    expect(decoded.tabId).toBe(11n);
    expect(decoded.reqId).toBe(22n);
    expect(decoded.amount).toBe(33n);
    expect(decoded.totalAmount).toBe(44n);
  });

  it('rejects wrapped V1 with incorrect inner byte length', () => {
    // Outer envelope says version=1 but inner bytes are not 320 bytes
    const raw = encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'bytes' }],
      [1n, '0x' + '00'.repeat(100)]
    );
    expect(() => decodeGuaranteeClaims(raw)).toThrow(VerificationError);
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
