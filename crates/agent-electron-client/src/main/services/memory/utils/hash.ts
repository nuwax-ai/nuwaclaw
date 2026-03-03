/**
 * Hash Utilities
 *
 * SHA256 hash calculation for memory deduplication and file change detection
 */

import * as crypto from 'crypto';

/**
 * Calculate SHA256 hash of text content
 */
export function calculateHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Calculate SHA256 hash of buffer content
 */
export function calculateBufferHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Generate memory ID from content hash
 */
export function generateMemoryId(content: string): string {
  return `mem_${calculateHash(content)}`;
}

/**
 * Check if two contents have the same hash
 */
export function isContentChanged(oldContent: string, newContent: string): boolean {
  return calculateHash(oldContent) !== calculateHash(newContent);
}
