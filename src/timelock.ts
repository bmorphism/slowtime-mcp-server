import { HttpCachingChain, HttpChainClient, ChainInfo } from 'drand-client';
import { timelockEncrypt, timelockDecrypt, roundForTime } from 'tlock-js';
import { timeVault } from './timevault.js';

// Default to League of Entropy's Mainnet
const CHAIN_INFO: ChainInfo = {
  hash: '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce',
  public_key: '868f005eb8e6e4ca0a47c8a77ceaa5309a47978a7c71bc5cce96366b5d7a569937c529eeda66c7293784bc9402c6bc2f6c003621e75f6631788b4b46f8b91f51',
  period: 3,
  genesis_time: 1677685200,
  url: 'https://api.drand.sh'
};

export interface TimeLockData {
  id: string;
  encryptedData: string;
  roundNumber: number;
  decryptedData?: string;
}

export class TimeLockManager {
  private client: HttpChainClient;
  private timeLocks: Map<string, TimeLockData>;

  constructor() {
    this.client = new HttpCachingChain(CHAIN_INFO.url, CHAIN_INFO);
    this.timeLocks = new Map();
  }

  async encryptForInterval(data: string, intervalDurationMs: number): Promise<TimeLockData> {
    // Calculate the round number for the future time
    const futureTime = Date.now() + intervalDurationMs;
    const roundNumber = roundForTime(CHAIN_INFO, futureTime);

    // Encrypt the data
    const encryptedData = await timelockEncrypt(
      new TextEncoder().encode(data),
      roundNumber,
      this.client
    );

    const id = crypto.randomUUID();
    const timeLockData: TimeLockData = {
      id,
      encryptedData: Buffer.from(encryptedData).toString('base64'),
      roundNumber
    };

    // Store in memory and persistent storage
    this.timeLocks.set(timeLockData.id, timeLockData);
    await timeVault.storeVault({
      id,
      encryptedData: timeLockData.encryptedData,
      roundNumber,
      createdAt: Date.now(),
      intervalId: crypto.randomUUID(), // TODO: Pass actual interval ID
      metadata: JSON.stringify({
        durationMs: intervalDurationMs
      })
    });

    return timeLockData;
  }

  async attemptDecryption(id: string): Promise<string | null> {
    const timeLock = this.timeLocks.get(id);
    if (!timeLock) {
      throw new Error('TimeLock not found');
    }

    if (timeLock.decryptedData) {
      return timeLock.decryptedData;
    }

    try {
      const encryptedData = Buffer.from(timeLock.encryptedData, 'base64');
      const decrypted = await timelockDecrypt(encryptedData, this.client);
      const decryptedText = new TextDecoder().decode(decrypted);
      
      // Update both in-memory and persistent storage
      timeLock.decryptedData = decryptedText;
      this.timeLocks.set(id, timeLock);
      await timeVault.markDecrypted(id);
      
      return decryptedText;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('round not reached')) {
        return null; // Not yet decryptable
      }
      throw error;
    }
  }

  getTimeLock(id: string): TimeLockData | undefined {
    return this.timeLocks.get(id);
  }

  listTimeLocks(): TimeLockData[] {
    return Array.from(this.timeLocks.values());
  }

  // Clean up old timelocks that have been decrypted
  async cleanupDecrypted(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    // Clean up memory
    for (const [id, timeLock] of this.timeLocks.entries()) {
      if (timeLock.decryptedData) {
        this.timeLocks.delete(id);
      }
    }
    
    // Clean up persistent storage
    await timeVault.cleanup(maxAgeMs);
  }
}

// Create a singleton instance
export const timeLockManager = new TimeLockManager();
