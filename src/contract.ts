import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getBytes,
  hexlify,
  toBeHex,
} from "ethers";
import core4micaAbi from "./abi/core4mica.json";
import erc20Abi from "./abi/erc20.json";
import { ContractError } from "./errors";
import { parseU256 } from "./utils";

type ContractFactory = (address: string, abi: any, signer: Wallet) => Contract;

export class ContractGateway {
  readonly provider: JsonRpcProvider;
  readonly wallet: Wallet;
  readonly contract: Contract;
  private erc20Cache: Map<string, Contract> = new Map();

  constructor(
    ethRpcUrl: string,
    privateKey: string,
    contractAddress: string,
    chainId: number | bigint,
    provider?: JsonRpcProvider,
    contractFactory?: ContractFactory
  ) {
    this.provider =
      provider ?? new JsonRpcProvider(ethRpcUrl, { chainId: Number(chainId) });
    this.wallet = new Wallet(privateKey, this.provider);
    const factory: ContractFactory =
      contractFactory ??
      ((addr, abi, signer) => new Contract(addr, abi.abi ?? abi, signer));
    this.contract = factory(contractAddress, core4micaAbi, this.wallet);
  }

  async getChainId(): Promise<number> {
    const network = await this.provider.getNetwork();
    return Number(network.chainId);
  }

  private erc20(address: string): Contract {
    const checksum = address;
    if (!this.erc20Cache.has(checksum)) {
      this.erc20Cache.set(
        checksum,
        new Contract(checksum, erc20Abi.abi ?? erc20Abi, this.wallet)
      );
    }
    return this.erc20Cache.get(checksum)!;
  }

  private async send<T>(promise: Promise<any>): Promise<T> {
    try {
      const tx = await promise;
      if (tx.wait) {
        return (await tx.wait()) as T;
      }
      return tx as T;
    } catch (err: any) {
      throw new ContractError(err?.message ?? String(err));
    }
  }

  async getGuaranteeDomain(): Promise<string> {
    return this.send<string>(this.contract.guaranteeDomainSeparator());
  }

  async approveErc20(token: string, amount: number | bigint | string): Promise<any> {
    const erc20 = this.erc20(token);
    const target = (this.contract as any).target ?? (this.contract as any).address;
    return this.send(erc20.approve(target, parseU256(amount)));
  }

  async deposit(amount: number | bigint | string, erc20Token?: string): Promise<any> {
    if (erc20Token) {
      return this.send(
        this.contract.depositStablecoin(erc20Token, parseU256(amount))
      );
    }
    return this.send(
      this.contract.deposit({
        value: parseU256(amount),
      })
    );
  }

  async getUserAssets(): Promise<
    { asset: string; collateral: bigint; withdrawal_request_timestamp: bigint; withdrawal_request_amount: bigint }[]
  > {
    try {
      const result = await this.contract.getUserAllAssets(this.wallet.address);
      return result.map((asset: any) => ({
        asset: asset[0],
        collateral: parseU256(asset[1]),
        withdrawal_request_timestamp: parseU256(asset[2]),
        withdrawal_request_amount: parseU256(asset[3]),
      }));
    } catch (err: any) {
      throw new ContractError(err?.message ?? String(err));
    }
  }

  async getPaymentStatus(tabId: number | bigint): Promise<{
    paid: bigint;
    remunerated: boolean;
    asset: string;
  }> {
    try {
      const [paid, remunerated, asset] = await this.contract.getPaymentStatus(
        parseU256(tabId)
      );
      return {
        paid: parseU256(paid),
        remunerated: Boolean(remunerated),
        asset,
      };
    } catch (err: any) {
      throw new ContractError(err?.message ?? String(err));
    }
  }

  async payTabEth(
    tabId: number | bigint,
    reqId: number | bigint,
    amount: number | bigint | string,
    recipient: string
  ): Promise<any> {
    const data = Buffer.from(
      `tab_id:${toBeHex(parseU256(tabId))};req_id:${toBeHex(parseU256(reqId))}`
    );
    const tx = {
      to: recipient,
      value: parseU256(amount),
      data,
    };
    return this.send(this.wallet.sendTransaction(tx));
  }

  async payTabErc20(
    tabId: number | bigint,
    amount: number | bigint | string,
    erc20Token: string,
    recipient: string
  ): Promise<any> {
    return this.send(
      this.contract.payTabInERC20Token(
        parseU256(tabId),
        erc20Token,
        parseU256(amount),
        recipient
      )
    );
  }

  async requestWithdrawal(
    amount: number | bigint | string,
    erc20Token?: string
  ): Promise<any> {
    if (erc20Token) {
      return this.send(
        this.contract.requestWithdrawal(erc20Token, parseU256(amount))
      );
    }
    return this.send(this.contract.requestWithdrawal(parseU256(amount)));
  }

  async cancelWithdrawal(erc20Token?: string): Promise<any> {
    if (erc20Token) {
      return this.send(this.contract.cancelWithdrawal(erc20Token));
    }
    return this.send(this.contract.cancelWithdrawal());
  }

  async finalizeWithdrawal(erc20Token?: string): Promise<any> {
    if (erc20Token) {
      return this.send(this.contract.finalizeWithdrawal(erc20Token));
    }
    return this.send(this.contract.finalizeWithdrawal());
  }

  async remunerate(claimsBlob: Uint8Array, signatureWords: Uint8Array[]): Promise<any> {
    const sigStruct = signatureWords.map((word) => hexlify(getBytes(word)));
    return this.send(
      this.contract.remunerate(hexlify(claimsBlob), sigStruct)
    );
  }
}
