import { getBytes } from 'ethers';
import { VerificationError } from './errors';

function splitFp(value: bigint): [Uint8Array, Uint8Array] {
  const be48 = value.toString(16).padStart(96, '0');
  const bytes = getBytes(`0x${be48}`);
  const hi = new Uint8Array(32);
  hi.set(bytes.slice(0, 16), 16);
  const lo = bytes.slice(16);
  return [hi, lo];
}

/**
 * Expand a compressed G2 signature into the tuple expected by the contract.
 * This mirrors the Python helper and requires the optional `@noble/curves` dependency.
 */
export function signatureToWords(signatureHex: string): Uint8Array[] {
  let curves: any;
  try {
    // Lazy require to keep the dependency optional.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    curves = require('@noble/curves/bls12-381');
  } catch (err) {
    throw new VerificationError(
      'BLS decoding requires @noble/curves; install it to enable remuneration'
    );
  }

  try {
    const sigBytes = getBytes(signatureHex);
    const point = curves.bls12_381.G2.ProjectivePoint.fromHex(sigBytes);
    const affine = point.toAffine();
    const [x0, x1] = affine.x.c;
    const [y0, y1] = affine.y.c;
    const coords = [x0, x1, y0, y1].map((fp: any) => BigInt(fp.value ?? fp)) as bigint[];
    const words: Uint8Array[] = [];
    coords.forEach((coord) => {
      const [hi, lo] = splitFp(coord);
      words.push(hi, lo);
    });
    return words;
  } catch (err: any) {
    throw new VerificationError(`invalid BLS signature: ${err?.message ?? String(err)}`);
  }
}
