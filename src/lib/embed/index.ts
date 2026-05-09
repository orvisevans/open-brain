// Public Embedder API.

export {
  embed,
  embedBatch,
  countTokens,
  EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MAX_TOKENS,
  setEmbedderForTest,
} from './embedder';
export type { EmbedderForTest } from './embedder';

export { chunkMarkdown } from './chunk';
export type { Chunk, ChunkOptions } from './chunk';
