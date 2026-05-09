// Sidecar read/write — wraps the Vault to translate sidecar paths and
// (de)serialise the on-disk format.
//
// All callers go through `readSidecar(notePath)` / `writeSidecar(sidecar)` —
// they take a `NotePath` (the source note's path) and the storage knows
// where to put the sidecar (`.memory/<note>`). Tests inject a vault built
// over an in-memory FsLike.

import { logError } from '$lib/log';
import type { NotePath } from '$lib/vault/types';

import { isSidecarFresh } from './hash';
import {
  noteToSidecarPath,
  parseSidecar,
  SidecarParseError,
  serializeSidecar,
} from './sidecar-format';
import type { Sidecar } from './types';

export interface SidecarVault {
  readRaw(path: NotePath): Promise<string>;
  writeNote(path: NotePath, content: string): Promise<void>;
}

export async function readSidecar(
  vault: SidecarVault,
  notePath: NotePath,
): Promise<Sidecar | undefined> {
  const sidecarPath = noteToSidecarPath(notePath);
  let raw: string;
  try {
    raw = await vault.readRaw(sidecarPath);
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    logError('memory/read-sidecar', { notePath, error });
    throw error;
  }
  try {
    return parseSidecar(raw);
  } catch (error: unknown) {
    if (error instanceof SidecarParseError) {
      // Treat unparseable sidecars as missing — the queue will regenerate.
      logError('memory/parse-sidecar', { notePath, message: error.message });
      return undefined;
    }
    throw error;
  }
}

export async function writeSidecar(vault: SidecarVault, sidecar: Sidecar): Promise<void> {
  const sidecarPath = noteToSidecarPath(sidecar.source);
  const content = serializeSidecar(sidecar);
  await vault.writeNote(sidecarPath, content);
}

/**
 * Convenience: returns true if a sidecar exists AND its source_hash matches
 * the current note hash. Used by the embedding queue to skip up-to-date notes.
 */
export async function isUpToDate(
  vault: SidecarVault,
  notePath: NotePath,
  noteHash: string,
): Promise<boolean> {
  const sidecar = await readSidecar(vault, notePath);
  if (sidecar === undefined) return false;
  return isSidecarFresh(noteHash, sidecar);
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code === 'ENOENT';
}
