export class FourMicaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ConfigError extends FourMicaError {}
export class RpcError extends FourMicaError {
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, options?: { status?: number; body?: unknown }) {
    super(message);
    this.status = options?.status;
    this.body = options?.body;
  }
}
export class ClientInitializationError extends FourMicaError {}
export class SigningError extends FourMicaError {}
export class ContractError extends FourMicaError {}
export class VerificationError extends FourMicaError {}
export class X402Error extends FourMicaError {}
