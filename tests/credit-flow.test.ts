import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeGuaranteeClaims } from '../src/guarantee';
import { PaymentGuaranteeRequestClaims, SigningScheme } from '../src/models';
import { buildPaymentPayload } from '../src/payment';
import { RecipientClient } from '../src/client/recipient';
import { UserClient } from '../src/client/user';
import type { Client } from '../src/client';
import type { ContractGateway } from '../src/contract';
import type { RpcProxy } from '../src/rpc';
import { CorePublicParameters } from '../src/signing';
import { VerificationError } from '../src/errors';

const USER = '0x0000000000000000000000000000000000000011';
const RECIPIENT = '0x0000000000000000000000000000000000000022';
const ASSET = '0x0000000000000000000000000000000000000003';

const buildClientStub = (overrides: Partial<Client> = {}): Client => {
  const signer = privateKeyToAccount(
    '0x59c6995e998f97a5a0044976f7be35d5ad91c0cfa55b5cfb20b07a1c60f4c5bc'
  );
  const params = new CorePublicParameters(
    new Uint8Array(),
    '0x0000000000000000000000000000000000000000',
    'https://example.com',
    '4Mica',
    '1',
    1
  );
  return {
    rpc: {} as RpcProxy,
    gateway: {} as ContractGateway,
    signer: { signer } as unknown as Client['signer'],
    params,
    guaranteeDomain: '0x' + '00'.repeat(32),
    user: {} as Client['user'],
    recipient: {} as Client['recipient'],
    aclose: async () => {},
    login: async () => ({ accessToken: 'token', refreshToken: 'rt', expiresIn: 60 }),
    ...overrides,
  } as Client;
};

describe('credit-flow coverage', () => {
  it('builds payment payload with serialized claims', () => {
    const claims = PaymentGuaranteeRequestClaims.new(USER, RECIPIENT, 2, 5, 1234, ASSET, 7);
    const payload = buildPaymentPayload(claims, {
      signature: '0xdeadbeef',
      scheme: SigningScheme.EIP712,
    });

    expect(payload.claims.version).toBe('v1');
    expect(payload.claims.user_address).toBe(USER);
    expect(payload.claims.recipient_address).toBe(RECIPIENT);
    expect(payload.claims.tab_id).toBe('0x2');
    expect(payload.claims.req_id).toBe('0x7');
    expect(payload.claims.amount).toBe('0x5');
    expect(payload.claims.asset_address).toBe(ASSET);
    expect(payload.claims.timestamp).toBe(1234);
    expect(payload.signature).toBe('0xdeadbeef');
  });

  it('issues payment guarantee with serialized payload', async () => {
    const issueGuarantee = vi.fn().mockResolvedValue({ claims: '0xabc', signature: '0xdef' });
    const rpc = { issueGuarantee } as unknown as RpcProxy;
    const client = buildClientStub({ rpc });
    const recipient = new RecipientClient(client);

    const claims = PaymentGuaranteeRequestClaims.new(
      USER,
      RECIPIENT,
      0x10,
      0x20,
      1234,
      ASSET,
      0x30
    );

    const cert = await recipient.issuePaymentGuarantee(claims, '0xsig', SigningScheme.EIP712);

    expect(issueGuarantee).toHaveBeenCalledTimes(1);
    const payload = issueGuarantee.mock.calls[0]?.[0] as Record<string, unknown>;
    const claims = payload.claims as Record<string, unknown>;
    expect(claims.tab_id).toBe('0x10');
    expect(claims.req_id).toBe('0x30');
    expect(claims.amount).toBe('0x20');
    expect(claims.user_address).toBe(USER);
    expect(claims.recipient_address).toBe(RECIPIENT);
    expect(claims.asset_address).toBe(ASSET);

    expect(cert.claims).toBe('0xabc');
    expect(cert.signature).toBe('0xdef');
  });

  it('verifies guarantee domain and rejects mismatch', () => {
    const domain = new Uint8Array(32);
    const encoded = encodeGuaranteeClaims({
      domain,
      userAddress: USER,
      recipientAddress: RECIPIENT,
      tabId: 1n,
      reqId: 2n,
      amount: 3n,
      totalAmount: 4n,
      assetAddress: ASSET,
      timestamp: 123,
      version: 1,
    });

    const okClient = buildClientStub({
      guaranteeDomain: '0x' + Buffer.from(domain).toString('hex'),
    });
    const okRecipient = new RecipientClient(okClient);
    const decoded = okRecipient.verifyPaymentGuarantee({
      claims: encoded,
      signature: '0x' + '11'.repeat(96),
    });
    expect(decoded.tabId).toBe(1n);

    const badClient = buildClientStub({ guaranteeDomain: '0x' + '11'.repeat(32) });
    const badRecipient = new RecipientClient(badClient);
    expect(() =>
      badRecipient.verifyPaymentGuarantee({ claims: encoded, signature: '0x' + '11'.repeat(96) })
    ).toThrow(VerificationError);
  });

  it('maps tab payment status from gateway', async () => {
    const gateway = {
      getPaymentStatus: vi.fn().mockResolvedValue({
        paidAmount: '7',
        paidOut: true,
        assetAddress: ASSET,
      }),
    } as unknown as ContractGateway;
    const client = buildClientStub({ gateway });
    const user = new UserClient(client);

    const status = await user.getTabPaymentStatus(5n);
    expect(status.paid).toBe(7n);
    expect(status.remunerated).toBe(true);
    expect(status.asset).toBe(ASSET);
  });

  it('routes payments to the correct gateway method', async () => {
    const payTabEth = vi.fn();
    const payTabErc20 = vi.fn();
    const gateway = { payTabEth, payTabErc20 } as unknown as ContractGateway;
    const client = buildClientStub({ gateway });
    const user = new UserClient(client);

    await user.payTab(1n, 2n, 3n, RECIPIENT, ASSET);
    expect(payTabErc20).toHaveBeenCalledWith(1n, 3n, ASSET, RECIPIENT);
    expect(payTabEth).not.toHaveBeenCalled();

    await user.payTab(1n, 2n, 3n, RECIPIENT);
    expect(payTabEth).toHaveBeenCalledWith(1n, 2n, 3n, RECIPIENT);
  });

  it('creates tabs and normalizes ids', async () => {
    const rpc = {
      createPaymentTab: vi.fn().mockResolvedValue({ id: '0x10' }),
    } as unknown as RpcProxy;
    const client = buildClientStub({ rpc });
    const recipient = new RecipientClient(client);

    const tabId = await recipient.createTab(USER, RECIPIENT, ASSET, 60);
    expect(tabId).toBe(16n);
  });

  it('rejects invalid remuneration signature types', async () => {
    const gateway = { remunerate: vi.fn() } as unknown as ContractGateway;
    const client = buildClientStub({ gateway });
    const recipient = new RecipientClient(client);
    const validClaims = encodeGuaranteeClaims({
      domain: new Uint8Array(32),
      userAddress: USER,
      recipientAddress: RECIPIENT,
      tabId: 1n,
      reqId: 1n,
      amount: 1n,
      totalAmount: 1n,
      assetAddress: ASSET,
      timestamp: 123,
      version: 1,
    });

    await expect(
      recipient.remunerate({
        claims: validClaims,
        signature: 123 as unknown as string,
      })
    ).rejects.toThrow(VerificationError);
  });
});
