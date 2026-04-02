/**
 * Stuck detection: consecutive screenshot similarity comparison.
 *
 * Resizes screenshots to 32x32 thumbnails and compares pixel mean difference.
 * Consecutive N steps with difference < threshold = stuck.
 */

import sharp from 'sharp';

const THUMB_SIZE = 32;

export class StuckDetector {
  private threshold: number;
  private similarityThreshold: number;
  private previousThumbnails: Buffer[] = [];
  private consecutiveSimilar: number = 0;

  constructor(threshold: number = 3, similarityThreshold: number = 0.05) {
    this.threshold = threshold;
    this.similarityThreshold = similarityThreshold;
  }

  /**
   * Check if the agent is stuck by comparing the latest screenshot
   * with previous screenshots.
   *
   * @param screenshotBase64 - Base64-encoded screenshot
   * @returns { stuck, consecutiveSimilar }
   */
  async check(screenshotBase64: string): Promise<{ stuck: boolean; consecutiveSimilar: number }> {
    const thumbnail = await this.createThumbnail(screenshotBase64);

    if (this.previousThumbnails.length > 0) {
      const lastThumb = this.previousThumbnails[this.previousThumbnails.length - 1];
      const diff = this.computeDifference(thumbnail, lastThumb);

      if (diff < this.similarityThreshold) {
        this.consecutiveSimilar++;
      } else {
        this.consecutiveSimilar = 0;
      }
    }

    // Keep only threshold count of thumbnails
    this.previousThumbnails.push(thumbnail);
    if (this.previousThumbnails.length > this.threshold + 1) {
      this.previousThumbnails.shift();
    }

    return {
      stuck: this.consecutiveSimilar >= this.threshold,
      consecutiveSimilar: this.consecutiveSimilar,
    };
  }

  reset(): void {
    this.previousThumbnails = [];
    this.consecutiveSimilar = 0;
  }

  private async createThumbnail(base64: string): Promise<Buffer> {
    const buffer = Buffer.from(base64, 'base64');
    return sharp(buffer)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'fill' })
      .raw()
      .toBuffer();
  }

  private computeDifference(a: Buffer, b: Buffer): number {
    if (a.length !== b.length) return 1;

    let totalDiff = 0;
    for (let i = 0; i < a.length; i++) {
      totalDiff += Math.abs(a[i] - b[i]);
    }

    // Normalize: max per pixel channel is 255, total pixels * channels = a.length
    return totalDiff / (a.length * 255);
  }
}
