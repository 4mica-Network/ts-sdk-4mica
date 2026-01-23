import { Wallet } from 'ethers';
import type { FetchFn } from './rpc';
import {
  AuthApiError,
  AuthConfigError,
  AuthDecodeError,
  AuthMissingConfigError,
  AuthTransportError,
  AuthUrlError,
} from './errors';
import { ValidationError, normalizePrivateKey, validateUrl } from './utils';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type SiweTemplate = {
  domain: string;
  uri: string;
  chainId: number;
  statement: string;
  expiration: string;
  issuedAt: string;
};

export type AuthNonceResponse = {
  nonce: string;
  siwe: SiweTemplate;
};

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readString = (value: unknown, label: string): string => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  throw new AuthDecodeError(`invalid auth response: missing ${label}`);
};

const readNumber = (value: unknown, label: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new AuthDecodeError(`invalid auth response: missing ${label}`);
};

const parseTokens = (payload: RecordValue): AuthTokens => {
  const accessToken = readString(payload.access_token ?? payload.accessToken, 'access_token');
  const refreshToken = readString(payload.refresh_token ?? payload.refreshToken, 'refresh_token');
  const expiresIn = readNumber(payload.expires_in ?? payload.expiresIn, 'expires_in');
  return { accessToken, refreshToken, expiresIn };
};

const parseSiweTemplate = (payload: RecordValue): SiweTemplate => {
  const domain = readString(payload.domain, 'siwe.domain');
  const uri = readString(payload.uri, 'siwe.uri');
  const chainId = readNumber(payload.chain_id ?? payload.chainId, 'siwe.chain_id');
  const statement = readString(payload.statement, 'siwe.statement');
  const expiration = readString(payload.expiration, 'siwe.expiration');
  const issuedAt = readString(payload.issued_at ?? payload.issuedAt, 'siwe.issued_at');
  return { domain, uri, chainId, statement, expiration, issuedAt };
};

const parseNonceResponse = (payload: unknown): AuthNonceResponse => {
  if (!isRecord(payload)) {
    throw new AuthDecodeError('invalid auth response: nonce payload');
  }
  const nonce = readString(payload.nonce, 'nonce');
  if (!isRecord(payload.siwe)) {
    throw new AuthDecodeError('invalid auth response: missing siwe template');
  }
  return { nonce, siwe: parseSiweTemplate(payload.siwe) };
};

export function buildSiweMessage(input: {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number | string;
  nonce: string;
  issuedAt: string;
  expiration: string;
}): string {
  const chainId = String(input.chainId);
  return `${input.domain} wants you to sign in with your Ethereum account:\n${input.address}\n\n${input.statement}\n\nURI: ${input.uri}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expiration}`;
}

export class AuthClient {
  private baseUrl: string;
  private fetchFn: FetchFn;

  constructor(endpoint: string, fetchFn: FetchFn = fetch) {
    try {
      const validated = validateUrl(endpoint);
      this.baseUrl = validated.endsWith('/') ? validated.slice(0, -1) : validated;
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new AuthUrlError(err.message);
      }
      throw err;
    }
    this.fetchFn = fetchFn;
  }

  async getNonce(address: string): Promise<AuthNonceResponse> {
    const payload = await this.post('/auth/nonce', { address });
    return parseNonceResponse(payload);
  }

  async verify(address: string, message: string, signature: string): Promise<AuthTokens> {
    const payload = await this.post('/auth/verify', { address, message, signature });
    if (!isRecord(payload)) {
      throw new AuthDecodeError('invalid auth response: verify payload');
    }
    return parseTokens(payload);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = await this.post('/auth/refresh', { refresh_token: refreshToken });
    if (!isRecord(payload)) {
      throw new AuthDecodeError('invalid auth response: refresh payload');
    }
    return parseTokens(payload);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.post('/auth/logout', { refresh_token: refreshToken });
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new AuthTransportError(`auth request failed: ${String(err)}`);
    }

    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      throw new AuthDecodeError(`invalid response from ${response.url}: ${String(err)}`);
    }

    let payload: unknown = text;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch (err) {
        if (response.ok) {
          throw new AuthDecodeError(`invalid JSON response from ${response.url}: ${String(err)}`);
        }
      }
    } else {
      payload = null;
    }

    if (response.ok) {
      return payload;
    }

    let message = 'unknown error';
    if (payload && typeof payload === 'object') {
      const record = payload as RecordValue;
      const error = record.error;
      const msg = record.message;
      message =
        (typeof error === 'string' && error) ||
        (typeof msg === 'string' && msg) ||
        JSON.stringify(record, (_k, v) => v);
    } else if (typeof payload === 'string' && payload.trim()) {
      message = payload.trim();
    }

    throw new AuthApiError(`${response.status}: ${message}`, {
      status: response.status,
      body: payload,
    });
  }
}

export class AuthSession {
  private authClient: AuthClient;
  private wallet: Wallet;
  private refreshMarginSecs: number;
  private tokens?: { accessToken: string; refreshToken: string; expiresAt: number };
  private inFlight?: Promise<string>;
  private loginPromise?: Promise<AuthTokens>;

  constructor(options: {
    authUrl: string;
    privateKey: string;
    refreshMarginSecs?: number;
    fetchFn?: FetchFn;
  }) {
    if (!options.authUrl) {
      throw new AuthMissingConfigError('missing auth_url');
    }
    this.authClient = new AuthClient(options.authUrl, options.fetchFn);

    try {
      const normalizedKey = normalizePrivateKey(options.privateKey);
      this.wallet = new Wallet(normalizedKey);
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new AuthConfigError(err.message);
      }
      throw err;
    }

    const margin = options.refreshMarginSecs ?? 60;
    if (!Number.isFinite(margin) || margin < 0) {
      throw new AuthConfigError('refresh margin must be non-negative');
    }
    this.refreshMarginSecs = margin;
  }

  async accessToken(): Promise<string> {
    if (this.tokens && !this.isExpiringSoon()) {
      return this.tokens.accessToken;
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.refreshOrLogin();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  async login(): Promise<AuthTokens> {
    if (this.loginPromise) {
      return this.loginPromise;
    }
    this.loginPromise = this.performLogin();
    try {
      return await this.loginPromise;
    } finally {
      this.loginPromise = undefined;
    }
  }

  async logout(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      return;
    }
    await this.authClient.logout(this.tokens.refreshToken);
    this.tokens = undefined;
  }

  private async refreshOrLogin(): Promise<string> {
    if (this.tokens?.refreshToken) {
      try {
        const tokens = await this.refreshTokens();
        return tokens.accessToken;
      } catch (err) {
        if (err instanceof AuthApiError && err.status === 401) {
          const tokens = await this.login();
          return tokens.accessToken;
        }
        throw err;
      }
    }
    const tokens = await this.login();
    return tokens.accessToken;
  }

  private async performLogin(): Promise<AuthTokens> {
    const address = this.wallet.address;
    const nonce = await this.authClient.getNonce(address);
    const message = buildSiweMessage({
      domain: nonce.siwe.domain,
      address,
      statement: nonce.siwe.statement,
      uri: nonce.siwe.uri,
      chainId: nonce.siwe.chainId,
      nonce: nonce.nonce,
      issuedAt: nonce.siwe.issuedAt,
      expiration: nonce.siwe.expiration,
    });
    const signature = await this.wallet.signMessage(message);
    const tokens = await this.authClient.verify(address, message, signature);
    this.cacheTokens(tokens);
    return tokens;
  }

  private async refreshTokens(): Promise<AuthTokens> {
    if (!this.tokens?.refreshToken) {
      throw new AuthMissingConfigError('missing refresh token');
    }
    const tokens = await this.authClient.refresh(this.tokens.refreshToken);
    this.cacheTokens(tokens);
    return tokens;
  }

  private cacheTokens(tokens: AuthTokens): void {
    const now = Date.now() / 1000;
    this.tokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: now + tokens.expiresIn,
    };
  }

  private isExpiringSoon(): boolean {
    if (!this.tokens) {
      return true;
    }
    const now = Date.now() / 1000;
    return now + this.refreshMarginSecs >= this.tokens.expiresAt;
  }
}
