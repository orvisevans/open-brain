// Minimal `fs.promises` subset the Vault module depends on.
// Lets us swap a LightningFS instance for an in-memory shim in tests without
// dragging IndexedDB into the Node-env Vitest runner.

export interface FsStats {
  isFile(): boolean;
  isDirectory(): boolean;
  mtimeMs: number;
}

export interface FsLike {
  readFile(path: string, options: 'utf8' | { encoding: 'utf8' }): Promise<string>;
  writeFile(path: string, data: string, options?: { encoding?: 'utf8' }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, options?: { mode?: number }): Promise<void>;
  stat(path: string): Promise<FsStats>;
}
