import {
  PaymentGuaranteeRequestClaims,
  PaymentGuaranteeRequestClaimsV2,
  PaymentSignature,
  SigningScheme,
} from './models';
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

export interface PaymentPayloadClaimsV2 extends PaymentPayloadClaims {
  validation_registry_address: string;
  validation_request_hash: string;
  validation_chain_id: number;
  validator_address: string;
  validator_agent_id: string;
  min_validation_score: number;
  validation_subject_hash: string;
  required_validation_tag: string;
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

export function serializePaymentClaimsV2(
  claims: PaymentGuaranteeRequestClaimsV2
): PaymentPayloadClaimsV2 {
  return {
    ...serializePaymentClaims(claims),
    version: 'v2',
    validation_registry_address: claims.validationRegistryAddress,
    validation_request_hash: claims.validationRequestHash,
    validation_chain_id: claims.validationChainId,
    validator_address: claims.validatorAddress,
    validator_agent_id: serializeU256(claims.validatorAgentId),
    min_validation_score: claims.minValidationScore,
    validation_subject_hash: claims.validationSubjectHash,
    required_validation_tag: claims.requiredValidationTag,
  };
}

export function buildPaymentPayload(
  claims: PaymentGuaranteeRequestClaimsV2,
  signature: PaymentSignature
): PaymentPayload;
export function buildPaymentPayload(
  claims: PaymentGuaranteeRequestClaimsV2,
  signature: string,
  scheme: SigningScheme
): PaymentPayload;
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
  claims: PaymentGuaranteeRequestClaims | PaymentGuaranteeRequestClaimsV2,
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
  const serialized =
    claims instanceof PaymentGuaranteeRequestClaimsV2
      ? serializePaymentClaimsV2(claims)
      : serializePaymentClaims(claims);
  return {
    claims: serialized,
    signature: signed.signature,
    scheme: signed.scheme,
  };
}
