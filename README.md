# 4Mica TypeScript SDK

TypeScript/Node SDK for interacting with the 4Mica payment network. It mirrors the Rust/Python SDK surface: payer (user) flows, recipient flows, X402 helpers, and typed models for request/response payloads.

## Installation

```bash
npm install sdk-4mica
# Optional: remuneration requires BLS decoding
npm install @noble/curves
```

Node 18+ (built‑in `fetch`) is required.

## Quick start

```ts
import { Client, ConfigBuilder, PaymentGuaranteeRequestClaims, SigningScheme } from "sdk-4mica";

async function main() {
  const cfg = new ConfigBuilder().fromEnv().walletPrivateKey("0x...").build();
  const client = await Client.new(cfg);

  // Deposit 1 ETH
  await client.user.deposit(10n ** 18n);

  // Create a tab as the recipient
  const tabId = await client.recipient.createTab(
    "0xUser",
    client.recipient["recipientAddress"], // or set explicitly
    null,
    3600
  );

  // Sign a payment as the user
  const claims = PaymentGuaranteeRequestClaims.new(
    "0xUser",
    client.recipient["recipientAddress"],
    tabId,
    10n ** 17n,
    Math.floor(Date.now() / 1000),
    null
  );
  const sig = await client.user.signPayment(claims, SigningScheme.EIP712);

  // Issue a guarantee as the recipient
  const cert = await client.recipient.issuePaymentGuarantee(
    claims,
    sig.signature,
    sig.scheme
  );
  console.log("Guarantee:", cert);

  await client.aclose();
}

main().catch(console.error);
```

### X402 helper

```ts
import { X402Flow, PaymentRequirements } from "sdk-4mica";

const flow = X402Flow.fromClient(client);
const payment = await flow.signPayment(
  PaymentRequirements.fromRaw(paymentRequirementsJson),
  "0xUser"
);
const settled = await flow.settlePayment(payment, PaymentRequirements.fromRaw(paymentRequirementsJson), "https://api.4mica.xyz/core/");
console.log(settled.settlement);
```

## Configuration

- `wallet_private_key` (**required**)
- `rpc_url` (defaults to `https://api.4mica.xyz/`)
- `ethereum_http_rpc_url` and `contract_address` are auto-fetched from the facilitator unless provided.

Environment variables mirror the Rust/Python SDKs:

```
4MICA_WALLET_PRIVATE_KEY
4MICA_RPC_URL
4MICA_ETHEREUM_HTTP_RPC_URL
4MICA_CONTRACT_ADDRESS
4MICA_ADMIN_API_KEY
```

## API surface

- `UserClient`: approve ERC20, deposit (ETH/ERC20), get user assets, tab payment status, sign payments (EIP-712/EIP-191), pay tab, withdrawal lifecycle.
- `RecipientClient`: create tabs, issue/verify guarantees, remunerate (BLS), list/get tabs, guarantees, payments, collateral events, user balances.
- `X402Flow`: build X-PAYMENT headers and settle via facilitator from X402 `paymentRequirements`.
- `models`: strongly typed claim/certificate and response models.

## Development

```bash
npm install
npm run fmt      # prettier --check
npm run lint     # eslint
npm test         # vitest
npm run build    # tsc
```

CI (`.github/workflows/ci.yml`) runs fmt, lint, and tests on pushes/PRs.
