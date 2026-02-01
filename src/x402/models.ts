import { PaymentSignature, SigningScheme } from '../models';

export interface PaymentRequirementsV1 {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  outputSchema?: unknown;
  maxTimeoutSeconds?: number;
  extra?: PaymentRequirementsExtra;
}

export interface PaymentRequirementsV2 {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: PaymentRequirementsExtra;
}

export type PaymentRequirements = PaymentRequirementsV2;

export interface PaymentRequirementsExtra {
  tabEndpoint?: string;
}

export interface TabResponse {
  tabId: string;
  userAddress: string;
  nextReqId?: string;
}

export interface X402PaymentPayloadClaims {
  version: string;
  user_address: string;
  recipient_address: string;
  tab_id: string;
  req_id: string;
  amount: string;
  timestamp: number;
  asset_address: string;
}

export interface X402PaymentPayload {
  claims: X402PaymentPayloadClaims;
  /// 65-byte signature as 0x-prefixed hex
  signature: string;
  scheme: SigningScheme;
}

export interface X402PaymentEnvelopeV1 {
  x402Version: number;
  scheme: string;
  network: string;
  payload: X402PaymentPayload;
}

export interface X402ResourceInfo {
  url: string;
  description: string;
  mimeType: string;
}

export interface X402PaymentEnvelopeV2 {
  x402Version: number;
  accepted: PaymentRequirementsV2;
  payload: X402PaymentPayload;
  resource: X402ResourceInfo;
}

export interface X402SignedPayment {
  header: string;
  payload: X402PaymentPayload;
  signature: PaymentSignature;
}

export interface X402SettledPayment {
  payment: X402SignedPayment;
  settlement: unknown;
}

export interface X402PaymentRequired {
  x402Version: number;
  error?: string;
  resource: X402ResourceInfo;
  accepts: PaymentRequirementsV2[];
  extensions?: Record<string, unknown>;
}
