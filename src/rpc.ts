import { CorePublicParameters } from "./signing";
import { RpcError } from "./errors";

const ADMIN_API_KEY_HEADER = "x-api-key";

export type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

function serializeTabId(tabId: number | bigint): string {
  return `0x${BigInt(tabId).toString(16)}`;
}

export class RpcProxy {
  private baseUrl: string;
  private adminApiKey?: string;
  private fetchFn: FetchFn;

  constructor(endpoint: string, adminApiKey?: string, fetchFn: FetchFn = fetch) {
    this.baseUrl = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
    this.adminApiKey = adminApiKey;
    this.fetchFn = fetchFn;
  }

  async aclose(): Promise<void> {
    // no-op for symmetry with Python SDK
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.adminApiKey) {
      headers[ADMIN_API_KEY_HEADER] = this.adminApiKey;
    }
    return headers;
  }

  private async decode(response: Response): Promise<any> {
    let payload: any;
    try {
      payload = await response.json();
    } catch (err) {
      if (response.ok) {
        throw new RpcError(
          `invalid JSON response from ${response.url}: ${String(err)}`
        );
      }
      payload = await response.text();
    }

    if (response.ok) {
      return payload;
    }

    let message = "unknown error";
    if (payload && typeof payload === "object") {
      message =
        payload.error ??
        payload.message ??
        JSON.stringify(payload, (_k, v) => v);
    } else if (typeof payload === "string" && payload.trim()) {
      message = payload.trim();
    }
    throw new RpcError(`${response.status}: ${message}`);
  }

  private async get(path: string): Promise<any> {
    const resp = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: this.headers(),
      method: "GET",
    });
    return this.decode(resp);
  }

  private async post(path: string, body: any): Promise<any> {
    const resp = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: { "content-type": "application/json", ...this.headers() },
      method: "POST",
      body: JSON.stringify(body),
    });
    return this.decode(resp);
  }

  async getPublicParams(): Promise<CorePublicParameters> {
    const data = await this.get("/core/public-params");
    return CorePublicParameters.fromRpc(data);
  }

  async issueGuarantee(body: Record<string, any>): Promise<any> {
    return this.post("/core/guarantees", body);
  }

  async createPaymentTab(body: Record<string, any>): Promise<any> {
    return this.post("/core/payment-tabs", body);
  }

  async listSettledTabs(recipientAddress: string): Promise<any[]> {
    return this.get(`/core/recipients/${recipientAddress}/settled-tabs`);
  }

  async listPendingRemunerations(recipientAddress: string): Promise<any[]> {
    return this.get(`/core/recipients/${recipientAddress}/pending-remunerations`);
  }

  async getTab(tabId: number | bigint): Promise<any> {
    return this.get(`/core/tabs/${serializeTabId(tabId)}`);
  }

  async listRecipientTabs(
    recipientAddress: string,
    settlementStatuses?: string[]
  ): Promise<any[]> {
    let query = "";
    if (settlementStatuses?.length) {
      query =
        "?" +
        settlementStatuses
          .map((s) => `settlementStatus=${encodeURIComponent(s)}`)
          .join("&");
    }
    return this.get(`/core/recipients/${recipientAddress}/tabs${query}`);
  }

  async getTabGuarantees(tabId: number | bigint): Promise<any[]> {
    return this.get(`/core/tabs/${serializeTabId(tabId)}/guarantees`);
  }

  async getLatestGuarantee(tabId: number | bigint): Promise<any> {
    return this.get(`/core/tabs/${serializeTabId(tabId)}/guarantees/latest`);
  }

  async getGuarantee(tabId: number | bigint, reqId: number | bigint): Promise<any> {
    return this.get(`/core/tabs/${serializeTabId(tabId)}/guarantees/${reqId}`);
  }

  async listRecipientPayments(recipientAddress: string): Promise<any[]> {
    return this.get(`/core/recipients/${recipientAddress}/payments`);
  }

  async getCollateralEventsForTab(tabId: number | bigint): Promise<any[]> {
    return this.get(`/core/tabs/${serializeTabId(tabId)}/collateral-events`);
  }

  async getUserAssetBalance(userAddress: string, assetAddress: string): Promise<any> {
    return this.get(`/core/users/${userAddress}/assets/${assetAddress}`);
  }

  async updateUserSuspension(
    userAddress: string,
    suspended: boolean
  ): Promise<any> {
    return this.post(`/core/users/${userAddress}/suspension`, { suspended });
  }

  async createAdminApiKey(body: Record<string, any>): Promise<any> {
    return this.post("/core/admin/api-keys", body);
  }

  async listAdminApiKeys(): Promise<any[]> {
    return this.get("/core/admin/api-keys");
  }

  async revokeAdminApiKey(keyId: string): Promise<any> {
    return this.post(`/core/admin/api-keys/${keyId}/revoke`, {});
  }
}
