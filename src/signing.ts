import { AbiCoder, Wallet, getBytes } from 'ethers';
import { SigningError } from './errors';
import { PaymentGuaranteeRequestClaims, PaymentSignature, SigningScheme } from './models';
import { ValidationError, normalizeAddress } from './utils';

export class CorePublicParameters {
  constructor(
    public publicKey: Uint8Array,
    public contractAddress: string,
    public ethereumHttpRpcUrl: string,
    public eip712Name: string,
    public eip712Version: string,
    public chainId: number
  ) {}

  static fromRpc(payload: Record<string, unknown>): CorePublicParameters {
    const pkRaw = payload.public_key ?? payload.publicKey;
    const pk =
      typeof pkRaw === 'string'
        ? getBytes(pkRaw)
        : pkRaw instanceof Uint8Array
          ? pkRaw
          : Array.isArray(pkRaw)
            ? Uint8Array.from(pkRaw as ArrayLike<number>)
            : new Uint8Array();
    return new CorePublicParameters(
      pk,
      String(payload.contract_address ?? payload.contractAddress ?? ''),
      String(payload.ethereum_http_rpc_url ?? payload.ethereumHttpRpcUrl ?? ''),
      (payload.eip712_name ?? payload.eip712Name ?? '4Mica') as string,
      (payload.eip712_version ?? payload.eip712Version ?? '1') as string,
      Number(payload.chain_id ?? payload.chainId)
    );
  }
}

export const GUARANTEE_EIP712_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
  ],
  SolGuaranteeRequestClaimsV1: [
    { name: 'user', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'tabId', type: 'uint256' },
    { name: 'reqId', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'asset', type: 'address' },
    { name: 'timestamp', type: 'uint64' },
  ],
} as const;

export type GuaranteeTypedData = {
  types: typeof GUARANTEE_EIP712_TYPES;
  primaryType: 'SolGuaranteeRequestClaimsV1';
  domain: {
    name: string;
    version: string;
    chainId: number;
  };
  message: {
    user: string;
    recipient: string;
    tabId: bigint;
    reqId: bigint;
    amount: bigint;
    asset: string;
    timestamp: bigint;
  };
};

export type GuaranteeTypedDataValidationOptions = {
  expectedChainId?: number;
  expectedSigner?: string;
  expectedRecipient?: string;
};

export type GuaranteeSigningContextOptions = {
  signerAddress?: string;
  signerChainId?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const fieldsMatch = (
  actual: unknown,
  expected: readonly { name: string; type: string }[]
): boolean => {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const norm = (list: readonly { name: string; type: string }[]) =>
    list.map((item) => `${item.name}:${item.type}`).sort();
  const actualSet = new Set(norm(actual));
  return norm(expected).every((key) => actualSet.has(key));
};

const parseChainId = (value: unknown): number => {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return Number.NaN;
};

const ensureBigIntish = (value: unknown, label: string): void => {
  try {
    BigInt(value as bigint | number | string);
  } catch {
    throw new ValidationError(`${label} must be a numeric value`);
  }
};

export function validateGuaranteeTypedData(
  payload: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    message: Record<string, unknown>;
  },
  options: GuaranteeTypedDataValidationOptions = {}
): void {
  if (!isRecord(payload)) {
    throw new ValidationError('typed data payload is required');
  }
  if (!isRecord(payload.domain)) {
    throw new ValidationError('domain is required');
  }
  if (!isRecord(payload.types)) {
    throw new ValidationError('types are required');
  }
  if (!isRecord(payload.message)) {
    throw new ValidationError('message is required');
  }

  const types = payload.types;
  if (
    !fieldsMatch(
      types.SolGuaranteeRequestClaimsV1,
      GUARANTEE_EIP712_TYPES.SolGuaranteeRequestClaimsV1
    )
  ) {
    throw new ValidationError('Unexpected struct fields for SolGuaranteeRequestClaimsV1');
  }

  const message = payload.message;
  const requiredFields = ['user', 'recipient', 'tabId', 'reqId', 'amount', 'asset', 'timestamp'];
  if (requiredFields.some((field) => !(field in message))) {
    throw new ValidationError('message is missing required SolGuaranteeRequestClaimsV1 fields');
  }

  const user = normalizeAddress(message.user as string);
  const recipient = normalizeAddress(message.recipient as string);
  normalizeAddress(message.asset as string);

  if (options.expectedSigner) {
    if (normalizeAddress(options.expectedSigner) !== user) {
      throw new ValidationError('message.user must match signer address');
    }
  }
  if (options.expectedRecipient) {
    if (normalizeAddress(options.expectedRecipient) !== recipient) {
      throw new ValidationError('message.recipient must match expected recipient');
    }
  }

  ensureBigIntish(message.tabId, 'tabId');
  ensureBigIntish(message.reqId, 'reqId');
  ensureBigIntish(message.amount, 'amount');
  ensureBigIntish(message.timestamp, 'timestamp');

  if (options.expectedChainId !== undefined) {
    const domainChainId = parseChainId(payload.domain.chainId);
    if (!Number.isFinite(domainChainId)) {
      throw new ValidationError('domain.chainId is required for typed data signatures');
    }
    if (Number(domainChainId) !== Number(options.expectedChainId)) {
      throw new ValidationError(
        `domain.chainId mismatch; expected ${options.expectedChainId}, got ${domainChainId}`
      );
    }
  }
}

export function validateGuaranteeSigningContext(
  params: CorePublicParameters,
  claims: PaymentGuaranteeRequestClaims,
  options: GuaranteeSigningContextOptions = {}
): void {
  if (options.signerAddress) {
    const signer = normalizeAddress(options.signerAddress);
    const user = normalizeAddress(claims.userAddress);
    if (signer !== user) {
      throw new ValidationError(
        `address mismatch: signer ${options.signerAddress} != claims.user_address ${claims.userAddress}`
      );
    }
  }

  if (options.signerChainId !== undefined) {
    const signerChainId = Number(options.signerChainId);
    if (!Number.isFinite(signerChainId)) {
      throw new ValidationError('signer chain id is invalid');
    }
    if (Number(params.chainId) !== signerChainId) {
      throw new ValidationError(
        `chain id mismatch: expected ${params.chainId}, got ${signerChainId}`
      );
    }
  }
}

export function buildGuaranteeTypedData(
  params: CorePublicParameters,
  claims: PaymentGuaranteeRequestClaims
): GuaranteeTypedData {
  return {
    types: GUARANTEE_EIP712_TYPES,
    primaryType: 'SolGuaranteeRequestClaimsV1',
    domain: {
      name: params.eip712Name,
      version: params.eip712Version,
      chainId: params.chainId,
    },
    message: {
      user: claims.userAddress,
      recipient: claims.recipientAddress,
      tabId: claims.tabId,
      reqId: claims.reqId,
      amount: claims.amount,
      asset: claims.assetAddress,
      timestamp: BigInt(claims.timestamp),
    },
  } as const;
}

export function encodeGuaranteeEip191(claims: PaymentGuaranteeRequestClaims): Uint8Array {
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'uint256', 'uint256', 'uint256', 'address', 'uint64'],
    [
      claims.userAddress,
      claims.recipientAddress,
      claims.tabId,
      claims.reqId,
      claims.amount,
      claims.assetAddress,
      claims.timestamp,
    ]
  );
  return getBytes(payload);
}

export class PaymentSigner {
  private wallet: Wallet;

  constructor(privateKey: string) {
    this.wallet = new Wallet(privateKey);
  }

  async signRequest(
    params: CorePublicParameters,
    claims: PaymentGuaranteeRequestClaims,
    scheme: SigningScheme = SigningScheme.EIP712
  ): Promise<PaymentSignature> {
    try {
      validateGuaranteeSigningContext(params, claims, { signerAddress: this.wallet.address });
      if (scheme === SigningScheme.EIP712) {
        const typed = buildGuaranteeTypedData(params, claims);
        const claimsTypes = [...typed.types.SolGuaranteeRequestClaimsV1];
        const signature = await this.wallet.signTypedData(
          typed.domain,
          { SolGuaranteeRequestClaimsV1: claimsTypes },
          typed.message
        );
        return { signature, scheme };
      }
      if (scheme === SigningScheme.EIP191) {
        const message = encodeGuaranteeEip191(claims);
        const signature = await this.wallet.signMessage(message);
        return { signature, scheme };
      }
      throw new SigningError(`unsupported signing scheme: ${scheme}`);
    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        throw new SigningError(err.message);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new SigningError(message);
    }
  }
}
