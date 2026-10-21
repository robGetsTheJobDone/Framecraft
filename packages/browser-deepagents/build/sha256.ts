import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Actual SHA-256 used by Deep Agents' content-addressed binary offload. */
export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Unsupported browser digest: ${algorithm}`);
  const digest = sha256.create();
  return {
    update(bytes: Uint8Array) { digest.update(bytes); return this; },
    digest(encoding: string) {
      if (encoding !== 'hex') throw new Error(`Unsupported digest encoding: ${encoding}`);
      return bytesToHex(digest.digest());
    },
  };
}
