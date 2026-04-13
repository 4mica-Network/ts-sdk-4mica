import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type Chain,
  getContract,
  erc20Abi,
  Account,
  GetContractReturnType,
  HttpTransport,
  parseGwei,
} from 'viem';
import { core4micaAbi } from './abi/core4mica';
import { getChain } from './chain';
import { ContractError } from './errors';
import { parseU256, hexFromBytes } from './utils';

/**
 * Extract a human-readable message from a viem contract error, falling back
 * to the raw message if no structured reason is available.
 */
function wrapViemError(error: unknown, context: string): ContractError {
  if (error instanceof ContractError) return error;
  if (error instanceof Error) {
    const e = error as unknown as Record<string, unknown>;
    const reason =
      (e['cause'] as Record<string, unknown> | undefined)?.['reason'] ??
      e['shortMessage'] ??
      error.message;
    return new ContractError(`${context}: ${reason}`);
  }
  return new ContractError(`${context}: ${String(error)}`);
}

type TPublicClient = ReturnType<typeof createPublicClient>;
type TWalletClient = ReturnType<typeof createWalletClient<HttpTransport, Chain, Account>>;

type CoreContract = GetContractReturnType<
  typeof core4micaAbi,
  {
    public: ReturnType<typeof createPublicClient>;
    wallet: TWalletClient;
  }
>;

type Erc20Contract = GetContractReturnType<
  typeof erc20Abi,
  {
    public: ReturnType<typeof createPublicClient>;
    wallet: TWalletClient;
  }
>;

export type TxReceiptWaitOptions = {
  timeout?: number;
  pollingInterval?: number;
  gas?: bigint;
};

const DEFAULT_REMUNERATE_GAS_LIMIT = 8_000_000n;
const DEFAULT_PAY_TAB_ERC20_GAS_LIMIT = 300_000n;
const DEFAULT_MAX_FEE_PER_GAS = parseGwei('0.1');
const DEFAULT_MAX_PRIORITY_FEE_PER_GAS = parseGwei('0.1');

export class ContractGateway {
  readonly publicClient: TPublicClient;
  readonly walletClient: TWalletClient;
  readonly contract: CoreContract;
  private erc20Cache = new Map<string, Erc20Contract>();
  private txQueue: Promise<void> = Promise.resolve();

  private constructor(
    publicClient: TPublicClient,
    walletClient: TWalletClient,
    contract: CoreContract
  ) {
    this.publicClient = publicClient;
    this.walletClient = walletClient;
    this.contract = contract;
  }

  static async create(rpcUrl: string, signer: Account, contractAddress: Hex, chainId: number) {
    const chain = getChain(chainId, rpcUrl);

    const publicClient = createPublicClient({
      transport: http(rpcUrl),
    });

    const rpcChainId = await publicClient.getChainId();
    if (rpcChainId !== Number(chainId)) {
      throw new ContractError(`Connected to chain ${rpcChainId}, expected ${chainId}`);
    }

    const walletClient = createWalletClient({
      transport: http(rpcUrl),
      account: signer,
      chain,
    });

    const contract = getContract({
      address: contractAddress,
      abi: core4micaAbi,
      client: {
        public: publicClient,
        wallet: walletClient,
      },
    });

    return new ContractGateway(publicClient, walletClient, contract);
  }

  private erc20(token: string): Erc20Contract {
    if (!this.erc20Cache.has(token)) {
      this.erc20Cache.set(
        token,
        getContract({
          address: token as Hex,
          abi: erc20Abi,
          client: { public: this.publicClient, wallet: this.walletClient },
        })
      );
    }
    return this.erc20Cache.get(token)!;
  }

  private enqueueTx<T>(fn: () => Promise<T>): Promise<T> {
    // Serialize transaction submissions to avoid nonce collisions.
    const run = this.txQueue.then(fn, fn);
    this.txQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private defaultFeeParams() {
    return {
      maxFeePerGas: DEFAULT_MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: DEFAULT_MAX_PRIORITY_FEE_PER_GAS,
    } as const;
  }

  private splitWaitOptions(waitOptions?: TxReceiptWaitOptions): {
    receipt: { timeout?: number; pollingInterval?: number };
    gas?: bigint;
  } {
    if (!waitOptions) {
      return { receipt: {} };
    }
    const { gas, timeout, pollingInterval } = waitOptions;
    return {
      gas,
      receipt: {
        ...(timeout !== undefined ? { timeout } : {}),
        ...(pollingInterval !== undefined ? { pollingInterval } : {}),
      },
    };
  }

  async getGuaranteeDomain(): Promise<string> {
    return this.contract.read.guaranteeDomainSeparator();
  }

  async getGuaranteeVersionConfig(
    version: number
  ): Promise<{ domainSeparator: string; decoder: string; enabled: boolean }> {
    const [, domainSeparator, decoder, enabled] =
      await this.contract.read.getGuaranteeVersionConfig([BigInt(version)]);
    return { domainSeparator: domainSeparator as string, decoder: decoder as string, enabled };
  }

  async approveErc20(
    token: string,
    amount: number | bigint | string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    const { receipt } = this.splitWaitOptions(waitOptions);
    const erc20 = this.erc20(token);
    const spender = this.contract.address;
    const targetAllowance = parseU256(amount);

    const sendApprove = async (value: bigint) => {
      const hash = await this.enqueueTx(() =>
        erc20.write.approve([spender, value], this.defaultFeeParams())
      );
      const txReceipt = await this.publicClient.waitForTransactionReceipt({ hash, ...receipt });
      if (txReceipt.status !== 'success') {
        throw new ContractError(`approve transaction reverted: ${hash}`);
      }
      return txReceipt;
    };

    let txReceipt;
    try {
      txReceipt = await sendApprove(targetAllowance);
    } catch (error) {
      // Some ERC20s (e.g. USDT) require resetting allowance to zero before
      // setting a new non-zero value.
      if (targetAllowance === 0n) {
        throw wrapViemError(error, 'ERC20 approve failed');
      }
      try {
        await sendApprove(0n);
        txReceipt = await sendApprove(targetAllowance);
      } catch (retryError) {
        throw wrapViemError(retryError, 'ERC20 approve failed after allowance reset');
      }
    }

    // Verify the allowance was actually set on-chain. The catch path above can
    // leave allowance at 0 if the re-approve transaction fails silently.
    const account = this.walletClient.account;
    if (account) {
      const actual = await (erc20 as Erc20Contract).read.allowance([account.address, spender]);
      if ((actual as bigint) < targetAllowance) {
        throw new ContractError(
          `ERC20 allowance verification failed: on-chain allowance is ${actual} but expected ${targetAllowance}. ` +
            `Try calling approveErc20 again.`
        );
      }
    }

    return txReceipt;
  }

  async deposit(
    amount: number | bigint | string,
    erc20Token?: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    const { receipt } = this.splitWaitOptions(waitOptions);
    const parsedAmount = parseU256(amount);
    let hash: Hex;

    if (erc20Token) {
      // Pre-check allowance to surface a clear error before hitting the contract.
      const account = this.walletClient.account;
      if (account) {
        const erc20 = this.erc20(erc20Token);
        const allowance = await (erc20 as Erc20Contract).read.allowance([
          account.address,
          this.contract.address,
        ]);
        if ((allowance as bigint) < parsedAmount) {
          throw new ContractError(
            `Insufficient ERC20 allowance: ${allowance} approved but ${parsedAmount} required. ` +
              `Call approveErc20("${erc20Token}", ${parsedAmount}) before depositing.`
          );
        }
      }

      try {
        hash = await this.enqueueTx(() =>
          this.contract.write.depositStablecoin(
            [erc20Token as Hex, parsedAmount],
            this.defaultFeeParams()
          )
        );
      } catch (error) {
        throw wrapViemError(error, 'depositStablecoin failed');
      }
    } else {
      try {
        hash = await this.enqueueTx(() =>
          this.contract.write.deposit({ value: parsedAmount, ...this.defaultFeeParams() })
        );
      } catch (error) {
        throw wrapViemError(error, 'deposit failed');
      }
    }

    return this.publicClient.waitForTransactionReceipt({ hash, ...receipt });
  }

  async getUserAssets() {
    const account = this.walletClient.account;
    if (!account) {
      throw new ContractError('wallet client has no account configured');
    }
    const addr = account.address;
    const result = await this.contract.read.getUserAllAssets([addr]);
    return result.map((a) => ({
      asset: a.asset,
      collateral: a.collateral,
      withdrawalRequestTimestamp: a.withdrawalRequestTimestamp,
      withdrawalRequestAmount: a.withdrawalRequestAmount,
    }));
  }

  async getPaymentStatus(tabId: number | bigint): Promise<{
    paid: bigint;
    remunerated: boolean;
    asset: Hex;
  }> {
    const [paid, remunerated, asset] = await this.contract.read.getPaymentStatus([
      parseU256(tabId),
    ]);

    return {
      paid,
      remunerated,
      asset,
    };
  }

  async payTabEth(
    tabId: number | bigint,
    reqId: number | bigint,
    amount: number | bigint | string,
    recipient: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    const { receipt } = this.splitWaitOptions(waitOptions);
    const data = new TextEncoder().encode(
      `tab_id:${tabId.toString(16)};req_id:${reqId.toString(16)}`
    );
    const hash = await this.enqueueTx(() =>
      this.walletClient.sendTransaction({
        to: recipient as Hex,
        value: parseU256(amount),
        data: hexFromBytes(data),
        ...this.defaultFeeParams(),
      })
    );
    return this.publicClient.waitForTransactionReceipt({ hash, ...receipt });
  }

  async payTabErc20(
    tabId: number | bigint,
    amount: number | bigint | string,
    erc20Token: string,
    recipient: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    const { gas, receipt } = this.splitWaitOptions(waitOptions);
    const hash = await this.enqueueTx(() =>
      this.contract.write.payTabInERC20Token(
        [parseU256(tabId), erc20Token as Hex, parseU256(amount), recipient as Hex],
        {
          gas: gas ?? DEFAULT_PAY_TAB_ERC20_GAS_LIMIT,
          ...this.defaultFeeParams(),
        }
      )
    );

    return this.publicClient.waitForTransactionReceipt({ hash, ...receipt });
  }

  async requestWithdrawal(
    amount: number | bigint | string,
    erc20Token?: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    const { receipt } = this.splitWaitOptions(waitOptions);
    const value = parseU256(amount);

    let hash: Hex;
    if (erc20Token) {
      hash = await this.enqueueTx(() =>
        this.contract.write.requestWithdrawal([erc20Token as Hex, value], this.defaultFeeParams())
      );
    } else {
      hash = await this.enqueueTx(() =>
        this.contract.write.requestWithdrawal([value], this.defaultFeeParams())
      );
    }

    return this.publicClient.waitForTransactionReceipt({ hash, ...receipt });
  }

  async cancelWithdrawal(erc20Token?: string, waitOptions?: TxReceiptWaitOptions) {
    const { receipt } = this.splitWaitOptions(waitOptions);
    let hash: Hex;
    if (erc20Token) {
      hash = await this.enqueueTx(() =>
        this.contract.write.cancelWithdrawal([erc20Token as Hex], this.defaultFeeParams())
      );
    } else {
      hash = await this.enqueueTx(() =>
        this.contract.write.cancelWithdrawal(this.defaultFeeParams())
      );
    }

    return this.publicClient.waitForTransactionReceipt({ hash, ...receipt });
  }

  async finalizeWithdrawal(erc20Token?: string, waitOptions?: TxReceiptWaitOptions) {
    const { receipt } = this.splitWaitOptions(waitOptions);
    let hash: Hex;
    if (erc20Token) {
      hash = await this.enqueueTx(() =>
        this.contract.write.finalizeWithdrawal([erc20Token as Hex], this.defaultFeeParams())
      );
    } else {
      hash = await this.enqueueTx(() =>
        this.contract.write.finalizeWithdrawal(this.defaultFeeParams())
      );
    }

    return this.publicClient.waitForTransactionReceipt({ hash, ...receipt });
  }

  async remunerate(
    claimsBlob: Uint8Array,
    signatureWords: Uint8Array[],
    waitOptions?: TxReceiptWaitOptions
  ) {
    const { gas, receipt } = this.splitWaitOptions(waitOptions);
    const sigStruct = {
      x_c0_a: hexFromBytes(signatureWords[0]),
      x_c0_b: hexFromBytes(signatureWords[1]),
      x_c1_a: hexFromBytes(signatureWords[2]),
      x_c1_b: hexFromBytes(signatureWords[3]),
      y_c0_a: hexFromBytes(signatureWords[4]),
      y_c0_b: hexFromBytes(signatureWords[5]),
      y_c1_a: hexFromBytes(signatureWords[6]),
      y_c1_b: hexFromBytes(signatureWords[7]),
    };
    const hash = await this.enqueueTx(() =>
      this.contract.write.remunerate([hexFromBytes(claimsBlob), sigStruct], {
        gas: gas ?? DEFAULT_REMUNERATE_GAS_LIMIT,
        ...this.defaultFeeParams(),
      })
    );
    return this.publicClient.waitForTransactionReceipt({ hash, ...receipt });
  }
}
