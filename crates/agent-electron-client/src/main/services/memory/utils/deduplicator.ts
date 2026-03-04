/**
 * Deduplicator Utility
 *
 * Three-layer cross-segment deduplication for extracted memories:
 * 1. SHA256 fingerprint exact match
 * 2. Text similarity (Jaccard)
 * 3. Vector similarity (optional, cosine)
 *
 * Based on specs/long-memory/long-memory.md Section 5.8
 */

import type { ExtractedMemory, DeduplicationConfig } from '../types';
import { calculateHash } from './hash';

// ==================== Text Normalization ====================

/**
 * Normalize text for fingerprint comparison
 * - Lowercase
 * - Remove punctuation
 * - Collapse whitespace
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')  // Remove non-letter/number/space (Unicode-aware)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate SHA256 fingerprint of normalized text
 */
export function calculateFingerprint(text: string): string {
  return calculateHash(normalizeText(text));
}

// ==================== Jaccard Similarity ====================

/**
 * Tokenize text into word set (supports CJK characters)
 */
function tokenize(text: string): Set<string> {
  const normalized = normalizeText(text);
  // Split on spaces for alphabetic languages
  // For CJK, also create bigrams
  const words = normalized.split(/\s+/).filter(w => w.length > 0);
  const tokens = new Set(words);

  // Add CJK bigrams for better Chinese matching
  const cjk = normalized.replace(/\s+/g, '');
  for (let i = 0; i < cjk.length - 1; i++) {
    tokens.add(cjk.slice(i, i + 2));
  }

  return tokens;
}

/**
 * Calculate Jaccard similarity between two texts
 * Returns a value between 0 and 1
 */
export function jaccardSimilarity(textA: string, textB: string): number {
  const setA = tokenize(textA);
  const setB = tokenize(textB);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection++;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ==================== Deduplication ====================

/**
 * Deduplicate extracted memories against existing texts
 *
 * Three-layer deduplication:
 * 1. Exact fingerprint match (SHA256 of normalized text)
 * 2. Text similarity (Jaccard > threshold)
 * 3. Vector similarity (optional, not implemented here — handled by caller if needed)
 *
 * @param candidates - Newly extracted memory candidates
 * @param existingTexts - Texts of existing memories to check against
 * @param config - Deduplication config with thresholds
 * @returns Deduplicated candidates (duplicates removed)
 */
export function deduplicateMemories(
  candidates: ExtractedMemory[],
  existingTexts: string[],
  config: DeduplicationConfig
): ExtractedMemory[] {
  if (candidates.length === 0) return [];

  // Build fingerprint set from existing memories
  const existingFingerprints = new Set(
    existingTexts.map(text => calculateFingerprint(text))
  );

  const result: ExtractedMemory[] = [];
  const acceptedTexts: string[] = [...existingTexts];

  for (const candidate of candidates) {
    // Layer 1: Exact fingerprint match
    const fingerprint = calculateFingerprint(candidate.text);
    if (existingFingerprints.has(fingerprint)) {
      continue; // Skip exact duplicate
    }

    // Layer 2: Text similarity check
    let isDuplicate = false;
    for (const existingText of acceptedTexts) {
      const similarity = jaccardSimilarity(candidate.text, existingText);
      if (similarity > config.textSimilarityThreshold) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      continue; // Skip near-duplicate
    }

    // Passed all checks — accept this candidate
    result.push(candidate);
    acceptedTexts.push(candidate.text);
    existingFingerprints.add(fingerprint);
  }

  return result;
}

/**
 * Deduplicate within a batch of candidates (self-dedup)
 * Useful when processing multiple segments that may produce overlapping results
 */
export function deduplicateWithinBatch(
  candidates: ExtractedMemory[],
  config: DeduplicationConfig
): ExtractedMemory[] {
  return deduplicateMemories(candidates, [], config);
}
