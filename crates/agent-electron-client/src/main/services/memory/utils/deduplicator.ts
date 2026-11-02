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
 * For duplicates against existingTexts (from DB): always discard the candidate.
 * For duplicates within the current batch: keep the one with higher confidence.
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

  // Build fingerprint set from existing memories (DB source)
  const existingFingerprints = new Set(
    existingTexts.map(text => calculateFingerprint(text))
  );

  // Track accepted candidates with their fingerprints for intra-batch dedup
  const acceptedCandidates: ExtractedMemory[] = [];
  const acceptedFingerprints = new Set<string>();
  // Map from fingerprint to index in acceptedCandidates for efficient lookup
  const fingerprintToIndex = new Map<string, number>();

  for (const candidate of candidates) {
    // Layer 1: Exact fingerprint match against DB
    const fingerprint = calculateFingerprint(candidate.text);
    if (existingFingerprints.has(fingerprint)) {
      continue; // Skip exact duplicate of DB entry
    }

    // Layer 2: Text similarity check against DB entries
    let isDuplicateOfExisting = false;
    for (const existingText of existingTexts) {
      const similarity = jaccardSimilarity(candidate.text, existingText);
      if (similarity > config.textSimilarityThreshold) {
        isDuplicateOfExisting = true;
        break;
      }
    }
    if (isDuplicateOfExisting) {
      continue; // Skip near-duplicate of DB entry
    }

    // Layer 1b: Exact fingerprint match within batch
    if (acceptedFingerprints.has(fingerprint)) {
      // Find the existing batch entry and compare confidence
      const idx = fingerprintToIndex.get(fingerprint)!;
      if (candidate.confidence > acceptedCandidates[idx].confidence) {
        acceptedCandidates[idx] = candidate; // Replace with higher confidence
      }
      continue;
    }

    // Layer 2b: Text similarity check within batch (compare confidence)
    let batchDuplicateIdx = -1;
    for (let i = 0; i < acceptedCandidates.length; i++) {
      const similarity = jaccardSimilarity(candidate.text, acceptedCandidates[i].text);
      if (similarity > config.textSimilarityThreshold) {
        batchDuplicateIdx = i;
        break;
      }
    }

    if (batchDuplicateIdx >= 0) {
      // Keep the one with higher confidence
      if (candidate.confidence > acceptedCandidates[batchDuplicateIdx].confidence) {
        acceptedCandidates[batchDuplicateIdx] = candidate;
      }
      continue;
    }

    // Passed all checks — accept this candidate
    const idx = acceptedCandidates.length;
    acceptedCandidates.push(candidate);
    acceptedFingerprints.add(fingerprint);
    fingerprintToIndex.set(fingerprint, idx);
  }

  return acceptedCandidates;
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
