import { describe, expect, it } from 'vitest';
import {
  AdminApiKeyInfo,
  AdminApiKeySecret,
  AssetBalanceInfo,
  CollateralEventInfo,
  GuaranteeInfo,
  PendingRemunerationInfo,
  RecipientPaymentInfo,
  TabInfo,
  UserSuspensionStatus,
} from '../src/models';

describe('models fromRpc', () => {
  it('parses tab info with snake_case fields', () => {
    const tab = TabInfo.fromRpc({
      tab_id: '0x10',
      user_address: '0x0000000000000000000000000000000000000001',
      recipient_address: '0x0000000000000000000000000000000000000002',
      asset_address: '0x0000000000000000000000000000000000000000',
      start_timestamp: 100,
      ttl_seconds: 60,
      status: 'OPEN',
      settlement_status: 'PENDING',
      created_at: 10,
      updated_at: 20,
    });
    expect(tab.tabId).toBe(16n);
    expect(tab.userAddress).toBe('0x0000000000000000000000000000000000000001');
  });

  it('parses guarantee info with mixed fields', () => {
    const guarantee = GuaranteeInfo.fromRpc({
      tabId: '0x1',
      req_id: '0x2',
      from_address: '0x0000000000000000000000000000000000000001',
      toAddress: '0x0000000000000000000000000000000000000002',
      asset_address: '0x0000000000000000000000000000000000000000',
      amount: '0x10',
      timestamp: 123,
    });
    expect(guarantee.tabId).toBe(1n);
    expect(guarantee.reqId).toBe(2n);
    expect(guarantee.amount).toBe(16n);
  });

  it('parses collateral event with optional ids', () => {
    const ev = CollateralEventInfo.fromRpc({
      id: '1',
      user_address: '0x0000000000000000000000000000000000000001',
      asset_address: '0x0000000000000000000000000000000000000000',
      amount: '0x2',
      event_type: 'DEPOSIT',
      created_at: 123,
    });
    expect(ev.amount).toBe(2n);
    expect(ev.tabId).toBe(null);
    expect(ev.reqId).toBe(null);
  });

  it('parses asset balance', () => {
    const balance = AssetBalanceInfo.fromRpc({
      user_address: '0x0000000000000000000000000000000000000001',
      asset_address: '0x0000000000000000000000000000000000000000',
      total: '10',
      locked: '2',
      version: 1,
      updated_at: 123,
    });
    expect(balance.total).toBe(10n);
    expect(balance.locked).toBe(2n);
  });

  it('parses pending remuneration info', () => {
    const pending = PendingRemunerationInfo.fromRpc({
      tab: {
        tab_id: '0x1',
        user_address: '0x0000000000000000000000000000000000000001',
        recipient_address: '0x0000000000000000000000000000000000000002',
        asset_address: '0x0000000000000000000000000000000000000000',
        start_timestamp: 100,
        ttl_seconds: 60,
        status: 'OPEN',
        settlement_status: 'PENDING',
        created_at: 10,
        updated_at: 20,
      },
      latest_guarantee: {
        tab_id: '0x1',
        req_id: '0x0',
        from_address: '0x0000000000000000000000000000000000000001',
        to_address: '0x0000000000000000000000000000000000000002',
        asset_address: '0x0000000000000000000000000000000000000000',
        amount: '0x5',
        timestamp: 1,
      },
    });
    expect(pending.tab.tabId).toBe(1n);
    expect(pending.latestGuarantee?.amount).toBe(5n);
  });

  it('parses recipient payment info', () => {
    const info = RecipientPaymentInfo.fromRpc({
      user_address: '0x0000000000000000000000000000000000000001',
      recipient_address: '0x0000000000000000000000000000000000000002',
      tx_hash: '0xdeadbeef',
      amount: '1',
      verified: true,
      finalized: false,
      failed: false,
      created_at: 10,
    });
    expect(info.amount).toBe(1n);
    expect(info.verified).toBe(true);
  });

  it('parses admin api key models', () => {
    const info = AdminApiKeyInfo.fromRpc({
      id: '1',
      name: 'key',
      scopes: ['read'],
      created_at: 123,
    });
    expect(info.id).toBe('1');

    const secret = AdminApiKeySecret.fromRpc({
      id: '1',
      name: 'key',
      scopes: ['read'],
      created_at: 123,
      api_key: 'secret',
    });
    expect(secret.apiKey).toBe('secret');
  });

  it('parses user suspension status', () => {
    const status = UserSuspensionStatus.fromRpc({
      user_address: '0x0000000000000000000000000000000000000001',
      suspended: true,
      updated_at: 123,
    });
    expect(status.suspended).toBe(true);
  });
});
