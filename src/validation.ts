import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { PaymentGuaranteeRequestClaims, PaymentGuaranteeRequestClaimsV2 } from './models';
import { ensureHexPrefix } from './utils';

export const VALIDATION_SUBJECT_BINDING_DOMAIN = '4MICA_VALIDATION_SUBJECT_V1';
export const VALIDATION_REQUEST_BINDING_DOMAIN = '4MICA_VALIDATION_REQUEST_V1';

export function computeValidationSubjectHash(claims: PaymentGuaranteeRequestClaims): Hex {
  const bindingDomain = keccak256(new TextEncoder().encode(VALIDATION_SUBJECT_BINDING_DOMAIN));
  const encoded = encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'uint64' },
    ],
    [
      bindingDomain,
      claims.tabId,
      claims.reqId,
      claims.userAddress as Hex,
      claims.recipientAddress as Hex,
      claims.amount,
      claims.assetAddress as Hex,
      BigInt(claims.timestamp),
    ]
  );
  return keccak256(encoded);
}

export function computeValidationRequestHash(claims: PaymentGuaranteeRequestClaimsV2): Hex {
  const bindingDomain = keccak256(new TextEncoder().encode(VALIDATION_REQUEST_BINDING_DOMAIN));
  const tagHash = keccak256(new TextEncoder().encode(claims.requiredValidationTag));
  const encoded = encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'bytes32' },
      { type: 'uint8' },
      { type: 'bytes32' },
    ],
    [
      bindingDomain,
      BigInt(claims.validationChainId),
      claims.validationRegistryAddress as Hex,
      claims.validatorAddress as Hex,
      claims.validatorAgentId,
      ensureHexPrefix(claims.validationSubjectHash),
      claims.minValidationScore,
      tagHash,
    ]
  );
  return keccak256(encoded);
}
