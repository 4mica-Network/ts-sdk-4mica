import { AuthSession } from '../auth';
import type { AuthTokens } from '../auth';
import { Config } from '../config';
import { ContractGateway } from '../contract';
import { AuthMissingConfigError } from '../errors';
import { RpcProxy } from '../rpc';
import { CorePublicParameters, PaymentSigner } from '../signing';
import { RecipientClient } from './recipient';
import { UserClient } from './user';

export class Client {
  readonly rpc: RpcProxy;
  readonly params: CorePublicParameters;
  readonly gateway: ContractGateway;
  readonly guaranteeDomain: string;
  readonly user: UserClient;
  readonly recipient: RecipientClient;
  readonly signer: PaymentSigner;
  private authSession?: AuthSession;

  private constructor(
    rpc: RpcProxy,
    params: CorePublicParameters,
    gateway: ContractGateway,
    guaranteeDomain: string,
    signer: PaymentSigner,
    authSession?: AuthSession
  ) {
    this.rpc = rpc;
    this.params = params;
    this.gateway = gateway;
    this.guaranteeDomain = guaranteeDomain;
    this.signer = signer;
    this.authSession = authSession;
    this.user = new UserClient(this);
    this.recipient = new RecipientClient(this);
  }

  static async new(cfg: Config): Promise<Client> {
    const rpc = new RpcProxy(cfg.rpcUrl, cfg.adminApiKey);
    const params = await rpc.getPublicParams();
    const gateway = await Client.buildGateway(cfg, params);

    const guaranteeDomain = await gateway.getGuaranteeDomain();
    const signer = new PaymentSigner(cfg.signer);

    const authEnabled = cfg.authUrl !== undefined || cfg.authRefreshMarginSecs !== undefined;
    const authSession =
      cfg.bearerToken || !authEnabled
        ? undefined
        : new AuthSession({
            authUrl: cfg.authUrl ?? cfg.rpcUrl,
            signer: cfg.signer,
            refreshMarginSecs: cfg.authRefreshMarginSecs ?? 60,
          });

    if (cfg.bearerToken) {
      rpc.withBearerToken(cfg.bearerToken);
    } else if (authSession) {
      rpc.withTokenProvider(() => authSession.accessToken());
    }
    return new Client(rpc, params, gateway, guaranteeDomain, signer, authSession);
  }

  private static async buildGateway(
    cfg: Config,
    params: CorePublicParameters
  ): Promise<ContractGateway> {
    const ethRpcUrl = cfg.ethereumHttpRpcUrl ?? params.ethereumHttpRpcUrl;
    const contractAddress = cfg.contractAddress ?? params.contractAddress;
    return ContractGateway.create(
      ethRpcUrl,
      cfg.signer,
      contractAddress as `0x${string}`,
      params.chainId
    );
  }

  async aclose(): Promise<void> {
    await this.rpc.aclose();
  }

  async login(): Promise<AuthTokens> {
    if (!this.authSession) {
      throw new AuthMissingConfigError('auth is not enabled');
    }
    return this.authSession.login();
  }
}

export { UserClient } from './user';
export { RecipientClient } from './recipient';
