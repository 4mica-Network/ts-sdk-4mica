import {
  hashTypedData,
  hashMessage,
  hexToSignature,
  keccak256,
  serializeTransaction,
  type Hex,
  type Account,
  type SignableMessage,
  type TypedDataDefinition,
  type TransactionSerializable,
  type SerializeTransactionFn,
} from 'viem';
import { toAccount } from 'viem/accounts';

export interface CdpAccountConfig {
  /** CDP API key ID from the Coinbase Developer Platform dashboard. */
  apiKeyId: string;
  /** CDP API key secret from the Coinbase Developer Platform dashboard. */
  apiKeySecret: string;
  /** Idempotency name — getOrCreateAccount always returns the same wallet for a given name. */
  name: string;
}

/** Creates a viem Account backed by a Coinbase CDP MPC wallet (private key never leaves CDP). */
export async function createCdpAccount(config: CdpAccountConfig): Promise<Account> {
  const { CdpClient } = await import('@coinbase/cdp-sdk');

  const cdp = new CdpClient({
    apiKeyId: config.apiKeyId,
    apiKeySecret: config.apiKeySecret,
  });

  const evmAccount = await cdp.evm.getOrCreateAccount({ name: config.name });
  const address = evmAccount.address as Hex;

  async function signMessage({ message }: { message: SignableMessage }): Promise<Hex> {
    if (typeof message === 'string') {
      // CDP's signMessage applies the EIP-191 prefix internally.
      const result = await cdp.evm.signMessage({ address, message });
      return result.signature as Hex;
    }
    const hash = hashMessage(message);
    const result = await cdp.evm.signHash({ address, hash });
    return result.signature as Hex;
  }

  async function signTypedData(parameters: TypedDataDefinition): Promise<Hex> {
    const { domain, types, primaryType, message } = parameters;
    if (domain && types && primaryType && message) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload = { address, domain, types, primaryType, message } as any;
        const result = await cdp.evm.signTypedData(payload);
        return result.signature as Hex;
      } catch {
        // Fall back to hash-then-sign if CDP rejects the typed-data structure.
      }
    }
    const hash = hashTypedData(parameters);
    const result = await cdp.evm.signHash({ address, hash });
    return result.signature as Hex;
  }

  async function signTransaction(
    transaction: TransactionSerializable,
    options?: { serializer?: SerializeTransactionFn }
  ): Promise<Hex> {
    const serializer = options?.serializer ?? serializeTransaction;
    const hash = keccak256(serializer(transaction) as Hex);
    const result = await cdp.evm.signHash({ address, hash });
    const { r, s, yParity } = hexToSignature(result.signature as Hex);
    return serializer(transaction, { r, s, yParity }) as Hex;
  }

  // viem's signTypedData generic cannot be satisfied by a hand-rolled adapter without casting — same pattern as hdKeyToAccount.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return toAccount({ address, signMessage, signTypedData, signTransaction } as any) as Account;
}
