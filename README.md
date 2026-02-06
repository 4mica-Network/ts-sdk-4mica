[![npm](https://img.shields.io/npm/v/@4mica/sdk.svg)](https://www.npmjs.com/package/@4mica/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

# 4Mica TypeScript SDK

The official TypeScript SDK for interacting with the 4Mica payment network.

## Overview

4Mica is a payment network that enables cryptographically-enforced lines of credit for autonomous
payments. This SDK provides:

- **User Client**: deposit collateral, sign payments, and manage withdrawals in ETH or ERC20 tokens
- **Recipient Client**: create payment tabs, verify payment guarantees, and claim from user collateral
- **X402 Flow Helper**: generate X-PAYMENT headers for 402-protected HTTP resources via an X402-compatible service
- **Admin RPCs**: manage user suspension and admin API keys (when authorized)

## Installation

```bash
npm install @4mica/sdk
# or
yarn add @4mica/sdk
```

Node.js 18+ is required.

## Initialization and Configuration

The SDK requires a signing key and can use sensible defaults for the rest:

- `walletPrivateKey` (**required** unless `signer` is provided): private key used for signing
- `rpcUrl` (optional): URL of the 4Mica core RPC server. Defaults to `https://api.4mica.xyz/`.
- `ethereumHttpRpcUrl` (optional): Ethereum JSON-RPC endpoint; fetched from core if omitted
- `contractAddress` (optional): Core4Mica contract address; fetched from core if omitted
- `adminApiKey` (optional): API key for admin RPCs
- `bearerToken` (optional): static bearer token for auth
- `authUrl` and `authRefreshMarginSecs` (optional): SIWE auth config. Only used when auth is
  enabled via `enableAuth()` or by setting either value (defaults to `rpcUrl` and 60 seconds).

> Note: `ethereumHttpRpcUrl` and `contractAddress` are fetched from the core service by default.
> The SDK validates the connected chain ID but does not verify the contract address or code. Only
> override these if you need to use different values than the server defaults.

### 1) Using ConfigBuilder

```ts
import { Client, ConfigBuilder } from "@4mica/sdk";

async function main() {
  const cfg = new ConfigBuilder()
    .rpcUrl("https://api.4mica.xyz/")
    .walletPrivateKey("0x...")
    .build();

  const client = await Client.new(cfg);
  try {
    // use client.user, client.recipient, client.rpc
  } finally {
    await client.aclose();
  }
}
```

### 2) Using Environment Variables

Set environment variables (example `.env`):

```bash
4MICA_WALLET_PRIVATE_KEY="0x..."
4MICA_RPC_URL="https://api.4mica.xyz/"
4MICA_ETHEREUM_HTTP_RPC_URL="http://localhost:8545"
4MICA_CONTRACT_ADDRESS="0x..."
4MICA_ADMIN_API_KEY="ak_..."
4MICA_BEARER_TOKEN="Bearer <access_token>"
4MICA_AUTH_URL="https://api.4mica.xyz/"
4MICA_AUTH_REFRESH_MARGIN_SECS="60"
```

If you want to set them inline for a single command, use `env` since most shells do not allow
variable names that start with a digit:

```bash
env 4MICA_WALLET_PRIVATE_KEY="0x..." 4MICA_RPC_URL="https://api.4mica.xyz/" node app.js
```

Then in code:

```ts
import { Client, ConfigBuilder } from "@4mica/sdk";

const cfg = new ConfigBuilder().fromEnv().build();
const client = await Client.new(cfg);
```

### 3) Using a Custom Signer

If you want to integrate with a custom signer (hardware wallet, remote signer, etc.), provide a
`viem` `Account` implementation. It must expose `address`, `signTypedData`, and `signMessage` for
SIWE auth.

```ts
import { Client, ConfigBuilder } from "@4mica/sdk";
import { privateKeyToAccount } from "viem/accounts";

const signer = privateKeyToAccount(process.env.PAYER_KEY as `0x${string}`);
const cfg = new ConfigBuilder().signer(signer).build();
const client = await Client.new(cfg);
```

### SIWE Auth (Optional)

Enable automatic SIWE auth refresh, or pass a static bearer token:

```ts
import { Client, ConfigBuilder } from "@4mica/sdk";

const cfg = new ConfigBuilder()
  .walletPrivateKey("0x...")
  .rpcUrl("https://api.4mica.xyz/")
  .enableAuth()
  .build();

const client = await Client.new(cfg);
await client.login(); // optional: first RPC call also triggers auth
```

Or use a static token:

```ts
const cfg = new ConfigBuilder()
  .walletPrivateKey("0x...")
  .bearerToken("Bearer <access_token>")
  .build();
```

Env vars: `4MICA_BEARER_TOKEN`, `4MICA_AUTH_URL`, `4MICA_AUTH_REFRESH_MARGIN_SECS`.

## Usage

The SDK exposes three main entry points:

- `client.user`: payer-side operations (collateral, signing, withdrawals)
- `client.recipient`: recipient-side operations (tabs, guarantees, remuneration)
- `X402Flow`: helper for 402-protected HTTP resources

### X402 flow (HTTP 402)

The X402 helper turns `paymentRequirements` from a `402 Payment Required` response into an
X-PAYMENT header (and optional `/settle` call) that the facilitator will accept.

#### What the SDK expects from `paymentRequirements`

At minimum you need:
- `scheme` and `network` (scheme must include `4mica`, e.g. `4mica-credit`)
- `payTo` (recipient address), `asset`, and `maxAmountRequired` (v1) or `amount` (v2)
- `extra.tabEndpoint` for tab resolution

`X402Flow` will refresh the tab by calling `extra.tabEndpoint` before signing.

#### X402 Version 1

Version 1 returns payment requirements in the JSON response body:

```ts
import { Client, ConfigBuilder, X402Flow } from "@4mica/sdk";
import type { PaymentRequirementsV1 } from "@4mica/sdk";

type ResourceResponse = {
  x402Version: number;
  accepts: PaymentRequirementsV1[];
  error?: string;
};

const cfg = new ConfigBuilder().walletPrivateKey("0x...").build();
const client = await Client.new(cfg);
const flow = X402Flow.fromClient(client);

// 1) GET the protected endpoint and parse JSON body
const res = await fetch("https://resource-url/resource");
const body = (await res.json()) as ResourceResponse;

// 2) Select a payment option
const requirements = body.accepts[0];

// 3) Build the X-PAYMENT header with the SDK
const payment = await flow.signPayment(requirements, "0xUser");

// 4) Call the protected resource with the header
await fetch("https://resource-url/resource", {
  headers: { "X-PAYMENT": payment.header },
});

await client.aclose();
```

#### X402 Version 2

Version 2 uses the `payment-required` header (base64-encoded) instead of a JSON response body:

```ts
import { Client, ConfigBuilder, X402Flow } from "@4mica/sdk";
import type { X402PaymentRequired, PaymentRequirementsV2 } from "@4mica/sdk";

const cfg = new ConfigBuilder().walletPrivateKey("0x...").build();
const client = await Client.new(cfg);
const flow = X402Flow.fromClient(client);

// 1) GET the protected endpoint and extract payment-required header
const res = await fetch("https://resource-url/resource");
const header = res.headers.get("payment-required");
if (!header) throw new Error("Missing payment-required header");

// 2) Decode the header
const decoded = Buffer.from(header, "base64").toString("utf8");
const paymentRequired = JSON.parse(decoded) as X402PaymentRequired;

// 3) Select a payment option
const accepted = paymentRequired.accepts[0] as PaymentRequirementsV2;

// 4) Build the PAYMENT-SIGNATURE header with the SDK
const signed = await flow.signPaymentV2(paymentRequired, accepted, "0xUser");

// 5) Call the protected resource with the header
await fetch("https://resource-url/resource", {
  headers: { "PAYMENT-SIGNATURE": signed.header },
});

await client.aclose();
```

#### Resource server / facilitator side

If your resource server proxies to the facilitator, you can reuse the SDK to settle after
verifying:

```ts
import { Client, ConfigBuilder, X402Flow } from "@4mica/sdk";
import type { PaymentRequirementsV1, X402SignedPayment } from "@4mica/sdk";

async function settle(
  facilitatorUrl: string,
  paymentRequirements: PaymentRequirementsV1,
  payment: X402SignedPayment
) {
  const core = await Client.new(
    new ConfigBuilder().walletPrivateKey(process.env.RESOURCE_SIGNER_KEY!).build()
  );
  const flow = X402Flow.fromClient(core);

  const settled = await flow.settlePayment(payment, paymentRequirements, facilitatorUrl);
  console.log("settlement result:", settled.settlement);

  await core.aclose();
}
```

Notes:
- `signPayment` and `signPaymentV2` always use EIP-712 signing and will error if the scheme is not 4mica.
- `UserClient.signPayment` supports `SigningScheme.EIP712` (default) and `SigningScheme.EIP191`.
- `settlePayment` only hits `/settle`; resource servers should still call `/verify` first when enforcing access.
- `RecipientClient.remunerate` requires the optional `@noble/curves` dependency for BLS decoding.

### API Methods Summary

#### UserClient Methods

- `approveErc20(token, amount)`
- `deposit(amount, erc20Token?)`
- `getUser()`
- `getTabPaymentStatus(tabId)`
- `signPayment(claims, scheme?)`
- `payTab(tabId, reqId, amount, recipientAddress, erc20Token?)`
- `requestWithdrawal(amount, erc20Token?)`
- `cancelWithdrawal(erc20Token?)`
- `finalizeWithdrawal(erc20Token?)`

#### RecipientClient Methods

- `createTab(userAddress, recipientAddress, erc20Token?, ttl?)`
- `getTabPaymentStatus(tabId)`
- `issuePaymentGuarantee(claims, signature, scheme)`
- `verifyPaymentGuarantee(cert)`
- `remunerate(cert)`
- `listSettledTabs()`
- `listPendingRemunerations()`
- `getTab(tabId)`
- `listRecipientTabs(settlementStatuses?)`
- `getTabGuarantees(tabId)`
- `getLatestGuarantee(tabId)`
- `getGuarantee(tabId, reqId)`
- `listRecipientPayments()`
- `getCollateralEventsForTab(tabId)`
- `getUserAssetBalance(userAddress, assetAddress)`

#### Admin / RPC Methods

Available under `client.rpc` (requires an admin API key):

- `updateUserSuspension(userAddress, suspended)`
- `createAdminApiKey({ name, scopes })`
- `listAdminApiKeys()`
- `revokeAdminApiKey(keyId)`

## Error Handling

All SDK errors extend `FourMicaError`. Common error types include `ConfigError`, `RpcError`,
`SigningError`, `VerificationError`, `X402Error`, and `AuthError`.

## License

MIT
