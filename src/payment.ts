import { PaymentGuaranteeRequestClaims, PaymentSignature, SigningScheme } from './models';
import { serializeU256 } from './utils';

export interface PaymentPayloadClaims {
  version: string;
  user_address: string;
  recipient_address: string;
  tab_id: string;
  req_id: string;
  amount: string;
  timestamp: number;
  asset_address: string;
}

export interface PaymentPayload {
  claims: PaymentPayloadClaims;
  /// 65-byte signature as 0x-prefixed hex
  signature: string;
  scheme: SigningScheme;
}

export function serializePaymentClaims(
  claims: PaymentGuaranteeRequestClaims
): PaymentPayloadClaims {
  return {
    version: 'v1',
    user_address: claims.userAddress,
    recipient_address: claims.recipientAddress,
    tab_id: serializeU256(claims.tabId),
    req_id: serializeU256(claims.reqId),
    amount: serializeU256(claims.amount),
    asset_address: claims.assetAddress,
    timestamp: claims.timestamp,
  };
}

export function buildPaymentPayload(
  claims: PaymentGuaranteeRequestClaims,
  signature: PaymentSignature
): PaymentPayload;
export function buildPaymentPayload(
  claims: PaymentGuaranteeRequestClaims,
  signature: string,
  scheme: SigningScheme
): PaymentPayload;
export function buildPaymentPayload(
  claims: PaymentGuaranteeRequestClaims,
  signature: PaymentSignature | string,
  scheme?: SigningScheme
): PaymentPayload {
  const signed =
    typeof signature === 'string'
      ? (() => {
          if (!scheme) {
            throw new Error('scheme is required when providing a signature string');
          }
          return { signature, scheme };
        })()
      : signature;
  return {
    claims: serializePaymentClaims(claims),
    signature: signed.signature,
    scheme: signed.scheme,
  };
}
