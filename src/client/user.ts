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

/** Payer-side operations: collateral management, payment signing, withdrawals. */
export class UserClient {
  constructor(private client: Client) {}

  /** 32-byte V1 guarantee domain separator (hex-prefixed). */
  get guaranteeDomain(): string {
    return this.client.guaranteeDomain;
  }

  /**
   * Approve the Core4Mica contract to spend an ERC20 token on your behalf.
   * Call this before {@link deposit} for ERC20 deposits.
   *
   * @param token - ERC20 token contract address.
   * @param amount - Amount to approve (in token base units).
   * @param waitOptions - Optional timeout/polling overrides for receipt polling.
   */
  async approveErc20(
    token: string,
    amount: number | bigint | string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    return this.client.gateway.approveErc20(token, amount, waitOptions);
  }

  /**
   * Deposit collateral into the Core4Mica contract.
   *
   * @param amount - Amount to deposit (in wei for ETH, base units for ERC20).
   * @param erc20Token - ERC20 token address. Omit to deposit ETH.
   *   Call {@link approveErc20} first when depositing ERC20.
   * @param waitOptions - Optional timeout/polling overrides.
   */
  async deposit(
    amount: number | bigint | string,
    erc20Token?: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    return this.client.gateway.deposit(amount, erc20Token, waitOptions);
  }

  /**
   * Fetch all asset positions for the current signer.
   *
   * @returns Array of positions — one entry per deposited asset, including
   *   locked collateral and any pending withdrawal.
   * @throws {@link ContractError} if the contract call fails.
   */
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

  /**
   * Query the on-chain payment status of a tab.
   *
   * @param tabId - Tab identifier.
   * @returns `{ paid, remunerated, asset }` — cumulative amount paid, whether
   *   it has been remunerated on-chain, and the asset address.
   */
  async getTabPaymentStatus(tabId: number | bigint): Promise<TabPaymentStatus> {
    const status = await this.client.gateway.getPaymentStatus(tabId);
    return tabStatusFromRpc(status);
  }

  /**
   * Sign a payment guarantee request with the configured signer.
   *
   * @param claims - V1 or V2 payment claims. Build V1 with
   *   {@link PaymentGuaranteeRequestClaims.new}; build V2 with
   *   {@link PaymentGuaranteeRequestClaimsV2} (requires validation policy fields).
   * @param scheme - Signing scheme. Defaults to `EIP712`.
   *   Use `EIP191` for wallets that do not support typed data.
   * @returns 65-byte ECDSA signature plus the scheme used.
   * @throws {@link SigningError} if the signer address does not match `claims.userAddress`
   *   or the signing scheme is not supported by the account.
   */
  async signPayment(
    claims: PaymentGuaranteeRequestClaims | PaymentGuaranteeRequestClaimsV2,
    scheme: SigningScheme = SigningScheme.EIP712
  ): Promise<PaymentSignature> {
    return this.client.signer.signRequest(this.client.params, claims, scheme);
  }

  /**
   * Pay a tab by transferring collateral to the recipient.
   *
   * Routes to `payTabErc20` when `erc20Token` is provided, otherwise `payTabEth`.
   *
   * @param tabId - Tab identifier.
   * @param reqId - Request ID from the latest guarantee (used for ETH payment memo).
   * @param amount - Amount to pay (in token base units / wei).
   * @param recipientAddress - Address of the recipient.
   * @param erc20Token - ERC20 token address. Omit to pay in ETH.
   * @param waitOptions - Optional timeout/polling overrides.
   */
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

  /**
   * Initiate a collateral withdrawal request. The withdrawal is subject to an
   * on-chain timelock before it can be finalised.
   *
   * @param amount - Amount to withdraw (base units / wei).
   * @param erc20Token - ERC20 token address. Omit to withdraw ETH.
   * @param waitOptions - Optional timeout/polling overrides.
   */
  async requestWithdrawal(
    amount: number | bigint | string,
    erc20Token?: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    return this.client.gateway.requestWithdrawal(amount, erc20Token, waitOptions);
  }

  /**
   * Cancel a pending withdrawal request before the timelock expires.
   *
   * @param erc20Token - ERC20 token address. Omit to cancel an ETH withdrawal.
   * @param waitOptions - Optional timeout/polling overrides.
   */
  async cancelWithdrawal(erc20Token?: string, waitOptions?: TxReceiptWaitOptions) {
    return this.client.gateway.cancelWithdrawal(erc20Token, waitOptions);
  }

  /**
   * Finalise a withdrawal after the timelock has elapsed.
   *
   * @param erc20Token - ERC20 token address. Omit to finalise an ETH withdrawal.
   * @param waitOptions - Optional timeout/polling overrides.
   */
  async finalizeWithdrawal(erc20Token?: string, waitOptions?: TxReceiptWaitOptions) {
    return this.client.gateway.finalizeWithdrawal(erc20Token, waitOptions);
  }
}
