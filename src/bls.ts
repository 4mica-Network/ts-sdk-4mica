import { toBytes } from 'viem';
import { VerificationError } from './errors';

type BlsField = { value?: string | number | bigint } | string | number | bigint;
type BlsSignatureInput =
  | string
  | Uint8Array
  | ArrayBuffer
  | ArrayLike<number>
  | { type?: string; data?: number[] }
  | { bytes?: unknown }
  | { signature?: unknown };

type BlsModule = {
  bls12_381: {
    G2: {
      ProjectivePoint?: {
        fromHex(bytes: Uint8Array): {
          toAffine(): {
            x: { c?: readonly [BlsField, BlsField]; c0?: BlsField; c1?: BlsField };
            y: { c?: readonly [BlsField, BlsField]; c0?: BlsField; c1?: BlsField };
          };
        };
      };
      Point?: {
        fromHex(bytes: Uint8Array): {
          toAffine(): {
            x: { c?: readonly [BlsField, BlsField]; c0?: BlsField; c1?: BlsField };
            y: { c?: readonly [BlsField, BlsField]; c0?: BlsField; c1?: BlsField };
          };
        };
      };
    };
  };
};

let curvesCache: BlsModule | null = null;
let curvesPromise: Promise<BlsModule> | null = null;
const DEBUG_BLS = process.env.DEBUG_BLS === '1';

function splitFp(value: bigint): [Uint8Array, Uint8Array] {
  const be48 = value.toString(16).padStart(96, '0');
  const bytes = toBytes(`0x${be48}`);
  const hi = new Uint8Array(32);
  hi.set(bytes.slice(0, 16), 16);
  const lo = bytes.slice(16);
  return [hi, lo];
}

const normalizeBlsImportError = (err: unknown): VerificationError => {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('ERR_PACKAGE_PATH_NOT_EXPORTED')) {
    return new VerificationError(
      'BLS decoding requires @noble/curves; use the .js subpath (bls12-381.js) or update the SDK.'
    );
  }
  if (message.includes('ERR_REQUIRE_ESM') || message.includes('require() of ES Module')) {
    return new VerificationError(
      'BLS decoding requires @noble/curves; ESM install detected. Use signatureToWordsAsync or run in CJS.'
    );
  }
  return new VerificationError(
    'BLS decoding requires @noble/curves; install it to enable remuneration'
  );
};

const loadCurvesSync = (): BlsModule => {
  if (curvesCache) return curvesCache;
  try {
    // Lazy require to keep the dependency optional.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    curvesCache = require('@noble/curves/bls12-381') as BlsModule;
    return curvesCache;
  } catch (err) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      curvesCache = require('@noble/curves/bls12-381.js') as BlsModule;
      return curvesCache;
    } catch (err2) {
      throw normalizeBlsImportError(err2);
    }
  }
};

const loadCurvesAsync = async (): Promise<BlsModule> => {
  if (curvesCache) return curvesCache;
  if (curvesPromise) return curvesPromise;
  curvesPromise = (async () => {
    try {
      // Try CJS first.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('@noble/curves/bls12-381') as BlsModule;
    } catch (_err) {
      try {
        const mod = (await import('@noble/curves/bls12-381.js')) as BlsModule;
        return mod;
      } catch {
        const mod = (await import('@noble/curves/bls12-381')) as BlsModule;
        return mod;
      }
    }
  })();
  curvesCache = await curvesPromise;
  return curvesCache;
};

const normalizeSignature = (input: unknown): { hex: string; bytes: Uint8Array } => {
  if (DEBUG_BLS) {
    const type =
      input && typeof input === 'object'
        ? `object(keys=${Object.keys(input as Record<string, unknown>).slice(0, 6).join(',')})`
        : typeof input;
    // eslint-disable-next-line no-console
    console.log(`  debug bls: normalizeSignature input=${type}`);
  }
  if (typeof input === 'string') {
    const raw = input.startsWith('0x') ? input.slice(2) : input;
    const bytes = toBytes(`0x${raw}`);
    return { hex: raw, bytes };
  }
  if (input instanceof Uint8Array) {
    const hex = Buffer.from(input).toString('hex');
    return { hex, bytes: input };
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
    const hex = input.toString('hex');
    return { hex, bytes: new Uint8Array(input) };
  }
  if (input instanceof ArrayBuffer) {
    const bytes = new Uint8Array(input);
    const hex = Buffer.from(bytes).toString('hex');
    return { hex, bytes };
  }
  if (ArrayBuffer.isView(input)) {
    const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const hex = Buffer.from(bytes).toString('hex');
    return { hex, bytes };
  }
  if (Array.isArray(input)) {
    const bytes = Uint8Array.from(input);
    const hex = Buffer.from(bytes).toString('hex');
    return { hex, bytes };
  }
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      const bytes = Uint8Array.from(record.data as number[]);
      const hex = Buffer.from(bytes).toString('hex');
      return { hex, bytes };
    }
    if ('bytes' in record) {
      return normalizeSignature(record.bytes);
    }
    if ('signature' in record) {
      return normalizeSignature(record.signature);
    }
  }
  const label =
    input && typeof input === 'object'
      ? `object(keys=${Object.keys(input as Record<string, unknown>).slice(0, 6).join(',')})`
      : typeof input;
  throw new VerificationError(`expected signature hex string or bytes, got ${label}`);
};

const signatureToWordsWith = (
  curves: BlsModule,
  signatureHex: BlsSignatureInput
): Uint8Array[] => {
  const toBigint = (field: BlsField): bigint => {
    if (typeof field === 'bigint' || typeof field === 'number' || typeof field === 'string') {
      return BigInt(field);
    }
    if (field && typeof field === 'object' && 'value' in field && field.value !== undefined) {
      const value = field.value;
      if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') {
        return BigInt(value);
      }
    }
    throw new VerificationError('invalid BLS field element');
  };

  const readFp2 = (value: unknown): [BlsField, BlsField] => {
    if (!value || typeof value !== 'object') {
      throw new VerificationError('invalid BLS field element');
    }
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.c) && record.c.length >= 2) {
      return [record.c[0] as BlsField, record.c[1] as BlsField];
    }
    if ('c0' in record && 'c1' in record) {
      return [record.c0 as BlsField, record.c1 as BlsField];
    }
    if (Array.isArray((record as { coeffs?: unknown }).coeffs)) {
      const coeffs = (record as { coeffs?: unknown }).coeffs as unknown[];
      if (coeffs.length >= 2) return [coeffs[0] as BlsField, coeffs[1] as BlsField];
    }
    throw new VerificationError('invalid BLS field element');
  };

  try {
    const sig = normalizeSignature(signatureHex);
    const g2 = curves.bls12_381.G2;
    const pointCtor = g2.Point ?? g2.ProjectivePoint;
    if (!pointCtor?.fromHex) {
      throw new VerificationError('unsupported @noble/curves BLS export');
    }
    let point;
    try {
      point = pointCtor.fromHex(sig.bytes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('hex string expected')) {
        point = pointCtor.fromHex(sig.hex);
      } else {
        throw err;
      }
    }
    const affine = point.toAffine();
    const [x0, x1] = readFp2(affine.x);
    const [y0, y1] = readFp2(affine.y);
    const coords = [x0, x1, y0, y1].map((fp) => toBigint(fp));
    const words: Uint8Array[] = [];
    coords.forEach((coord) => {
      const [hi, lo] = splitFp(coord);
      words.push(hi, lo);
    });
    return words;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new VerificationError(`invalid BLS signature: ${message}`);
  }
};

/**
 * Expand a compressed G2 signature into the tuple expected by the contract.
 * This mirrors the Python helper and requires the optional `@noble/curves` dependency.
 */
export function signatureToWords(signatureHex: string): Uint8Array[] {
  const curves = loadCurvesSync();
  return signatureToWordsWith(curves, signatureHex);
}

export async function signatureToWordsAsync(signatureHex: string): Promise<Uint8Array[]> {
  const curves = await loadCurvesAsync();
  return signatureToWordsWith(curves, signatureHex);
}
