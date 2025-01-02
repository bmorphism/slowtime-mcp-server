import { randomBytes } from 'crypto';

/**
 * Time fuzzing utilities to prevent timing attacks and add randomness to intervals
 */
export class TimeFuzz {
  // Constants for fuzzing ranges (in milliseconds)
  private static readonly MIN_FUZZ = 100; // Minimum fuzz amount
  private static readonly MAX_FUZZ = 5000; // Maximum fuzz amount
  private static readonly DEFAULT_ENTROPY_BYTES = 4; // Number of bytes to use for entropy

  /**
   * Generate cryptographically secure random number within a range
   */
  private static getSecureRandom(min: number, max: number): number {
    // Get 4 bytes of randomness
    const rand = randomBytes(this.DEFAULT_ENTROPY_BYTES);
    // Convert to 32-bit unsigned integer
    const num = rand.readUInt32BE(0);
    // Scale to our range
    return min + (num % (max - min));
  }

  /**
   * Add random fuzzing to a time duration
   * Returns the fuzzed duration in milliseconds
   */
  static fuzzDuration(durationMs: number): number {
    // Generate random fuzz amount
    const fuzzAmount = this.getSecureRandom(this.MIN_FUZZ, this.MAX_FUZZ);
    
    // 50% chance to add or subtract the fuzz
    const addFuzz = (randomBytes(1)[0] & 1) === 1;
    
    if (addFuzz) {
      return durationMs + fuzzAmount;
    } else {
      // Don't let duration go below minimum fuzz amount
      return Math.max(this.MIN_FUZZ, durationMs - fuzzAmount);
    }
  }

  /**
   * Compare two time values in constant time to prevent timing attacks
   */
  static timingSafeEqual(a: number, b: number): boolean {
    // Convert numbers to buffers for constant-time comparison
    const aBuf = Buffer.alloc(8);
    const bBuf = Buffer.alloc(8);
    aBuf.writeBigInt64BE(BigInt(a));
    bBuf.writeBigInt64BE(BigInt(b));
    
    // Use crypto's timing safe comparison
    try {
      return require('crypto').timingSafeEqual(aBuf, bBuf);
    } catch {
      // Fallback constant-time comparison if crypto not available
      let result = 0;
      for (let i = 0; i < aBuf.length; i++) {
        result |= aBuf[i] ^ bBuf[i];
      }
      return result === 0;
    }
  }

  /**
   * Generate a random delay between min and max milliseconds
   */
  static async randomDelay(minMs: number = this.MIN_FUZZ, maxMs: number = this.MAX_FUZZ): Promise<void> {
    const delay = this.getSecureRandom(minMs, maxMs);
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Add jitter to a timestamp to prevent timing correlation
   */
  static addJitter(timestamp: number): number {
    const jitterMs = this.getSecureRandom(-this.MAX_FUZZ, this.MAX_FUZZ);
    return timestamp + jitterMs;
  }
}
