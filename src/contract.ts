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
} from 'viem';
import { core4micaAbi } from './abi/core4mica';
import { getChain } from './chain';
import { parseU256, hexFromBytes } from './utils';

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
};

export class ContractGateway {
  readonly publicClient: TPublicClient;
  readonly walletClient: TWalletClient;
  readonly contract: CoreContract;
  private erc20Cache = new Map<string, Erc20Contract>();

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
      throw new Error(`Connected to chain ${rpcChainId}, expected ${chainId}`);
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

  async getGuaranteeDomain(): Promise<string> {
    return this.contract.read.guaranteeDomainSeparator();
  }

  async approveErc20(
    token: string,
    amount: number | bigint | string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    const erc20 = this.erc20(token);
    // spender address logic
    const spender = this.contract.address;
    const hash = await erc20.write.approve([spender, parseU256(amount)]);
    return this.publicClient.waitForTransactionReceipt({ hash, ...(waitOptions ?? {}) });
  }

  async deposit(
    amount: number | bigint | string,
    erc20Token?: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    let hash: Hex;

    if (erc20Token) {
      hash = await this.contract.write.depositStablecoin([erc20Token as Hex, parseU256(amount)]);
    } else {
      hash = await this.contract.write.deposit({ value: parseU256(amount) });
    }

    return this.publicClient.waitForTransactionReceipt({ hash, ...(waitOptions ?? {}) });
  }

  async getUserAssets() {
    const addr = this.walletClient.account!.address;
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
    const data = new TextEncoder().encode(
      `tab_id:${tabId.toString(16)};req_id:${reqId.toString(16)}`
    );
    const hash = await this.walletClient.sendTransaction({
      to: recipient as Hex,
      value: parseU256(amount),
      data: hexFromBytes(data),
    });
    return this.publicClient.waitForTransactionReceipt({ hash, ...(waitOptions ?? {}) });
  }

  async payTabErc20(
    tabId: number | bigint,
    amount: number | bigint | string,
    erc20Token: string,
    recipient: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    const hash = await this.contract.write.payTabInERC20Token([
      parseU256(tabId),
      erc20Token as Hex,
      parseU256(amount),
      recipient as Hex,
    ]);

    return this.publicClient.waitForTransactionReceipt({ hash, ...(waitOptions ?? {}) });
  }

  async requestWithdrawal(
    amount: number | bigint | string,
    erc20Token?: string,
    waitOptions?: TxReceiptWaitOptions
  ) {
    const value = parseU256(amount);

    let hash: Hex;
    if (erc20Token) {
      hash = await this.contract.write.requestWithdrawal([erc20Token as Hex, value]);
    } else {
      hash = await this.contract.write.requestWithdrawal([value]);
    }

    return this.publicClient.waitForTransactionReceipt({ hash, ...(waitOptions ?? {}) });
  }

  async cancelWithdrawal(erc20Token?: string, waitOptions?: TxReceiptWaitOptions) {
    let hash: Hex;
    if (erc20Token) {
      hash = await this.contract.write.cancelWithdrawal([erc20Token as Hex]);
    } else {
      hash = await this.contract.write.cancelWithdrawal();
    }

    return this.publicClient.waitForTransactionReceipt({ hash, ...(waitOptions ?? {}) });
  }

  async finalizeWithdrawal(erc20Token?: string, waitOptions?: TxReceiptWaitOptions) {
    let hash: Hex;
    if (erc20Token) {
      hash = await this.contract.write.finalizeWithdrawal([erc20Token as Hex]);
    } else {
      hash = await this.contract.write.finalizeWithdrawal();
    }

    return this.publicClient.waitForTransactionReceipt({ hash, ...(waitOptions ?? {}) });
  }

  async remunerate(
    claimsBlob: Uint8Array,
    signatureWords: Uint8Array[],
    waitOptions?: TxReceiptWaitOptions
  ) {
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
    const hash = await this.contract.write.remunerate([hexFromBytes(claimsBlob), sigStruct]);
    return this.publicClient.waitForTransactionReceipt({ hash, ...(waitOptions ?? {}) });
  }
}
