import { PaymentGuaranteeRequestClaims, PaymentSignature, SigningScheme } from '../models';
import {
  PaymentRequirementsV1,
  TabResponse,
  X402SignedPayment,
  X402SettledPayment,
  X402PaymentPayload,
  PaymentRequirementsV2,
  X402PaymentRequired,
  X402PaymentEnvelopeV1,
  X402PaymentEnvelopeV2,
  X402ResourceInfo,
} from './models';
import { normalizeAddress, parseU256 } from '../utils';
import type { FetchFn } from '../rpc';
import { X402Error } from '../errors';

export * from './models';

export interface FlowSigner {
  signPayment(
    claims: PaymentGuaranteeRequestClaims,
    scheme: SigningScheme
  ): Promise<PaymentSignature>;
}

export class X402Flow {
  private fetchFn: FetchFn;

  constructor(
    private signer: FlowSigner,
    fetchFn: FetchFn = fetch
  ) {
    this.fetchFn = fetchFn;
  }

  static fromClient(client: { user: FlowSigner }): X402Flow {
    return new X402Flow(client.user);
  }

  async signPayment(
    paymentRequirements: PaymentRequirementsV1,
    userAddress: string
  ): Promise<X402SignedPayment> {
    X402Flow.validateScheme(paymentRequirements.scheme);
    const tab = await this.requestTab(1, paymentRequirements, userAddress);

    const claims = this.buildClaims(paymentRequirements, tab, userAddress);
    const signature = await this.signer.signPayment(claims, SigningScheme.EIP712);
    const paymentPayload = X402Flow.buildPaymentPayload(claims, signature);

    const envelope: X402PaymentEnvelopeV1 = {
      x402Version: 1,
      scheme: paymentRequirements.scheme,
      network: paymentRequirements.network,
      payload: paymentPayload,
    };
    const header = Buffer.from(JSON.stringify(envelope)).toString('base64');
    return { header, payload: paymentPayload, signature };
  }

  async signPaymentV2(
    paymentRequired: X402PaymentRequired,
    accepted: PaymentRequirementsV2,
    userAddress: string
  ): Promise<X402SignedPayment> {
    X402Flow.validateScheme(accepted.scheme);
    const tab = await this.requestTab(2, accepted, userAddress, paymentRequired.resource);

    const claims = this.buildClaims(accepted, tab, userAddress);
    const signature = await this.signer.signPayment(claims, SigningScheme.EIP712);
    const paymentPayload = X402Flow.buildPaymentPayload(claims, signature);

    const envelope: X402PaymentEnvelopeV2 = {
      x402Version: 2,
      accepted: accepted,
      payload: paymentPayload,
      resource: paymentRequired.resource,
    };
    const header = Buffer.from(JSON.stringify(envelope)).toString('base64');
    return { header, payload: paymentPayload, signature };
  }

  async settlePayment(
    payment: X402SignedPayment,
    paymentRequirements: PaymentRequirementsV1,
    facilitatorUrl: string
  ): Promise<X402SettledPayment> {
    const url = `${facilitatorUrl.replace(/\/$/, '')}/settle`;
    const paymentPayload = X402Flow.decodePaymentHeader(payment.header);
    const x402Version =
      typeof paymentPayload === 'object' && paymentPayload && 'x402Version' in paymentPayload
        ? (paymentPayload as { x402Version?: number }).x402Version
        : undefined;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(x402Version ? { x402Version } : {}),
        paymentHeader: payment.header,
        paymentPayload,
        paymentRequirements,
      }),
    });
    const data = await response.text();
    if (!response.ok) {
      throw new X402Error(`settlement failed with status ${response.status}: ${data}`);
    }
    const settlement = data ? JSON.parse(data) : {};
    return { payment, settlement };
  }

  protected async requestTab(
    x402Version: number,
    paymentRequirements: PaymentRequirementsV1 | PaymentRequirementsV2,
    userAddress: string,
    resource?: X402ResourceInfo
  ): Promise<TabResponse> {
    const tabEndpoint = paymentRequirements.extra?.tabEndpoint;
    if (!tabEndpoint || typeof tabEndpoint !== 'string') {
      throw new X402Error('missing tabEndpoint in paymentRequirements.extra');
    }
    const resp = await this.fetchFn(tabEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        x402Version,
        userAddress,
        paymentRequirements,
        resource,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new X402Error(`tab resolution failed: ${resp.status} ${text}`);
    }
    const body = await resp.json();
    return {
      tabId: body.tabId ?? body.tab_id,
      userAddress: body.userAddress ?? body.user_address,
      nextReqId: body.nextReqId ?? body.next_req_id ?? body.reqId ?? body.req_id,
    };
  }

  protected buildClaims(
    requirements: PaymentRequirementsV1 | PaymentRequirementsV2,
    tab: TabResponse,
    userAddress: string
  ): PaymentGuaranteeRequestClaims {
    const tabId = parseU256(tab.tabId);
    const reqId =
      tab.nextReqId !== undefined && tab.nextReqId !== null ? parseU256(tab.nextReqId) : 0n;
    const amount = parseU256(
      'maxAmountRequired' in requirements ? requirements.maxAmountRequired : requirements.amount
    );
    if (tab.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
      throw new X402Error(
        `user mismatch in paymentRequirements: found ${tab.userAddress}, expected ${userAddress}`
      );
    }
    const timestamp = Math.floor(Date.now() / 1000);
    return PaymentGuaranteeRequestClaims.new(
      userAddress,
      normalizeAddress(requirements.payTo),
      tabId,
      amount,
      timestamp,
      requirements.asset,
      reqId
    );
  }

  private static validateScheme(scheme: string): void {
    if (!scheme.toLowerCase().includes('4mica')) {
      throw new X402Error(`invalid scheme: ${scheme}`);
    }
  }

  private static decodePaymentHeader(
    header: string
  ): X402PaymentEnvelopeV1 | X402PaymentEnvelopeV2 {
    if (!header || typeof header !== 'string') {
      throw new X402Error('missing payment header');
    }
    try {
      const decoded = Buffer.from(header, 'base64').toString('utf8');
      return JSON.parse(decoded) as X402PaymentEnvelopeV1 | X402PaymentEnvelopeV2;
    } catch (err) {
      throw new X402Error(`invalid payment header: ${String(err)}`);
    }
  }

  private static buildPaymentPayload(
    claims: PaymentGuaranteeRequestClaims,
    signature: PaymentSignature
  ): X402PaymentPayload {
    return {
      claims: {
        version: 'v1',
        user_address: claims.userAddress,
        recipient_address: claims.recipientAddress,
        tab_id: `0x${claims.tabId.toString(16)}`,
        req_id: `0x${claims.reqId.toString(16)}`,
        amount: `0x${claims.amount.toString(16)}`,
        asset_address: claims.assetAddress,
        timestamp: claims.timestamp,
      },
      signature: signature.signature,
      scheme: signature.scheme,
    };
  }
}
