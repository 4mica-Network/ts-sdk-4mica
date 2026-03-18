/**
 * Interactive 4Mica SDK end-to-end demo.
 *
 * Steps:
 *   1  Setup          – enter keys, connect clients
 *   2  Deposit        – approve + deposit ERC20 collateral
 *   3  Open Tab       – createTab via the core RPC
 *   4  Guarantee V1   – sign + issue a V1 BLS guarantee certificate
 *   5  Guarantee V2   – sign + issue a V2 guarantee (with on-chain validation policy)
 *   6A Pay Tab        – payTab directly (ERC20), then remunerate from the cert
 *   6B Remunerate     – remunerate from an existing cert (skip direct payment)
 *   7  Withdraw       – requestWithdrawal (+ optional finalizeWithdrawal)
 *
 * Run:
 *   npx ts-node examples/credit-flow.ts
 *
 * All prompts can be pre-filled via environment variables (listed inline).
 */

import {
  Client,
  ConfigBuilder,
  PaymentGuaranteeRequestClaims,
  PaymentGuaranteeRequestClaimsV2,
  SigningScheme,
  computeValidationSubjectHash,
  computeValidationRequestHash,
  type BLSCert,
} from "../src/index";
import { erc20Abi, formatUnits, getContract, parseUnits } from "viem";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ─── colours ────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

const step = (n: number, title: string) =>
  console.log(`\n${C.bold}${C.cyan}── Step ${n}: ${title}${C.reset}`);
const info = (msg: string) => console.log(`  ${C.dim}${msg}${C.reset}`);
const ok = (msg: string) => console.log(`  ${C.green}✓${C.reset} ${msg}`);
const warn = (msg: string) => console.log(`  ${C.yellow}⚠${C.reset}  ${msg}`);
const fail = (msg: string) => console.log(`  ${C.red}✗${C.reset} ${msg}`);
const header = (title: string) =>
  console.log(`\n${C.bold}${C.magenta}╔══ ${title} ══╗${C.reset}`);

// ─── readline helpers ────────────────────────────────────────────────────────

let rl: ReturnType<typeof createInterface> | null = null;

function getRL() {
  if (!rl) rl = createInterface({ input, output });
  return rl;
}

async function ask(question: string, defaultValue = ""): Promise<string> {
  if (!input.isTTY) return defaultValue;
  const suffix = defaultValue ? ` ${C.dim}[${defaultValue}]${C.reset}` : "";
  const answer = (
    await getRL().question(`  ${C.cyan}?${C.reset} ${question}${suffix}: `)
  ).trim();
  return answer || defaultValue;
}

async function askSecret(question: string, defaultValue = ""): Promise<string> {
  if (!input.isTTY) return defaultValue;
  const suffix = defaultValue ? ` ${C.dim}[***]${C.reset}` : "";
  // readline/promises doesn't support hidden input; we just warn
  const answer = (
    await getRL().question(`  ${C.cyan}?${C.reset} ${question}${suffix}: `)
  ).trim();
  return answer || defaultValue;
}

async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  if (!input.isTTY) return defaultYes;
  const suffix = defaultYes ? `${C.dim}[Y/n]${C.reset}` : `${C.dim}[y/N]${C.reset}`;
  while (true) {
    const answer = (
      await getRL().question(`  ${C.cyan}?${C.reset} ${question} ${suffix}: `)
    )
      .trim()
      .toLowerCase();
    if (!answer) return defaultYes;
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    warn("Please answer y or n");
  }
}

async function shouldRun(n: number, title: string): Promise<boolean> {
  const run = await askYesNo(`Run Step ${n}: ${title}?`);
  if (!run) warn(`skipping step ${n}`);
  return run;
}

// ─── utilities ───────────────────────────────────────────────────────────────

const toHex = (n: bigint) => `0x${n.toString(16)}`;
const fmt = (amount: bigint, decimals: number) =>
  `${formatUnits(amount, decimals)} (${toHex(amount)})`;

const CERT_DIR = join(process.cwd(), "examples", "certs");

async function saveCert(label: string, payload: unknown) {
  await mkdir(CERT_DIR, { recursive: true });
  const path = join(CERT_DIR, `${label}.json`);
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  header("4Mica SDK Interactive Demo");

  // ── Setup ──────────────────────────────────────────────────────────────────
  step(1, "Setup — keys & clients");

  const rpcUrl = await ask(
    "4Mica RPC URL",
    process.env["4MICA_RPC_URL"] ?? "http://localhost:3000/"
  );
  const payerKey = await askSecret(
    "Payer private key (0x…)",
    process.env.PAYER_PRIVATE_KEY ?? process.env["4MICA_WALLET_PRIVATE_KEY"] ?? ""
  );
  if (!payerKey) throw new Error("Payer private key is required");

  const sameKey = await askYesNo("Use same key for recipient?", true);
  const recipientKey = sameKey
    ? payerKey
    : await askSecret(
        "Recipient private key (0x…)",
        process.env.RECIPIENT_PRIVATE_KEY ?? ""
      );
  if (!recipientKey) throw new Error("Recipient private key is required");

  const payerCfg = new ConfigBuilder().rpcUrl(rpcUrl).walletPrivateKey(payerKey).build();
  const recipientCfg = new ConfigBuilder().rpcUrl(rpcUrl).walletPrivateKey(recipientKey).build();

  const payerClient = await Client.new(payerCfg);
  const recipientClient = await Client.new(recipientCfg);

  const payerAddress = payerCfg.signer.address;
  const recipientAddress = recipientCfg.signer.address;

  ok(`Payer:     ${payerAddress}`);
  ok(`Recipient: ${recipientAddress}`);
  if (sameKey) warn("Using same wallet for payer and recipient (demo mode)");

  await payerClient.login();
  ok("SIWE auth: payer logged in");
  if (!sameKey) {
    await recipientClient.login();
    ok("SIWE auth: recipient logged in");
  }

  // ── Discover ERC20 collateral token ───────────────────────────────────────
  const chainId = payerClient.params.chainId;
  info(`Chain ID: ${chainId}`);

  const supportedTokens = await payerClient.rpc.getSupportedTokens();
  const preferredToken =
    supportedTokens.tokens.find((token) => token.symbol.toUpperCase() === "USDC") ??
    supportedTokens.tokens[0];
  const erc20TokenAddress = preferredToken?.address;
  if (!erc20TokenAddress) throw new Error("Core /core/tokens did not include any ERC20 token");
  info(
    preferredToken
      ? `ERC20 from /core/tokens: ${preferredToken.symbol} ${erc20TokenAddress}`
      : `ERC20 from /core/tokens: ${erc20TokenAddress}`
  );

  const erc20 = getContract({
    address: erc20TokenAddress as `0x${string}`,
    abi: erc20Abi,
    client: {
      public: payerClient.gateway.publicClient,
      wallet: payerClient.gateway.walletClient,
    },
  });
  const decimals = Number(await erc20.read.decimals());
  info(`ERC20 decimals: ${decimals}`);

  // shared state
  let tabId: bigint | undefined;
  let tabAssetAddress: string = erc20TokenAddress; // set from createTab response
  let nextReqId: bigint = 0n;                      // set from createTab response
  let v1Cert: BLSCert | undefined;
  let v2Cert: BLSCert | undefined;

  // ── Step 2: Deposit ────────────────────────────────────────────────────────
  if (await shouldRun(2, "Deposit ERC20 collateral")) {
    step(2, "Deposit ERC20 collateral");

    const amountStr = await ask(
      "Amount to deposit (e.g. 1.0)",
      process.env.DEPOSIT_AMOUNT ?? "1.0"
    );
    const depositAmount = parseUnits(amountStr, decimals);
    info(`Deposit amount: ${fmt(depositAmount, decimals)}`);

    const balance = (await erc20.read.balanceOf([payerAddress as `0x${string}`])) as bigint;
    info(`Your ERC20 balance: ${fmt(balance, decimals)}`);
    if (balance < depositAmount) {
      throw new Error(
        `Insufficient ERC20 balance: have ${fmt(balance, decimals)}, need ${fmt(depositAmount, decimals)}`
      );
    }

    const approval = await payerClient.user.approveErc20(erc20TokenAddress, depositAmount);
    ok(`Approve tx: ${approval.transactionHash}`);

    const deposit = await payerClient.user.deposit(depositAmount, erc20TokenAddress);
    ok(`Deposit tx: ${deposit.transactionHash}`);

    const userInfo = await payerClient.user.getUser();
    const pos = userInfo.find((a) => a.asset.toLowerCase() === erc20TokenAddress.toLowerCase());
    if (pos) ok(`Collateral balance after deposit: ${fmt(pos.collateral, decimals)}`);
  }

  // ── Step 3: Open Tab ───────────────────────────────────────────────────────
  if (await shouldRun(3, "Open a payment tab")) {
    step(3, "Open a payment tab");

    const ttl = Number(
      await ask("Tab TTL in seconds (0 = no expiry)", process.env.TAB_TTL_SECONDS ?? "300")
    );

    info(`Creating tab with:`);
    info(`  user_address:      ${payerAddress}`);
    info(`  recipient_address: ${recipientAddress}`);
    info(`  erc20_token:       ${erc20TokenAddress}`);
    info(`  ttl:               ${ttl || null}`);

    const tab = await recipientClient.recipient.createTab(
      payerAddress,
      recipientAddress,
      erc20TokenAddress,
      ttl || null
    );

    tabId = tab.tabId;
    tabAssetAddress = tab.assetAddress;
    nextReqId = tab.nextReqId;

    ok(`Tab created: tabId = ${toHex(tabId)}`);
    info(`Asset address (from core): ${tabAssetAddress}`);
    info(`Next req ID:               ${toHex(tab.nextReqId)}`);
    if (ttl) info(`TTL: ${ttl}s`);
    if (tabAssetAddress.toLowerCase() !== erc20TokenAddress.toLowerCase()) {
      warn(`Core stored "${tabAssetAddress}" instead of "${erc20TokenAddress}" — using core value for claims`);
    }
  } else if (tabId === undefined) {
    const rawTabId = await ask(
      "Enter an existing tab ID to use (or leave blank to skip guarantee steps)",
      ""
    );
    if (rawTabId) tabId = BigInt(rawTabId);
  }

  // ── Step 4: V1 Guarantee ───────────────────────────────────────────────────
  if (await shouldRun(4, "Issue a V1 payment guarantee")) {
    if (tabId === undefined) {
      warn("No tab available — skipping V1 guarantee");
    } else {
      step(4, "Issue a V1 payment guarantee");

      const amountStr = await ask(
        "Guarantee amount (e.g. 0.001)",
        process.env.GUARANTEE_AMOUNT ?? "0.001"
      );
      const amount = parseUnits(amountStr, decimals);
      const reqId = BigInt(await ask("Request ID (reqId)", nextReqId.toString()));
      const timestamp = Math.floor(Date.now() / 1000);

      info(`Tab ID:    ${toHex(tabId)}`);
      info(`Amount:    ${fmt(amount, decimals)}`);
      info(`Req ID:    ${reqId}`);
      info(`Timestamp: ${timestamp}`);

      const claims = PaymentGuaranteeRequestClaims.new(
        payerAddress,
        recipientAddress,
        tabId,
        amount,
        timestamp,
        tabAssetAddress,
        reqId
      );

      const { signature, scheme } = await payerClient.user.signPayment(claims, SigningScheme.EIP712);
      ok("Claims signed (EIP-712)");

      info(`Payload → asset_address: ${claims.assetAddress}`);
      info(`Payload → user_address:  ${claims.userAddress}`);
      info(`Payload → recipient:     ${claims.recipientAddress}`);

      v1Cert = await recipientClient.recipient.issuePaymentGuarantee(claims, signature, scheme);
      ok(`V1 BLS certificate issued`);
      info(`claims (first 32 chars): ${v1Cert.claims.slice(0, 34)}…`);
      info(`sig    (first 32 chars): ${v1Cert.signature.slice(0, 34)}…`);

      const decoded = await recipientClient.recipient.verifyPaymentGuarantee(v1Cert);
      ok(`Certificate verified — total amount: ${fmt(decoded.totalAmount, decimals)}`);

      const certPath = await saveCert("v1-cert", {
        version: 1,
        tabId: tabId.toString(),
        reqId: reqId.toString(),
        amount: amount.toString(),
        totalAmount: decoded.totalAmount.toString(),
        cert: v1Cert,
      });
      ok(`Cert saved: ${certPath}`);
    }
  }

  // ── Step 5: V2 Guarantee ───────────────────────────────────────────────────
  if (await shouldRun(5, "Issue a V2 payment guarantee (with validation policy)")) {
    if (tabId === undefined) {
      warn("No tab available — skipping V2 guarantee");
    } else {
      step(5, "Issue a V2 payment guarantee (with validation policy)");

      console.log(`\n  ${C.dim}V2 guarantees include an on-chain validation policy.${C.reset}`);
      console.log(`  ${C.dim}You will need addresses and IDs for the validator contract.${C.reset}\n`);

      const amountStr = await ask(
        "Guarantee amount (e.g. 0.001)",
        process.env.V2_GUARANTEE_AMOUNT ?? "0.001"
      );
      const amount = parseUnits(amountStr, decimals);
      const reqId = BigInt(
        await ask("Request ID (reqId, must differ from V1 if same tab)", (nextReqId + 1n).toString())
      );
      const timestamp = Math.floor(Date.now() / 1000);

      // Validation policy inputs
      const registries = payerClient.params.trustedValidationRegistries;
      const defaultRegistry = process.env.VALIDATION_REGISTRY ?? registries[0] ?? "";
      if (registries.length > 0) {
        info(`Trusted registries from core: ${registries.join(", ")}`);
      }
      const validationRegistryAddress = await ask(
        "Validation registry address",
        defaultRegistry
      );
      if (!validationRegistryAddress) throw new Error("validationRegistryAddress is required for V2");

      const validationChainId = Number(
        await ask("Validation chain ID", process.env.VALIDATION_CHAIN_ID ?? String(chainId))
      );
      const validatorAddress = await ask(
        "Validator address",
        process.env.VALIDATOR_ADDRESS ?? ""
      );
      if (!validatorAddress) throw new Error("validatorAddress is required for V2");

      const validatorAgentId = BigInt(
        await ask("Validator agent ID", process.env.VALIDATOR_AGENT_ID ?? "1")
      );
      const minValidationScore = Number(
        await ask("Min validation score (1–100)", process.env.MIN_VALIDATION_SCORE ?? "80")
      );
      const requiredValidationTag = await ask(
        "Required validation tag (empty = none)",
        process.env.VALIDATION_TAG ?? ""
      );

      info(`Tab ID:    ${toHex(tabId)}`);
      info(`Amount:    ${fmt(amount, decimals)}`);
      info(`Req ID:    ${reqId}`);

      // Build base claims to compute canonical hashes
      const baseClaims = PaymentGuaranteeRequestClaims.new(
        payerAddress,
        recipientAddress,
        tabId,
        amount,
        timestamp,
        tabAssetAddress,
        reqId
      );

      const validationSubjectHash = computeValidationSubjectHash(baseClaims);
      info(`validationSubjectHash: ${validationSubjectHash.slice(0, 18)}…`);

      const partialV2 = new PaymentGuaranteeRequestClaimsV2({
        userAddress: baseClaims.userAddress,
        recipientAddress: baseClaims.recipientAddress,
        tabId: baseClaims.tabId,
        reqId: baseClaims.reqId,
        amount: baseClaims.amount,
        timestamp: baseClaims.timestamp,
        assetAddress: baseClaims.assetAddress,
        validationRegistryAddress,
        validationRequestHash: "0x" + "00".repeat(32), // placeholder
        validationChainId,
        validatorAddress,
        validatorAgentId,
        minValidationScore,
        validationSubjectHash,
        requiredValidationTag,
      });

      const validationRequestHash = computeValidationRequestHash(partialV2);
      info(`validationRequestHash: ${validationRequestHash.slice(0, 18)}…`);

      const claimsV2 = new PaymentGuaranteeRequestClaimsV2({
        ...partialV2,
        validationRequestHash,
      });

      const { signature, scheme } = await payerClient.user.signPayment(claimsV2, SigningScheme.EIP712);
      ok("Claims signed (EIP-712)");

      v2Cert = await recipientClient.recipient.issuePaymentGuarantee(claimsV2, signature, scheme);
      ok("V2 BLS certificate issued");
      info(`claims (first 32 chars): ${v2Cert.claims.slice(0, 34)}…`);

      const decoded = await recipientClient.recipient.verifyPaymentGuarantee(v2Cert);
      ok(`Certificate verified — version: ${decoded.version}, total: ${fmt(decoded.totalAmount, decimals)}`);
      if (decoded.validationPolicy) {
        info(`validationPolicy.minValidationScore: ${decoded.validationPolicy.minValidationScore}`);
        info(`validationPolicy.requiredValidationTag: "${decoded.validationPolicy.requiredValidationTag}"`);
      }

      const certPath = await saveCert("v2-cert", {
        version: 2,
        tabId: tabId.toString(),
        reqId: reqId.toString(),
        amount: amount.toString(),
        totalAmount: decoded.totalAmount.toString(),
        cert: v2Cert,
      });
      ok(`Cert saved: ${certPath}`);
    }
  }

  // ── Step 6A: Pay Tab directly ──────────────────────────────────────────────
  if (await shouldRun(6, "Option A — Pay tab directly (ERC20 on-chain payment)")) {
    if (tabId === undefined) {
      warn("No tab available — skipping pay tab");
    } else {
      step(6, "Option A — Pay tab directly (ERC20 on-chain payment)");

      // Pick which cert to use for amount reference
      const refCert = v2Cert ?? v1Cert;
      let payAmount: bigint;

      if (refCert) {
        const decoded = await recipientClient.recipient.verifyPaymentGuarantee(refCert);
        info(`Latest guaranteed total: ${fmt(decoded.totalAmount, decimals)}`);
        const useGuaranteedAmount = await askYesNo(
          `Pay the guaranteed total (${fmt(decoded.totalAmount, decimals)})?`,
          true
        );
        if (useGuaranteedAmount) {
          payAmount = decoded.totalAmount;
        } else {
          const custom = await ask("Custom pay amount", "0.001");
          payAmount = parseUnits(custom, decimals);
        }
      } else {
        const custom = await ask("Pay amount (no cert in memory)", "0.001");
        payAmount = parseUnits(custom, decimals);
      }

      const reqIdForPay = BigInt(await ask("reqId for pay memo (0 if unknown)", "0"));

      info(`Paying ${fmt(payAmount, decimals)} for tab ${toHex(tabId)}`);

      const approvalReceipt = await payerClient.user.approveErc20(tabAssetAddress, payAmount);
      ok(`Approve tx: ${approvalReceipt.transactionHash}`);

      const payReceipt = await payerClient.user.payTab(
        tabId,
        reqIdForPay,
        payAmount,
        recipientAddress,
        tabAssetAddress
      );
      ok(`Pay tx: ${payReceipt.transactionHash}`);

      const status = await payerClient.user.getTabPaymentStatus(tabId);
      info(`Tab paid: ${fmt(status.paid, decimals)}, remunerated: ${status.remunerated}`);

      // Offer to remunerate immediately using the cert
      const certForRemun = v2Cert ?? v1Cert;
      if (certForRemun) {
        if (await askYesNo("Also remunerate on-chain now using the latest cert?", true)) {
          const remunReceipt = await recipientClient.recipient.remunerate(certForRemun);
          ok(`Remunerate tx: ${remunReceipt.transactionHash}`);
        }
      } else {
        warn("No cert in memory — cannot remunerate in this run");
      }
    }
  }

  // ── Step 6B: Remunerate via guarantee (no direct payment) ─────────────────
  if (await shouldRun(7, "Option B — Remunerate via guarantee (no direct payment)")) {
    step(7, "Option B — Remunerate via guarantee (no direct payment)");

    // Pick cert
    let certToUse: BLSCert | undefined = v2Cert ?? v1Cert;

    if (!certToUse) {
      warn("No cert in memory — enter cert fields manually");
      const claims = await ask("Cert claims hex (0x…)", "");
      const sig = await ask("Cert signature hex (0x…)", "");
      if (!claims || !sig) {
        warn("No cert provided — skipping remuneration");
      } else {
        certToUse = { claims, signature: sig };
      }
    } else {
      const which = await askYesNo(
        `Use ${v2Cert ? "V2" : "V1"} cert from this session?`,
        true
      );
      if (!which) {
        const claims = await ask("Cert claims hex (0x…)", "");
        const sig = await ask("Cert signature hex (0x…)", "");
        certToUse = claims && sig ? { claims, signature: sig } : undefined;
      }
    }

    if (certToUse) {
      const decoded = await recipientClient.recipient.verifyPaymentGuarantee(certToUse);
      ok(
        `Cert verified — version: ${decoded.version}, total: ${fmt(decoded.totalAmount, decimals)}`
      );
      info("Calling remunerate on-chain…");
      const remunReceipt = await recipientClient.recipient.remunerate(certToUse);
      ok(`Remunerate tx: ${remunReceipt.transactionHash}`);

      if (tabId) {
        const status = await payerClient.user.getTabPaymentStatus(tabId);
        info(`Tab status — paid: ${fmt(status.paid, decimals)}, remunerated: ${status.remunerated}`);
      }
    }
  }

  // ── Step 7: Withdraw ───────────────────────────────────────────────────────
  if (await shouldRun(8, "Request a collateral withdrawal")) {
    step(8, "Request a collateral withdrawal");

    const userInfo = await payerClient.user.getUser();
    const pos = userInfo.find((a) => a.asset.toLowerCase() === tabAssetAddress.toLowerCase());
    if (pos) {
      info(`Available collateral: ${fmt(pos.collateral, decimals)}`);
      if (pos.withdrawalRequestAmount > 0n) {
        info(`Pending withdrawal: ${fmt(pos.withdrawalRequestAmount, decimals)}`);
      }
    }

    const amountStr = await ask(
      "Withdrawal request amount",
      process.env.WITHDRAW_AMOUNT ?? "0.001"
    );
    const withdrawAmount = parseUnits(amountStr, decimals);
    info(`Requesting withdrawal of ${fmt(withdrawAmount, decimals)}`);

    const withdrawReceipt = await payerClient.user.requestWithdrawal(
      withdrawAmount,
      tabAssetAddress
    );
    ok(`Withdrawal request tx: ${withdrawReceipt.transactionHash}`);

    // Show updated state
    const updated = await payerClient.user.getUser();
    const updatedPos = updated.find(
      (a) => a.asset.toLowerCase() === tabAssetAddress.toLowerCase()
    );
    if (updatedPos && updatedPos.withdrawalRequestAmount > 0n) {
      const readyAt = new Date(
        (updatedPos.withdrawalRequestTimestamp + /* timelock typical */ 86400) * 1000
      );
      info(`Pending withdrawal: ${fmt(updatedPos.withdrawalRequestAmount, decimals)}`);
      info(`Eligible to finalize after ~${readyAt.toISOString()} (depends on on-chain timelock)`);
    }

    if (await askYesNo("Attempt to finalize withdrawal now? (will fail if timelock active)", false)) {
      try {
        const finalReceipt = await payerClient.user.finalizeWithdrawal(tabAssetAddress);
        ok(`Finalize withdrawal tx: ${finalReceipt.transactionHash}`);
      } catch (e) {
        warn(`Finalize failed (timelock likely not elapsed): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  console.log(`\n${C.bold}${C.green}All done.${C.reset}\n`);

  await payerClient.aclose();
  if (!sameKey) await recipientClient.aclose();
  rl?.close();
}

main().catch((e) => {
  fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  // Show RpcError body if present — contains the raw server response
  if (e && typeof e === "object" && "body" in e && e.body) {
    fail(`RPC error body: ${JSON.stringify(e.body, null, 2)}`);
  }
  rl?.close();
  process.exit(1);
});
