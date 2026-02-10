import { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { PaymentGuaranteeRequestClaims, SigningScheme } from '../src/models';
import { CorePublicParameters, PaymentSigner, validateGuaranteeTypedData } from '../src/signing';
import { ValidationError } from '../src/utils';
import { SigningError } from '../src/errors';

function buildParams(): CorePublicParameters {
  return new CorePublicParameters(
    new Uint8Array(),
    '0x0000000000000000000000000000000000000000',
    'https://example.com',
    '4Mica',
    '1',
    1
  );
}

describe('PaymentSigner', () => {
  it('rejects address mismatch', async () => {
    const signer = new PaymentSigner(privateKeyToAccount(('0x' + '11'.repeat(32)) as Hex));
    const claims = PaymentGuaranteeRequestClaims.new(
      '0x0000000000000000000000000000000000000011',
      '0x0000000000000000000000000000000000000002',
      1,
      5,
      1234,
      null,
      7
    );
    await expect(signer.signRequest(buildParams(), claims, SigningScheme.EIP712)).rejects.toThrow(
      SigningError
    );
  });

  it('produces eip712 signature', async () => {
    const privateKey = '0x59c6995e998f97a5a0044976f7be35d5ad91c0cfa55b5cfb20b07a1c60f4c5bc';
    const localSigner = privateKeyToAccount(privateKey);
    const signer = new PaymentSigner(localSigner);
    const accountAddress = localSigner.address.toLowerCase();
    const claims = PaymentGuaranteeRequestClaims.new(
      accountAddress,
      '0x0000000000000000000000000000000000000002',
      42,
      123,
      999,
      null,
      2
    );
    const sig = await signer.signRequest(buildParams(), claims, SigningScheme.EIP712);
    expect(sig.scheme).toBe(SigningScheme.EIP712);
    expect(sig.signature.length).toBe(132);
  });

  it('produces eip191 signature', async () => {
    const privateKey = '0x59c6995e998f97a5a0044976f7be35d5ad91c0cfa55b5cfb20b07a1c60f4c5bc';
    const localSigner = privateKeyToAccount(privateKey);
    const signer = new PaymentSigner(localSigner);
    const accountAddress = localSigner.address.toLowerCase();
    const claims = PaymentGuaranteeRequestClaims.new(
      accountAddress,
      '0x0000000000000000000000000000000000000002',
      42,
      123,
      999,
      null,
      2
    );
    const sig = await signer.signRequest(buildParams(), claims, SigningScheme.EIP191);
    expect(sig.scheme).toBe(SigningScheme.EIP191);
    expect(sig.signature.startsWith('0x')).toBe(true);
  });
});

describe('validateGuaranteeTypedData', () => {
  it('rejects missing fields', () => {
    expect(() =>
      validateGuaranteeTypedData({
        domain: {},
        types: {},
        message: {},
      })
    ).toThrow(ValidationError);
  });

  it('rejects chainId mismatch when provided', () => {
    const payload = {
      domain: { chainId: 1 },
      types: {
        SolGuaranteeRequestClaimsV1: [
          { name: 'user', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'tabId', type: 'uint256' },
          { name: 'reqId', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'asset', type: 'address' },
          { name: 'timestamp', type: 'uint64' },
        ],
      },
      message: {
        user: '0x0000000000000000000000000000000000000001',
        recipient: '0x0000000000000000000000000000000000000002',
        tabId: '1',
        reqId: '2',
        amount: '3',
        asset: '0x0000000000000000000000000000000000000000',
        timestamp: '4',
      },
    };
    expect(() => validateGuaranteeTypedData(payload, { expectedChainId: 2 })).toThrow(
      ValidationError
    );
  });
});
