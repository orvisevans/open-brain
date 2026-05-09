// SHA-256 hashing + sidecar freshness check.
//
// We use Web Crypto's `subtle.digest('SHA-256', ...)` to keep the dependency
// surface minimal. The same API exists on Node's `globalThis.crypto.subtle`
// (since Node 18) so the function works in both browser and Vitest contexts.

import type { Sidecar } from './types';
import { SIDECAR_SCHEMA_VERSION } from './types';

/**
 * Hash a string with SHA-256 and return its hex representation.
 */
export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(content));
  return bufferToHex(buffer);
}

/**
 * A sidecar is "fresh" if it points at the current note hash and uses the
 * current schema version. Anything else is stale and must be regenerated.
 */
export function isSidecarFresh(noteHash: string, sidecar: Sidecar): boolean {
  if (sidecar.schemaVersion !== SIDECAR_SCHEMA_VERSION) return false;
  return sidecar.sourceHash === noteHash;
}

function bufferToHex(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let out = '';
  for (const byte of view) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
