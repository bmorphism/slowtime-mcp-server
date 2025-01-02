import { AsyncDuckDB, DuckDBConfig } from '@duckdb/duckdb-wasm';
import * as duckdb from '@duckdb/duckdb-wasm';

export interface TimeVaultEntry {
  id: string;
  encryptedData: string;
  roundNumber: number;
  createdAt: number;
  decryptedAt?: number;
  intervalId: string;
  metadata?: string;
}

export class TimeVault {
  private db: AsyncDuckDB | null = null;
  private initialized = false;

  private async initDB() {
    if (this.initialized) return;

    // Initialize the DuckDB WASM instance
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger();
    const config: DuckDBConfig = {
      mainModule: bundle.mainModule,
      mainWorker: worker,
      logger: logger,
    };

    this.db = new AsyncDuckDB(config);
    await this.db.instantiate();

    // Create tables if they don't exist
    const conn = await this.db.connect();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS timevaults (
        id VARCHAR PRIMARY KEY,
        encrypted_data TEXT NOT NULL,
        round_number BIGINT NOT NULL,
        created_at TIMESTAMP NOT NULL,
        decrypted_at TIMESTAMP,
        interval_id VARCHAR NOT NULL,
        metadata JSON
      );

      CREATE INDEX IF NOT EXISTS idx_interval_id ON timevaults(interval_id);
      CREATE INDEX IF NOT EXISTS idx_created_at ON timevaults(created_at);
    `);
    await conn.close();

    this.initialized = true;
  }

  async storeVault(entry: TimeVaultEntry): Promise<void> {
    await this.initDB();
    const conn = await this.db!.connect();

    try {
      await conn.query(`
        INSERT INTO timevaults (
          id, encrypted_data, round_number, created_at, 
          interval_id, metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6
        )
      `, [
        entry.id,
        entry.encryptedData,
        entry.roundNumber,
        new Date(entry.createdAt).toISOString(),
        entry.intervalId,
        entry.metadata || null
      ]);
    } finally {
      await conn.close();
    }
  }

  async markDecrypted(id: string): Promise<void> {
    await this.initDB();
    const conn = await this.db!.connect();

    try {
      await conn.query(`
        UPDATE timevaults 
        SET decrypted_at = $1
        WHERE id = $2
      `, [new Date().toISOString(), id]);
    } finally {
      await conn.close();
    }
  }

  async getVault(id: string): Promise<TimeVaultEntry | null> {
    await this.initDB();
    const conn = await this.db!.connect();

    try {
      const result = await conn.query(`
        SELECT 
          id,
          encrypted_data as encryptedData,
          round_number as roundNumber,
          EXTRACT(EPOCH FROM created_at) * 1000 as createdAt,
          CASE 
            WHEN decrypted_at IS NOT NULL 
            THEN EXTRACT(EPOCH FROM decrypted_at) * 1000 
          END as decryptedAt,
          interval_id as intervalId,
          metadata
        FROM timevaults 
        WHERE id = $1
      `, [id]);

      if (result.length === 0) return null;
      return result[0] as TimeVaultEntry;
    } finally {
      await conn.close();
    }
  }

  async listVaults(options: {
    intervalId?: string;
    decryptedOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<TimeVaultEntry[]> {
    await this.initDB();
    const conn = await this.db!.connect();

    try {
      let query = `
        SELECT 
          id,
          encrypted_data as encryptedData,
          round_number as roundNumber,
          EXTRACT(EPOCH FROM created_at) * 1000 as createdAt,
          CASE 
            WHEN decrypted_at IS NOT NULL 
            THEN EXTRACT(EPOCH FROM decrypted_at) * 1000 
          END as decryptedAt,
          interval_id as intervalId,
          metadata
        FROM timevaults
        WHERE 1=1
      `;

      const params: any[] = [];
      let paramIndex = 1;

      if (options.intervalId) {
        query += ` AND interval_id = $${paramIndex++}`;
        params.push(options.intervalId);
      }

      if (options.decryptedOnly) {
        query += ` AND decrypted_at IS NOT NULL`;
      }

      query += ` ORDER BY created_at DESC`;

      if (options.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(options.limit);
      }

      if (options.offset) {
        query += ` OFFSET $${paramIndex++}`;
        params.push(options.offset);
      }

      const result = await conn.query(query, params);
      return result as TimeVaultEntry[];
    } finally {
      await conn.close();
    }
  }

  async getStats(): Promise<{
    totalVaults: number;
    decryptedVaults: number;
    avgDecryptionTime?: number;
  }> {
    await this.initDB();
    const conn = await this.db!.connect();

    try {
      const result = await conn.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(decrypted_at) as decrypted,
          AVG(
            CASE 
              WHEN decrypted_at IS NOT NULL 
              THEN EXTRACT(EPOCH FROM (decrypted_at - created_at))
            END
          ) as avg_time
        FROM timevaults
      `);

      return {
        totalVaults: Number(result[0].total),
        decryptedVaults: Number(result[0].decrypted),
        avgDecryptionTime: result[0].avg_time ? Number(result[0].avg_time) : undefined
      };
    } finally {
      await conn.close();
    }
  }

  async cleanup(maxAgeMs: number): Promise<void> {
    await this.initDB();
    const conn = await this.db!.connect();

    try {
      const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
      await conn.query(`
        DELETE FROM timevaults 
        WHERE decrypted_at IS NOT NULL 
        AND decrypted_at < $1
      `, [cutoff]);
    } finally {
      await conn.close();
    }
  }
}

// Create a singleton instance
export const timeVault = new TimeVault();
