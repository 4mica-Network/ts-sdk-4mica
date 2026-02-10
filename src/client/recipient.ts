import { signatureToWordsAsync } from '../bls';
import { buildPaymentPayload } from '../payment';
import { decodeGuaranteeClaims } from '../guarantee';
import { VerificationError } from '../errors';
import {
  AssetBalanceInfo,
  BLSCert,
  CollateralEventInfo,
  GuaranteeInfo,
  PaymentGuaranteeClaims,
  PaymentGuaranteeRequestClaims,
  PendingRemunerationInfo,
  RecipientPaymentInfo,
  SigningScheme,
  TabInfo,
  TabPaymentStatus,
} from '../models';
import { DEBUG_CERTS } from '../debug';
import { normalizeAddress, parseU256 } from '../utils';
import type { TxReceiptWaitOptions } from '../contract';
import type { Client } from './index';
import { isNumericLike, tabStatusFromRpc } from './shared';

export class RecipientClient {
  constructor(private client: Client) {}

  private get recipientAddress(): string {
    return normalizeAddress(this.client.signer.signer.address);
  }

  get guaranteeDomain(): string {
    return this.client.guaranteeDomain;
  }

  async createTab(
    userAddress: string,
    recipientAddress: string,
    erc20Token: string | undefined | null,
    ttl?: number | null
  ): Promise<bigint> {
    const body = {
      user_address: normalizeAddress(userAddress),
      recipient_address: normalizeAddress(recipientAddress),
      erc20_token: erc20Token ? normalizeAddress(erc20Token) : null,
      ttl: ttl ?? null,
    };
    const result = await this.client.rpc.createPaymentTab(body);
    const record = result as Record<string, unknown>;
    const tabIdRaw = record.id ?? record.tabId ?? record.tab_id;
    const tabId = isNumericLike(tabIdRaw) ? tabIdRaw : 0;
    return parseU256(tabId);
  }

  async getTabPaymentStatus(tabId: number | bigint): Promise<TabPaymentStatus> {
    const status = await this.client.gateway.getPaymentStatus(tabId);
    return tabStatusFromRpc(status);
  }

  async issuePaymentGuarantee(
    claims: PaymentGuaranteeRequestClaims,
    signature: string,
    scheme: SigningScheme
  ): Promise<BLSCert> {
    const payload = buildPaymentPayload(claims, signature, scheme);
    const cert = await this.client.rpc.issueGuarantee(payload);
    const record = cert as Record<string, unknown>;
    const certClaims = typeof record.claims === 'string' ? record.claims : '';
    const signatureOut = typeof record.signature === 'string' ? record.signature : '';
    return { claims: certClaims, signature: signatureOut };
  }

  verifyPaymentGuarantee(cert: BLSCert): PaymentGuaranteeClaims {
    const claims = decodeGuaranteeClaims(cert.claims);
    const domainHex = this.guaranteeDomain.startsWith('0x')
      ? this.guaranteeDomain.slice(2)
      : Buffer.from(this.guaranteeDomain).toString('hex');
    const claimsHex = Buffer.from(claims.domain).toString('hex');
    if (claimsHex !== domainHex) {
      throw new VerificationError('guarantee domain mismatch');
    }
    return claims;
  }

  async remunerate(cert: BLSCert, waitOptions?: TxReceiptWaitOptions) {
    this.verifyPaymentGuarantee(cert);
    const describeValue = (value: unknown): string => {
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      if (Array.isArray(value)) return `array(len=${value.length})`;
      if (typeof value === 'object') {
        const keys = Object.keys(value as Record<string, unknown>);
        return `object(keys=${keys.slice(0, 6).join(',')}${keys.length > 6 ? ',...' : ''})`;
      }
      return typeof value;
    };
    if (DEBUG_CERTS) {
      const preview = typeof cert.signature === 'string' ? cert.signature.slice(0, 12) : '';
      console.log(`  debug remunerate: signature=${describeValue(cert.signature)} ${preview}`);
    }
    if (typeof cert.claims !== 'string') {
      throw new VerificationError(
        `certificate.claims must be a hex string, got ${describeValue(cert.claims)}`
      );
    }
    if (typeof cert.signature !== 'string') {
      throw new VerificationError(
        `certificate.signature must be a hex string, got ${describeValue(cert.signature)}`
      );
    }
    const sigWords = await signatureToWordsAsync(cert.signature);
    const claimsBytes = Buffer.from(cert.claims.replace(/^0x/, ''), 'hex');
    if (waitOptions) {
      return this.client.gateway.remunerate(claimsBytes, sigWords, waitOptions);
    }
    return this.client.gateway.remunerate(claimsBytes, sigWords);
  }

  async listSettledTabs(): Promise<TabInfo[]> {
    const tabs = await this.client.rpc.listSettledTabs(this.recipientAddress);
    return tabs.map((t) => TabInfo.fromRpc(t));
  }

  async listPendingRemunerations(): Promise<PendingRemunerationInfo[]> {
    const items = await this.client.rpc.listPendingRemunerations(this.recipientAddress);
    return items.map((item) => PendingRemunerationInfo.fromRpc(item));
  }

  async getTab(tabId: number | bigint): Promise<TabInfo | null> {
    const result = await this.client.rpc.getTab(tabId);
    return result ? TabInfo.fromRpc(result) : null;
  }

  async listRecipientTabs(settlementStatuses?: string[]): Promise<TabInfo[]> {
    const tabs = await this.client.rpc.listRecipientTabs(this.recipientAddress, settlementStatuses);
    return tabs.map((t) => TabInfo.fromRpc(t));
  }

  async getTabGuarantees(tabId: number | bigint): Promise<GuaranteeInfo[]> {
    const guarantees = await this.client.rpc.getTabGuarantees(tabId);
    return guarantees.map((g) => GuaranteeInfo.fromRpc(g));
  }

  async getLatestGuarantee(tabId: number | bigint): Promise<GuaranteeInfo | null> {
    const result = await this.client.rpc.getLatestGuarantee(tabId);
    return result ? GuaranteeInfo.fromRpc(result) : null;
  }

  async getGuarantee(
    tabId: number | bigint,
    reqId: number | bigint
  ): Promise<GuaranteeInfo | null> {
    const result = await this.client.rpc.getGuarantee(tabId, reqId);
    return result ? GuaranteeInfo.fromRpc(result) : null;
  }

  async listRecipientPayments(): Promise<RecipientPaymentInfo[]> {
    const payments = await this.client.rpc.listRecipientPayments(this.recipientAddress);
    return payments.map((p) => RecipientPaymentInfo.fromRpc(p));
  }

  async getCollateralEventsForTab(tabId: number | bigint): Promise<CollateralEventInfo[]> {
    const events = await this.client.rpc.getCollateralEventsForTab(tabId);
    return events.map((ev) => CollateralEventInfo.fromRpc(ev));
  }

  async getUserAssetBalance(
    userAddress: string,
    assetAddress: string
  ): Promise<AssetBalanceInfo | null> {
    const balance = await this.client.rpc.getUserAssetBalance(userAddress, assetAddress);
    return balance ? AssetBalanceInfo.fromRpc(balance) : null;
  }
}
