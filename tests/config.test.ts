import { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ConfigBuilder } from '../src/config';
import { ConfigError } from '../src/errors';

describe('ConfigBuilder', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env['4MICA_RPC_URL'];
    delete process.env['4MICA_WALLET_PRIVATE_KEY'];
    delete process.env['4MICA_ETHEREUM_HTTP_RPC_URL'];
    delete process.env['4MICA_CONTRACT_ADDRESS'];
    delete process.env['4MICA_ADMIN_API_KEY'];
    delete process.env['4MICA_AUTH_URL'];
    delete process.env['4MICA_AUTH_REFRESH_MARGIN_SECS'];
    delete process.env['4MICA_BEARER_TOKEN'];
  });

  it('reads from env', () => {
    process.env['4MICA_RPC_URL'] = 'https://example.com';
    process.env['4MICA_WALLET_PRIVATE_KEY'] = '11'.repeat(32);
    const address = privateKeyToAccount(('0x' + '11'.repeat(32)) as Hex).address;

    const cfg = new ConfigBuilder().fromEnv().build();
    expect(cfg.rpcUrl).toBe('https://example.com');
    expect(cfg.signer.address).toBe(address);
  });

  it('requires private key', () => {
    delete process.env['4MICA_WALLET_PRIVATE_KEY'];
    const builder = new ConfigBuilder().fromEnv();
    expect(() => builder.build()).toThrow(ConfigError);
  });

  it('rejects invalid private key', () => {
    const builder = new ConfigBuilder().walletPrivateKey('0x1234');
    expect(() => builder.build()).toThrow(ConfigError);
  });

  it('reads auth env defaults', () => {
    process.env['4MICA_RPC_URL'] = 'https://example.com';
    process.env['4MICA_WALLET_PRIVATE_KEY'] = '11'.repeat(32);
    process.env['4MICA_AUTH_REFRESH_MARGIN_SECS'] = '90';
    const cfg = new ConfigBuilder().fromEnv().build();
    expect(cfg.authUrl).toBe('https://example.com');
    expect(cfg.authRefreshMarginSecs).toBe(90);
  });

  it('reads bearer token', () => {
    process.env['4MICA_RPC_URL'] = 'https://example.com';
    process.env['4MICA_WALLET_PRIVATE_KEY'] = '11'.repeat(32);
    process.env['4MICA_BEARER_TOKEN'] = 'token';
    const cfg = new ConfigBuilder().fromEnv().build();
    expect(cfg.bearerToken).toBe('token');
  });
});
