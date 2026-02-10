import {
  Client,
  ConfigBuilder,
  PaymentGuaranteeRequestClaims,
  SigningScheme,
  X402Flow,
  buildPaymentPayload,
  type PaymentRequirementsV1,
  type X402SignedPayment,
} from "../src/index";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, formatUnits, getContract, parseUnits } from "viem";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type TabResponse = {
  tabId: string;
  userAddress: string;
  recipientAddress?: string;
  assetAddress?: string;
  startTimestamp?: number;
  ttlSeconds?: number;
  nextReqId?: string;
};

type TabResponseWire = TabResponse & {
  tab_id?: string;
  user_address?: string;
  recipient_address?: string;
  asset_address?: string;
  start_timestamp?: number;
  ttl_seconds?: number;
  next_req_id?: string;
  reqId?: string;
  req_id?: string;
};

type GuaranteeResult = {
  reqId: bigint;
  amount: bigint;
  cert: { claims: string; signature: string };
  totalAmount: bigint;
  timestamp: number;
};

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

const step = (num: number, title: string) => {
  console.log(`\n${COLORS.bold}${COLORS.cyan}Step ${num}${COLORS.reset} ${title}`);
};

const info = (msg: string) => console.log(`  ${COLORS.dim}- ${msg}${COLORS.reset}`);
const ok = (msg: string) => console.log(`  ${COLORS.green}ok${COLORS.reset} ${msg}`);
const warn = (msg: string) => console.log(`  ${COLORS.yellow}warn${COLORS.reset} ${msg}`);
const err = (msg: string) => console.log(`  ${COLORS.red}err${COLORS.reset} ${msg}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pauseIfEnabled = async (label: string) => {
  if (process.env.PAUSE_BETWEEN_STEPS !== "1") return;
  const rl = createInterface({ input, output });
  await rl.question(`${COLORS.dim}Press Enter to continue (${label})...${COLORS.reset}`);
  rl.close();
};

const parseBigInt = (value: string | number | bigint | null | undefined): bigint => {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return BigInt(value);
};

const formatAmount = (amount: bigint, decimals: number) =>
  `${formatUnits(amount, decimals)} (raw ${amount.toString()})`;

const SCHEME = "4mica-credit";
const CERT_DIR = join(process.cwd(), "examples", "certs");
const DEBUG_CERTS = process.env.DEBUG_CERTS !== "0";

const saveCert = async (label: string, payload: Record<string, unknown>) => {
  await mkdir(CERT_DIR, { recursive: true });
  const path = join(CERT_DIR, `${label}.json`);
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
};

const describeValue = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array(len=${value.length})`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return `object(keys=${keys.slice(0, 6).join(",")}${keys.length > 6 ? ",..." : ""})`;
  }
  return typeof value;
};

const normalizeHexString = (value: unknown, label: string): string => {
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return value.toString("hex");
  }
  if (typeof value !== "string") {
    const record = value as Record<string, unknown> | null;
    if (record?.type === "Buffer" && Array.isArray(record.data)) {
      return Buffer.from(record.data).toString("hex");
    }
    throw new Error(`${label} must be a hex string, got ${describeValue(value)}`);
  }
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(
      `${label} must be a valid hex string (even-length, hex chars only); got length=${hex.length}`
    );
  }
  return hex;
};

const normalizeCert = (
  cert: { claims?: unknown; signature?: unknown },
  source: string
): { claims: string; signature: string } => {
  const claimsHex = normalizeHexString(cert.claims, `${source}.claims`);
  const signatureHex = normalizeHexString(cert.signature, `${source}.signature`);
  const claimsBytes = claimsHex.length / 2;
  if (claimsBytes !== 320 && claimsBytes !== 416) {
    throw new Error(
      `${source}.claims length mismatch: expected 320 or 416 bytes, got ${claimsBytes}`
    );
  }
  if (signatureHex.length !== 192) {
    throw new Error(
      `${source}.signature length mismatch: expected 96 bytes (192 hex chars), got ${signatureHex.length}`
    );
  }
  return { claims: claimsHex, signature: signatureHex };
};

const debugCert = (label: string, cert: { claims?: unknown; signature?: unknown }) => {
  if (!DEBUG_CERTS) return;
  const describe = (value: unknown) => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (Array.isArray(value)) return `array(len=${value.length})`;
    if (typeof value === "object") {
      const keys = Object.keys(value as Record<string, unknown>);
      return `object(keys=${keys.slice(0, 6).join(",")}${keys.length > 6 ? ",..." : ""})`;
    }
    return typeof value;
  };
  const preview = (value: unknown) => {
    if (typeof value === "string") return value.slice(0, 12);
    if (value instanceof Uint8Array) return `Uint8Array(${value.length})`;
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
      return `Buffer(${value.length})`;
    }
    return "";
  };
  info(
    `debug cert ${label}: claims=${describe(cert.claims)} ${preview(
      cert.claims
    )} signature=${describe(cert.signature)} ${preview(cert.signature)}`
  );
};

const loadLatestCert = async () => {
  const path = join(CERT_DIR, "latest.json");
  const raw = await readFile(path, "utf8");
  const payload = JSON.parse(raw) as { cert?: { claims?: string; signature?: string } };
  const cert = payload.cert;
  if (!cert?.claims || !cert?.signature) {
    throw new Error("latest.json is missing cert.claims or cert.signature");
  }
  return normalizeCert(cert, "examples/certs/latest.json");
};

async function createTabViaFacilitator(input: {
  facilitatorUrl: string;
  userAddress: string;
  recipientAddress: string;
  erc20Token: string;
  ttlSeconds: number;
  network: string;
}): Promise<TabResponse> {
  const url = `${input.facilitatorUrl.replace(/\/$/, "")}/tabs`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      userAddress: input.userAddress,
      recipientAddress: input.recipientAddress,
      erc20Token: input.erc20Token,
      ttlSeconds: input.ttlSeconds,
      network: input.network,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`facilitator /tabs failed (${response.status}): ${text}`);
  }
  const body = text ? (JSON.parse(text) as TabResponseWire) : ({} as TabResponseWire);
  return {
    tabId: body.tabId ?? body.tab_id,
    userAddress: body.userAddress ?? body.user_address,
    recipientAddress: body.recipientAddress ?? body.recipient_address,
    assetAddress: body.assetAddress ?? body.asset_address,
    startTimestamp: body.startTimestamp ?? body.start_timestamp,
    ttlSeconds: body.ttlSeconds ?? body.ttl_seconds,
    nextReqId:
      body.nextReqId ?? body.next_req_id ?? body.reqId ?? body.req_id,
  };
}

async function main() {
  const payerKey =
    process.env.PAYER_PRIVATE_KEY ?? process.env["4MICA_WALLET_PRIVATE_KEY"] ?? "";
  if (!payerKey) {
    throw new Error("Set PAYER_PRIVATE_KEY (or 4MICA_WALLET_PRIVATE_KEY)");
  }
  const recipientKey = process.env.RECIPIENT_PRIVATE_KEY ?? payerKey;
  const facilitatorUrl = process.env.FACILITATOR_URL ?? "http://localhost:8080";
  const ttlSeconds = Number(process.env.TAB_TTL_SECONDS ?? "60");
  const depositUsdc = process.env.DEPOSIT_USDC ?? "1";
  const guaranteeAmountsRaw = process.env.GUARANTEE_AMOUNTS_USDC ?? "0.0001,0.0001,0.0001";
  const payAmountUsdc = process.env.PAY_AMOUNT_USDC;
  const disableAuth = process.env.DISABLE_AUTH === "1";
  const bearerToken = process.env["4MICA_BEARER_TOKEN"];
  const remunerationOnly = process.env.REMUNERATION_ONLY === "1";
  const certClaims = process.env.CERT_CLAIMS;
  const certSignature = process.env.CERT_SIGNATURE;

  const payerAccount = privateKeyToAccount(payerKey as `0x${string}`);
  const recipientAccount = privateKeyToAccount(recipientKey as `0x${string}`);

  step(1, "Load keys and clients");
  info(`payer: ${payerAccount.address}`);
  info(`recipient: ${recipientAccount.address}`);
  if (payerKey === recipientKey) {
    warn("PAYER_PRIVATE_KEY == RECIPIENT_PRIVATE_KEY (using same wallet for demo)");
  }

  const payerCfgBuilder = new ConfigBuilder().fromEnv().walletPrivateKey(payerKey);
  const recipientCfgBuilder = new ConfigBuilder().fromEnv().walletPrivateKey(recipientKey);
  if (!disableAuth && !bearerToken) {
    payerCfgBuilder.enableAuth();
    recipientCfgBuilder.enableAuth();
  }
  const payerCfg = payerCfgBuilder.build();
  const recipientCfg = recipientCfgBuilder.build();

  const payerClient = await Client.new(payerCfg);
  const recipientClient = await Client.new(recipientCfg);
  const flow = X402Flow.fromClient(payerClient);

  try {
    ok("clients ready");
    if (!disableAuth && !bearerToken) {
      info("auth enabled (SIWE login)");
      try {
        await payerClient.login();
        if (payerAccount.address !== recipientAccount.address) {
          await recipientClient.login();
        }
        ok("auth login complete");
      } catch (loginErr) {
        warn(
          `auth login failed: ${loginErr instanceof Error ? loginErr.message : String(loginErr)}`
        );
      }
    }
    const network = process.env.X402_NETWORK ?? `eip155:${payerClient.params.chainId}`;
    info(`x402 network: ${network}`);
    await pauseIfEnabled("step 1");

    if (remunerationOnly) {
      step(7, "Remuneration only");
      const cert =
        certClaims && certSignature
          ? { claims: certClaims, signature: certSignature }
          : await loadLatestCert();
      const certSource =
        certClaims && certSignature
          ? "env CERT_CLAIMS/CERT_SIGNATURE"
          : "examples/certs/latest.json";
      debugCert(`${certSource} (raw)`, cert);
      const normalized = normalizeCert(cert, certSource);
      debugCert(`${certSource} (normalized)`, normalized);
      try {
        recipientClient.recipient.verifyPaymentGuarantee(normalized);
      } catch (err) {
        throw new Error(
          `certificate verification failed (${certSource}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      const grace = await recipientClient.gateway.contract.read.remunerationGracePeriod();
      info(`remunerationGracePeriod: ${grace.toString()}s`);
      info("calling remunerate immediately (no checks)");
      const remunReceipt = await recipientClient.recipient.remunerate(normalized);
      ok(`remunerate tx: ${remunReceipt.transactionHash}`);
      return;
    }

    step(2, "Deposit 1 USDC on the core network");
    const chainId = payerClient.params.chainId;
    info(`core chainId: ${chainId}`);
    const expectedChainId = network.startsWith("eip155:")
      ? Number(network.split(":")[1])
      : Number.NaN;
    if (Number.isFinite(expectedChainId) && chainId !== expectedChainId) {
      warn(`network/core mismatch: X402_NETWORK=${network} but core chainId=${chainId}`);
    }

    const usdcAddress = (await payerClient.gateway.contract.read.USDC()) as `0x${string}`;
    info(`USDC address (from contract): ${usdcAddress}`);

    const erc20 = getContract({
      address: usdcAddress,
      abi: erc20Abi,
      client: { public: payerClient.gateway.publicClient, wallet: payerClient.gateway.walletClient },
    });
    const usdcDecimals = Number(await erc20.read.decimals());
    info(`USDC decimals: ${usdcDecimals}`);

    const depositAmount = parseUnits(depositUsdc, usdcDecimals);
    info(`deposit amount: ${formatAmount(depositAmount, usdcDecimals)}`);

    const approval = await payerClient.user.approveErc20(usdcAddress, depositAmount);
    ok(`approve tx: ${approval.transactionHash}`);

    const depositReceipt = await payerClient.user.deposit(depositAmount, usdcAddress);
    ok(`deposit tx: ${depositReceipt.transactionHash}`);
    await pauseIfEnabled("step 2");

    step(3, "Get a tab via facilitator (TTL 60s)");
    info(`facilitator: ${facilitatorUrl}`);
    info(`network: ${network}`);

    const tab = await createTabViaFacilitator({
      facilitatorUrl,
      userAddress: payerAccount.address,
      recipientAddress: recipientAccount.address,
      erc20Token: usdcAddress,
      ttlSeconds,
      network,
    });

    if (!tab.tabId) throw new Error("facilitator /tabs returned empty tabId");
    const tabId = parseBigInt(tab.tabId);
    const nextReqId = parseBigInt(tab.nextReqId);
    ok(`tabId: ${tab.tabId}`);
    info(`nextReqId: ${tab.nextReqId ?? "0"}`);
    if (tab.ttlSeconds !== undefined) info(`ttlSeconds: ${tab.ttlSeconds}`);
    await pauseIfEnabled("step 3");

    step(4, "Issue 3 guarantees via facilitator (reqId sequential)");
    const guaranteeAmounts = guaranteeAmountsRaw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (guaranteeAmounts.length < 3) {
      warn("GUARANTEE_AMOUNTS_USDC has fewer than 3 values; repeating last value");
    }

    const guarantees: GuaranteeResult[] = [];
    for (let i = 0; i < 3; i += 1) {
      const amountStr = guaranteeAmounts[Math.min(i, guaranteeAmounts.length - 1)];
      const amount = parseUnits(amountStr, usdcDecimals);
      const reqId = nextReqId + BigInt(i);
      const timestamp = Math.floor(Date.now() / 1000);

      const claims = PaymentGuaranteeRequestClaims.new(
        payerAccount.address,
        recipientAccount.address,
        tabId,
        amount,
        timestamp,
        usdcAddress,
        reqId
      );

      const signature = await payerClient.user.signPayment(claims, SigningScheme.EIP712);
      const paymentRequirements: PaymentRequirementsV1 = {
        scheme: SCHEME,
        network,
        maxAmountRequired: `0x${amount.toString(16)}`,
        payTo: recipientAccount.address,
        asset: usdcAddress,
      };
      const paymentPayload = buildPaymentPayload(claims, signature);
      const envelope = {
        x402Version: 1,
        scheme: paymentRequirements.scheme,
        network: paymentRequirements.network,
        payload: paymentPayload,
      };
      const header = Buffer.from(JSON.stringify(envelope)).toString("base64");
      const payment: X402SignedPayment = { header, payload: paymentPayload, signature };

      const settled = await flow.settlePayment(payment, paymentRequirements, facilitatorUrl);
      const settlement = settled.settlement as {
        success?: boolean;
        error?: string;
        certificate?: { claims: string; signature: string };
      };
      if (!settlement?.success || !settlement.certificate) {
        throw new Error(
          `facilitator /settle failed: ${settlement?.error ?? "missing certificate"}`
        );
      }
      debugCert("facilitator /settle certificate (raw)", settlement.certificate);
      const cert = normalizeCert(settlement.certificate, "facilitator /settle certificate");
      debugCert("facilitator /settle certificate (normalized)", cert);

      const decoded = recipientClient.recipient.verifyPaymentGuarantee(cert);
      const certPayload = {
        label: `cert-${i + 1}`,
        tabId: tab.tabId,
        reqId: reqId.toString(),
        amount: amount.toString(),
        totalAmount: decoded.totalAmount.toString(),
        timestamp: claims.timestamp,
        userAddress: claims.userAddress,
        recipientAddress: claims.recipientAddress,
        assetAddress: claims.assetAddress,
        network,
        scheme: SCHEME,
        cert,
      };
      const certPath = await saveCert(`cert-${i + 1}`, certPayload);
      await saveCert("latest", certPayload);
      guarantees.push({
        reqId,
        amount,
        cert,
        totalAmount: decoded.totalAmount,
        timestamp: claims.timestamp,
      });

      ok(
        `guarantee #${i + 1} reqId=${reqId.toString()} amount=${formatAmount(
          amount,
          usdcDecimals
        )} total=${formatAmount(decoded.totalAmount, usdcDecimals)}`
      );
      info(`cert saved: ${certPath}`);
    }

    try {
      const guaranteesList = await recipientClient.recipient.getTabGuarantees(tabId);
      ok(`core guarantees stored: ${guaranteesList.length}`);
    } catch (listErr) {
      warn(
        `could not list guarantees from core (auth may be required): ${
          listErr instanceof Error ? listErr.message : String(listErr)
        }`
      );
    }
    await pauseIfEnabled("step 4");

    step(5, "Wait for tab TTL to elapse");
    info(`sleeping ${ttlSeconds + 5}s to pass TTL`);
    await sleep((ttlSeconds + 5) * 1000);

    const tabInfo = await recipientClient.recipient.getTab(tabId);
    if (tabInfo) {
      info(`tab status: ${tabInfo.status} (settlement: ${tabInfo.settlementStatus})`);
    } else {
      warn("tab not found in core (it may have been closed or GC'd)");
    }

    if (!tabInfo || tabInfo.status !== "CLOSED") {
      warn("tab not marked CLOSED yet; requesting /tabs again to force close if expired");
      await createTabViaFacilitator({
        facilitatorUrl,
        userAddress: payerAccount.address,
        recipientAddress: recipientAccount.address,
        erc20Token: usdcAddress,
        ttlSeconds,
        network,
      });
      const refreshed = await recipientClient.recipient.getTab(tabId);
      if (refreshed) {
        info(`after refresh: tab status ${refreshed.status}`);
      }
    }
    await pauseIfEnabled("step 5");

    step(6, "Settle/pay the tab");
    const totalGuaranteed = guarantees[guarantees.length - 1]?.totalAmount ?? 0n;
    let payAmount = totalGuaranteed;
    let payAmountNote = " (total guaranteed from last guarantee)";
    if (payAmountUsdc) {
      const requestedPayAmount = parseUnits(payAmountUsdc, usdcDecimals);
      if (requestedPayAmount !== totalGuaranteed) {
        warn(
          `PAY_AMOUNT_USDC (${payAmountUsdc}) does not match total guaranteed (${formatAmount(
            totalGuaranteed,
            usdcDecimals
          )}); using the total for remuneration`
        );
      } else {
        payAmountNote = " (PAY_AMOUNT_USDC matches total)";
      }
      payAmount = totalGuaranteed;
    }
    info(`pay amount: ${formatAmount(payAmount, usdcDecimals)}${payAmountNote}`);

    const waitOptions = { timeout: 120_000 };
    info("waiting up to 120s for transaction receipts");
    let step6Complete = false;
    try {
      const payApproval = await payerClient.user.approveErc20(usdcAddress, payAmount, waitOptions);
      ok(`approve for pay tx: ${payApproval.transactionHash}`);

      const payReceipt = await payerClient.user.payTab(
        tabId,
        0n,
        payAmount,
        recipientAccount.address,
        usdcAddress,
        waitOptions
      );
      ok(`pay tx: ${payReceipt.transactionHash}`);

      const statusAfterPay = await payerClient.user.getTabPaymentStatus(tabId);
      info(
        `paid: ${formatAmount(statusAfterPay.paid, usdcDecimals)} remunerated: ${
          statusAfterPay.remunerated
        }`
      );
      info("note: paid updates after operator records TabPaid on-chain; may show 0 immediately");
      step6Complete = true;
    } catch (payErr) {
      warn(
        `step 6 pay/receipt did not confirm within 120s: ${
          payErr instanceof Error ? payErr.message : String(payErr)
        }`
      );
      warn("continuing to next step");
    }
    if (step6Complete) {
      await pauseIfEnabled("step 6");
    }

    step(7, "Call for remuneration (uses latest guarantee)");
    const last = guarantees[guarantees.length - 1];
    const grace = await recipientClient.gateway.contract.read.remunerationGracePeriod();
    const dueAt = Number(last.timestamp) + Number(grace);

    info(`remunerationGracePeriod: ${grace.toString()}s`);
    info(`guarantee timestamp: ${last.timestamp}`);
    info(`due at: ${new Date(dueAt * 1000).toISOString()}`);

    debugCert("latest guarantee (raw)", last.cert);
    const normalized = normalizeCert(last.cert, "latest guarantee");
    debugCert("latest guarantee (normalized)", normalized);
    try {
      recipientClient.recipient.verifyPaymentGuarantee(normalized);
    } catch (err) {
      throw new Error(
        `certificate verification failed (latest guarantee): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const remunReceipt = await recipientClient.recipient.remunerate(normalized);
    ok(`remunerate tx: ${remunReceipt.transactionHash}`);

    const statusAfterRemun = await payerClient.user.getTabPaymentStatus(tabId);
    info(
      `paid: ${formatAmount(statusAfterRemun.paid, usdcDecimals)} remunerated: ${
        statusAfterRemun.remunerated
      }`
    );

    ok("done");
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    await payerClient.aclose();
    await recipientClient.aclose();
  }
}

main().catch((e) => {
  err(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
