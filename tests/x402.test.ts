import { describe, expect, it } from 'vitest';
import { PaymentGuaranteeRequestClaims, PaymentSignature, SigningScheme } from '../src/models';
import {
  PaymentRequirementsV1,
  PaymentRequirementsV2,
  X402PaymentRequired,
  TabResponse,
  X402Flow,
} from '../src/x402';
import type { FetchFn } from '../src/rpc';
import { X402Error } from '../src/errors';

const SCHEME = '4mica-credit';

class StubSigner {
  async signPayment(_claims: PaymentGuaranteeRequestClaims, _scheme: SigningScheme) {
    void _claims;
    void _scheme;
    return { signature: 'deadbeef', scheme: SigningScheme.EIP712 } as PaymentSignature;
  }
}

class StubX402Flow extends X402Flow {
  protected async requestTab(): Promise<TabResponse> {
    return {
      tabId: '2',
      userAddress: '0x0000000000000000000000000000000000000001',
      nextReqId: '7',
    };
  }
}

describe('X402Flow', () => {
  it('rejects invalid scheme', async () => {
    const flow = new StubX402Flow(new StubSigner());
    const requirements: PaymentRequirementsV1 = {
      scheme: 'http+pay',
      network: 'testnet',
      maxAmountRequired: '1',
      payTo: '0x0000000000000000000000000000000000000003',
      asset: '0x0000000000000000000000000000000000000000',
      extra: { tabEndpoint: 'https://example.com' },
    };
    await expect(
      flow.signPayment(requirements, '0x0000000000000000000000000000000000000001')
    ).rejects.toThrow(X402Error);
  });

  it('builds header and payload', async () => {
    const flow = new StubX402Flow(new StubSigner());
    const requirements: PaymentRequirementsV1 = {
      scheme: SCHEME,
      network: 'testnet',
      maxAmountRequired: '5',
      payTo: '0x0000000000000000000000000000000000000003',
      asset: '0x0000000000000000000000000000000000000000',
      extra: { tabEndpoint: 'https://example.com' },
    };
    const userAddress = '0x0000000000000000000000000000000000000001';
    const signed = await flow.signPayment(requirements, userAddress);
    const decoded = Buffer.from(signed.header, 'base64').toString('utf8');
    const envelope = JSON.parse(decoded);

    expect(envelope.x402Version).toBe(1);
    expect(envelope.scheme).toBe(SCHEME);
    expect(envelope.payload.claims.tab_id).toBe('0x2');
    expect(envelope.payload.claims.req_id).toBe('0x7');

    expect(signed.payload.claims.tab_id).toBe('0x2');
    expect(signed.payload.claims.req_id).toBe('0x7');
    expect(signed.payload.claims.amount).toBe('0x5');
  });

  it('builds header and payload for V2', async () => {
    const flow = new StubX402Flow(new StubSigner());
    const accepted: PaymentRequirementsV2 = {
      scheme: SCHEME,
      network: 'testnet',
      amount: '10',
      payTo: '0x0000000000000000000000000000000000000003',
      asset: '0x0000000000000000000000000000000000000000',
      extra: { tabEndpoint: 'https://example.com' },
    };
    const paymentRequired: X402PaymentRequired = {
      x402Version: 2,
      resource: {
        url: 'https://api.example.com/data',
        description: 'Premium data access',
        mimeType: 'application/json',
      },
      accepts: [accepted],
    };
    const userAddress = '0x0000000000000000000000000000000000000001';
    const signed = await flow.signPaymentV2(paymentRequired, accepted, userAddress);
    const decoded = Buffer.from(signed.header, 'base64').toString('utf8');
    const envelope = JSON.parse(decoded);

    expect(envelope.x402Version).toBe(2);
    expect(envelope.accepted.scheme).toBe(SCHEME);
    expect(envelope.accepted.amount).toBe('10');
    expect(envelope.resource.url).toBe('https://api.example.com/data');
    expect(envelope.payload.claims.tab_id).toBe('0x2');
    expect(envelope.payload.claims.req_id).toBe('0x7');

    expect(signed.payload.claims.tab_id).toBe('0x2');
    expect(signed.payload.claims.req_id).toBe('0x7');
    expect(signed.payload.claims.amount).toBe('0xa');
  });

  it('settles payment through facilitator', async () => {
    const userAddress = '0x0000000000000000000000000000000000000009';
    const tabEndpoint = 'http://facilitator.test/tab';
    const facilitatorUrl = 'http://facilitator.test';
    const requirements: PaymentRequirementsV1 = {
      scheme: SCHEME,
      network: 'testnet',
      maxAmountRequired: '5',
      payTo: '0x00000000000000000000000000000000000000ff',
      asset: '0x0000000000000000000000000000000000000000',
      extra: { tabEndpoint },
    };

    const fetch = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname === '/tab') {
        const body = JSON.parse(init?.body as string);
        expect(body.userAddress).toBe(userAddress);
        return new Response(JSON.stringify({ tabId: '0x1234', userAddress, nextReqId: '4' }), {
          status: 200,
        });
      }
      if (u.pathname === '/settle') {
        const payload = JSON.parse(init?.body as string);
        expect(payload.paymentRequirements.payTo).toBe(requirements.payTo);
        return new Response(JSON.stringify({ settled: true, networkId: requirements.network }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    };

    const flow = new X402Flow(new StubSigner(), fetch as FetchFn);
    const payment = await flow.signPayment(requirements, userAddress);
    expect(payment.payload.claims.tab_id).toBe('0x1234');
    expect(payment.payload.claims.req_id).toBe('0x4');

    const settled = await flow.settlePayment(payment, requirements, facilitatorUrl);
    expect((settled.settlement as any).settled).toBe(true);
    expect((settled.settlement as any).networkId).toBe(requirements.network);
    expect(settled.payment.payload.claims.recipient_address).toBe(requirements.payTo);
  });
});
