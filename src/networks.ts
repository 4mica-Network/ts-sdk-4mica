/** Metadata for a hosted 4Mica network deployment. */
export interface NetworkInfo {
  /** CAIP-2 network identifier (e.g. `eip155:84532`). */
  caip2: string;
  /** Hosted 4Mica core API URL for this network. */
  rpcUrl: string;
}

/**
 * Hosted 4Mica network deployments, keyed by human-readable shorthand.
 *
 * Pass the shorthand (or the CAIP-2 string) to {@link ConfigBuilder.network}
 * to select a network without writing a URL.
 *
 * @example
 * ```ts
 * import { Client, ConfigBuilder, NETWORKS } from "@4mica/sdk";
 *
 * // By shorthand
 * const cfg = new ConfigBuilder()
 *   .network("base-sepolia")
 *   .walletPrivateKey("0x...")
 *   .build();
 *
 * // Inspect available networks
 * console.log(NETWORKS["base-sepolia"].caip2); // "eip155:84532"
 * ```
 */
export const NETWORKS: Record<string, NetworkInfo> = {
  'base-sepolia': {
    caip2: 'eip155:84532',
    rpcUrl: 'https://base.sepolia.api.4mica.xyz/',
  },
  'ethereum-sepolia': {
    caip2: 'eip155:11155111',
    rpcUrl: 'https://ethereum.sepolia.api.4mica.xyz/',
  },
} as const;

const NETWORKS_BY_CAIP2: Record<string, NetworkInfo> = Object.fromEntries(
  Object.values(NETWORKS).map((n) => [n.caip2, n])
);

/**
 * Resolve a network shorthand or CAIP-2 identifier to a core API URL.
 * Returns `undefined` if the identifier is not a known hosted network.
 *
 * @example
 * ```ts
 * resolveNetworkRpcUrl("base-sepolia");   // "https://base.sepolia.api.4mica.xyz/"
 * resolveNetworkRpcUrl("eip155:84532");   // "https://base.sepolia.api.4mica.xyz/"
 * resolveNetworkRpcUrl("eip155:1");       // undefined
 * ```
 */
export function resolveNetworkRpcUrl(network: string): string | undefined {
  return NETWORKS[network]?.rpcUrl ?? NETWORKS_BY_CAIP2[network]?.rpcUrl;
}
