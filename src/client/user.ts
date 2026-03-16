import {
  PaymentGuaranteeRequestClaims,
  PaymentGuaranteeRequestClaimsV2,
  PaymentSignature,
  SigningScheme,
  TabPaymentStatus,
  UserInfo,
} from '../models';
import { tabStatusFromRpc } from './shared';
import type { TxReceiptWaitOptions } from '../contract';
import { parseU256 } from '../utils';
import type { Client } from './index';

export class UserClient {
  constructor(private client: Client) {}

  get guaranteeDomain(): string {
    return this.client.guaranteeDomain;
  }

  async approveErc20(
    token: string,
    amount: number | bigint | string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    return this.client.gateway.approveErc20(token, amount, waitOptions);
  }

  async deposit(
    amount: number | bigint | string,
    erc20Token?: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    return this.client.gateway.deposit(amount, erc20Token, waitOptions);
  }

  async getUser(): Promise<UserInfo[]> {
    const assets = await this.client.gateway.getUserAssets();
    return assets.map(
      (a) =>
        ({
          asset: a.asset,
          collateral: parseU256(a.collateral),
          withdrawalRequestAmount: parseU256(a.withdrawalRequestAmount),
          withdrawalRequestTimestamp: Number(a.withdrawalRequestTimestamp),
        }) satisfies UserInfo
    );
  }

  async getTabPaymentStatus(tabId: number | bigint): Promise<TabPaymentStatus> {
    const status = await this.client.gateway.getPaymentStatus(tabId);
    return tabStatusFromRpc(status);
  }

  async signPayment(
    claims: PaymentGuaranteeRequestClaims | PaymentGuaranteeRequestClaimsV2,
    scheme: SigningScheme = SigningScheme.EIP712
  ): Promise<PaymentSignature> {
    return this.client.signer.signRequest(this.client.params, claims, scheme);
  }

  async payTab(
    tabId: number | bigint,
    reqId: number | bigint,
    amount: number | bigint | string,
    recipientAddress: string,
    erc20Token?: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    if (erc20Token) {
      return this.client.gateway.payTabErc20(
        tabId,
        amount,
        erc20Token,
        recipientAddress,
        waitOptions
      );
    }
    return this.client.gateway.payTabEth(tabId, reqId, amount, recipientAddress, waitOptions);
  }

  async requestWithdrawal(
    amount: number | bigint | string,
    erc20Token?: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    return this.client.gateway.requestWithdrawal(amount, erc20Token, waitOptions);
  }

  async cancelWithdrawal(erc20Token?: string, waitOptions?: TxReceiptWaitOptions) {
    return this.client.gateway.cancelWithdrawal(erc20Token, waitOptions);
  }

  async finalizeWithdrawal(erc20Token?: string, waitOptions?: TxReceiptWaitOptions) {
    return this.client.gateway.finalizeWithdrawal(erc20Token, waitOptions);
  }
}
