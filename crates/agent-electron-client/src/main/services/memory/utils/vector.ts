/**
 * Vector Utilities
 *
 * Pure JavaScript vector operations for fallback when sqlite-vec is unavailable
 */

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Calculate Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[] | Float32Array, b: number[] | Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Normalize a vector to unit length
 */
export function normalizeVector(vector: number[] | Float32Array): number[] {
  let magnitude = 0;
  for (let i = 0; i < vector.length; i++) {
    magnitude += vector[i] * vector[i];
  }
  magnitude = Math.sqrt(magnitude);

  if (magnitude === 0) {
    return new Array(vector.length).fill(0);
  }

  const normalized: number[] = [];
  for (let i = 0; i < vector.length; i++) {
    normalized.push(vector[i] / magnitude);
  }

  return normalized;
}

/**
 * Convert Float32Array to Buffer for SQLite BLOB storage
 */
export function float32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/**
 * Convert Buffer to Float32Array from SQLite BLOB storage
 */
export function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

/**
 * Convert number array to Float32Array
 */
export function arrayToFloat32(arr: number[]): Float32Array {
  return new Float32Array(arr);
}

/**
 * Convert Float32Array to number array
 */
export function float32ToArray(arr: Float32Array): number[] {
  return Array.from(arr);
}

/**
 * Find top-K nearest neighbors by cosine similarity
 */
export function findTopK(
  query: number[] | Float32Array,
  vectors: Array<{ id: string; vector: number[] | Float32Array }>,
  k: number,
  minScore: number = 0
): Array<{ id: string; score: number }> {
  const scores: Array<{ id: string; score: number }> = [];

  for (const { id, vector } of vectors) {
    const score = cosineSimilarity(query, vector);
    if (score >= minScore) {
      scores.push({ id, score });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Return top K
  return scores.slice(0, k);
}

/**
 * Batch cosine similarity calculation
 */
export function batchCosineSimilarity(
  query: number[] | Float32Array,
  vectors: Array<number[] | Float32Array>
): number[] {
  return vectors.map(v => cosineSimilarity(query, v));
}
