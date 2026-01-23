import { ConfigError } from './errors';
import { ValidationError, normalizeAddress, normalizePrivateKey, validateUrl } from './utils';

export interface Config {
  rpcUrl: string;
  walletPrivateKey: string;
  ethereumHttpRpcUrl?: string;
  contractAddress?: string;
  adminApiKey?: string;
  bearerToken?: string;
  authUrl?: string;
  authRefreshMarginSecs?: number;
}

export class ConfigBuilder {
  private _rpcUrl: string | undefined = 'http://127.0.0.1:3000';
  private _walletPrivateKey: string | undefined;
  private _ethereumHttpRpcUrl?: string;
  private _contractAddress?: string;
  private _adminApiKey?: string;
  private _bearerToken?: string;
  private _authEnabled = false;
  private _authUrl?: string;
  private _authRefreshMarginSecs?: number;

  rpcUrl(value: string): ConfigBuilder {
    this._rpcUrl = value;
    return this;
  }

  walletPrivateKey(value: string): ConfigBuilder {
    this._walletPrivateKey = value;
    return this;
  }

  ethereumHttpRpcUrl(value: string): ConfigBuilder {
    this._ethereumHttpRpcUrl = value;
    return this;
  }

  contractAddress(value: string): ConfigBuilder {
    this._contractAddress = value;
    return this;
  }

  adminApiKey(value: string): ConfigBuilder {
    this._adminApiKey = value;
    return this;
  }

  bearerToken(value: string): ConfigBuilder {
    this._bearerToken = value;
    return this;
  }

  enableAuth(): ConfigBuilder {
    this._authEnabled = true;
    return this;
  }

  authUrl(value: string): ConfigBuilder {
    this._authUrl = value;
    this._authEnabled = true;
    return this;
  }

  authRefreshMarginSecs(value: number): ConfigBuilder {
    this._authRefreshMarginSecs = value;
    this._authEnabled = true;
    return this;
  }

  fromEnv(): ConfigBuilder {
    const env = process.env;
    if (env['4MICA_RPC_URL']) this._rpcUrl = env['4MICA_RPC_URL'];
    if (env['4MICA_WALLET_PRIVATE_KEY']) this._walletPrivateKey = env['4MICA_WALLET_PRIVATE_KEY'];
    if (env['4MICA_ETHEREUM_HTTP_RPC_URL'])
      this._ethereumHttpRpcUrl = env['4MICA_ETHEREUM_HTTP_RPC_URL'];
    if (env['4MICA_CONTRACT_ADDRESS']) this._contractAddress = env['4MICA_CONTRACT_ADDRESS'];
    if (env['4MICA_ADMIN_API_KEY']) this._adminApiKey = env['4MICA_ADMIN_API_KEY'];
    if (env['4MICA_BEARER_TOKEN']) this._bearerToken = env['4MICA_BEARER_TOKEN'];
    if (env['4MICA_AUTH_URL']) {
      this._authUrl = env['4MICA_AUTH_URL'];
      this._authEnabled = true;
    }
    if (env['4MICA_AUTH_REFRESH_MARGIN_SECS']) {
      this._authRefreshMarginSecs = Number(env['4MICA_AUTH_REFRESH_MARGIN_SECS']);
      this._authEnabled = true;
    }
    return this;
  }

  build(): Config {
    if (!this._walletPrivateKey) {
      throw new ConfigError('missing wallet_private_key');
    }
    if (!this._rpcUrl) {
      throw new ConfigError('missing rpc_url');
    }

    try {
      const rpcUrl = validateUrl(this._rpcUrl);
      const walletPrivateKey = normalizePrivateKey(this._walletPrivateKey);
      const ethereumHttpRpcUrl = this._ethereumHttpRpcUrl
        ? validateUrl(this._ethereumHttpRpcUrl)
        : undefined;
      const contractAddress = this._contractAddress
        ? normalizeAddress(this._contractAddress)
        : undefined;
      const authUrl = this._authUrl ? validateUrl(this._authUrl) : undefined;
      const refreshMargin =
        this._authRefreshMarginSecs !== undefined ? this._authRefreshMarginSecs : 60;
      if (!Number.isFinite(refreshMargin) || refreshMargin < 0) {
        throw new ValidationError('invalid auth refresh margin');
      }
      const authEnabled = this._authEnabled;

      return {
        rpcUrl,
        walletPrivateKey,
        ethereumHttpRpcUrl,
        contractAddress,
        adminApiKey: this._adminApiKey,
        bearerToken: this._bearerToken,
        authUrl: authEnabled ? authUrl ?? rpcUrl : undefined,
        authRefreshMarginSecs: authEnabled ? refreshMargin : undefined,
      };
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new ConfigError(err.message);
      }
      throw err;
    }
  }
}
