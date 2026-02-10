import { describe, expect, it, vi } from 'vitest';
import { ContractGateway } from '../src/contract';

const DUMMY_ADDRESS = '0x0000000000000000000000000000000000000001';

type GatewayMocks = {
  gateway: ContractGateway;
  publicClient: { waitForTransactionReceipt: ReturnType<typeof vi.fn> };
  walletClient: { sendTransaction: ReturnType<typeof vi.fn>; account: { address: string } };
  contract: { write: { payTabInERC20Token: ReturnType<typeof vi.fn> } };
};

function createGateway(opts?: {
  writeImpl?: () => Promise<string>;
  sendImpl?: () => Promise<string>;
}): GatewayMocks {
  const publicClient = {
    waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => ({ hash })),
  };
  const walletClient = {
    sendTransaction: vi.fn(opts?.sendImpl ?? (async () => '0xhash')),
    account: { address: DUMMY_ADDRESS },
  };
  const contract = {
    write: {
      payTabInERC20Token: vi.fn(opts?.writeImpl ?? (async () => '0xhash')),
    },
  };

  const GatewayCtor = ContractGateway as unknown as new (
    publicClient: {
      waitForTransactionReceipt: (args: { hash: string }) => Promise<{ hash: string }>;
    },
    walletClient: { sendTransaction: () => Promise<string>; account: { address: string } },
    contract: { write: { payTabInERC20Token: () => Promise<string> } }
  ) => ContractGateway;
  const gateway = new GatewayCtor(publicClient, walletClient, contract);
  return { gateway, publicClient, walletClient, contract };
}

describe('ContractGateway transaction queue', () => {
  it('serializes contract.write calls to avoid nonce collisions', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const { gateway, contract } = createGateway({
      writeImpl: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        return '0xhash';
      },
    });

    const p1 = gateway.payTabErc20(1n, 2n, DUMMY_ADDRESS, DUMMY_ADDRESS);
    const p2 = gateway.payTabErc20(2n, 3n, DUMMY_ADDRESS, DUMMY_ADDRESS);
    await Promise.all([p1, p2]);

    expect(contract.write.payTabInERC20Token).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  it('serializes wallet sendTransaction calls', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const { gateway, walletClient } = createGateway({
      sendImpl: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        return '0xhash';
      },
    });

    const p1 = gateway.payTabEth(1n, 1n, 10n, DUMMY_ADDRESS);
    const p2 = gateway.payTabEth(2n, 2n, 10n, DUMMY_ADDRESS);
    await Promise.all([p1, p2]);

    expect(walletClient.sendTransaction).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  it('continues processing after a failed submission', async () => {
    let call = 0;
    const { gateway, contract } = createGateway({
      writeImpl: async () => {
        call += 1;
        if (call === 1) throw new Error('boom');
        return '0xhash';
      },
    });

    const p1 = gateway.payTabErc20(1n, 2n, DUMMY_ADDRESS, DUMMY_ADDRESS);
    const p2 = gateway.payTabErc20(2n, 3n, DUMMY_ADDRESS, DUMMY_ADDRESS);
    const results = await Promise.allSettled([p1, p2]);

    expect(contract.write.payTabInERC20Token).toHaveBeenCalledTimes(2);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
  });
});
