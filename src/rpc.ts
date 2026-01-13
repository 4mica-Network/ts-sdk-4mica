import {
  ADMIN_API_KEY_HEADER,
  AdminApiKeyInfo,
  AdminApiKeySecret,
  UserSuspensionStatus,
} from './models';
import { CorePublicParameters } from './signing';
import { RpcError } from './errors';

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function serializeTabId(tabId: number | bigint): string {
  return `0x${BigInt(tabId).toString(16)}`;
}

export class RpcProxy {
  private baseUrl: string;
  private adminApiKey?: string;
  private fetchFn: FetchFn;

  constructor(endpoint: string, adminApiKey?: string, fetchFn: FetchFn = fetch) {
    this.baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
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

  private async decode<T>(response: Response): Promise<T> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      if (response.ok) {
        throw new RpcError(`invalid JSON response from ${response.url}: ${String(err)}`);
      }
      payload = await response.text();
    }

    if (response.ok) {
      return payload as T;
    }

    let message = 'unknown error';
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const error = record.error;
      const msg = record.message;
      message =
        (typeof error === 'string' && error) ||
        (typeof msg === 'string' && msg) ||
        JSON.stringify(record, (_k, v) => v);
    } else if (typeof payload === 'string' && payload.trim()) {
      message = payload.trim();
    }
    throw new RpcError(`${response.status}: ${message}`, {
      status: response.status,
      body: payload,
    });
  }

  private async get<T>(path: string): Promise<T> {
    const resp = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: this.headers(),
      method: 'GET',
    });
    return this.decode<T>(resp);
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const resp = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: { 'content-type': 'application/json', ...this.headers() },
      method: 'POST',
      body: JSON.stringify(body),
    });
    return this.decode<T>(resp);
  }

  async getPublicParams(): Promise<CorePublicParameters> {
    const data = await this.get<Record<string, unknown>>('/core/public-params');
    return CorePublicParameters.fromRpc(data);
  }

  async issueGuarantee(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>('/core/guarantees', body);
  }

  async createPaymentTab(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>('/core/payment-tabs', body);
  }

  async listSettledTabs(recipientAddress: string): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>(`/core/recipients/${recipientAddress}/settled-tabs`);
  }

  async listPendingRemunerations(recipientAddress: string): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>(
      `/core/recipients/${recipientAddress}/pending-remunerations`
    );
  }

  async getTab(tabId: number | bigint): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown> | null>(`/core/tabs/${serializeTabId(tabId)}`);
  }

  async listRecipientTabs(
    recipientAddress: string,
    settlementStatuses?: string[]
  ): Promise<Record<string, unknown>[]> {
    let query = '';
    if (settlementStatuses?.length) {
      query =
        '?' + settlementStatuses.map((s) => `settlement_status=${encodeURIComponent(s)}`).join('&');
    }
    return this.get<Record<string, unknown>[]>(`/core/recipients/${recipientAddress}/tabs${query}`);
  }

  async getTabGuarantees(tabId: number | bigint): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>(`/core/tabs/${serializeTabId(tabId)}/guarantees`);
  }

  async getLatestGuarantee(tabId: number | bigint): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown> | null>(
      `/core/tabs/${serializeTabId(tabId)}/guarantees/latest`
    );
  }

  async getGuarantee(
    tabId: number | bigint,
    reqId: number | bigint
  ): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown> | null>(
      `/core/tabs/${serializeTabId(tabId)}/guarantees/${reqId}`
    );
  }

  async listRecipientPayments(recipientAddress: string): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>(`/core/recipients/${recipientAddress}/payments`);
  }

  async getCollateralEventsForTab(tabId: number | bigint): Promise<Record<string, unknown>[]> {
    return this.get<Record<string, unknown>[]>(
      `/core/tabs/${serializeTabId(tabId)}/collateral-events`
    );
  }

  async getUserAssetBalance(
    userAddress: string,
    assetAddress: string
  ): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown> | null>(
      `/core/users/${userAddress}/assets/${assetAddress}`
    );
  }

  async updateUserSuspension(
    userAddress: string,
    suspended: boolean
  ): Promise<UserSuspensionStatus> {
    const data = await this.post<Record<string, unknown>>(`/core/users/${userAddress}/suspension`, {
      suspended,
    });
    return UserSuspensionStatus.fromRpc(data);
  }

  async createAdminApiKey(body: Record<string, unknown>): Promise<AdminApiKeySecret> {
    const data = await this.post<Record<string, unknown>>('/core/admin/api-keys', body);
    return AdminApiKeySecret.fromRpc(data);
  }

  async listAdminApiKeys(): Promise<AdminApiKeyInfo[]> {
    const data = await this.get<Record<string, unknown>[]>('/core/admin/api-keys');
    return data.map((entry) => AdminApiKeyInfo.fromRpc(entry));
  }

  async revokeAdminApiKey(keyId: string): Promise<AdminApiKeyInfo> {
    const data = await this.post<Record<string, unknown>>(
      `/core/admin/api-keys/${keyId}/revoke`,
      {}
    );
    return AdminApiKeyInfo.fromRpc(data);
  }
}
