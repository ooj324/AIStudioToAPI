/**
 * File: src/auth/sources/PgAuthSource.js
 * Description: Postgres/Supabase authentication source using pg.Pool
 */

const { Pool } = require("pg");
const BaseAuthSource = require("./BaseAuthSource");

class PgAuthSource extends BaseAuthSource {
    constructor(logger) {
        super(logger, "pg");

        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error(
                "[Auth] DATABASE_URL environment variable is required when AUTH_BACKEND=pg. " +
                    "Set DATABASE_URL to your Postgres connection string."
            );
        }

        const rejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED === "true";
        this.pool = new Pool({
            connectionString,
            max: 5,
            ssl: { rejectUnauthorized },
        });

        this.pool.on("error", err => {
            this.logger.error(`[Auth:PG] Unexpected pool error: ${err.message}`);
        });

        this.logger.info('[Auth] Using Postgres database for authentication.');
    }

    async initialize() {
        try {
            await this.pool.query("SELECT 1");
            this.logger.info("[Auth:PG] Database connection verified.");
        } catch (error) {
            throw new Error(`[Auth:PG] Failed to connect to database: ${error.message}`);
        }

        await this._ensureTable();
        await super.initialize();
    }

    async _ensureTable() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS aistudio_auth (
                index INTEGER PRIMARY KEY,
                account_name TEXT,
                expired BOOLEAN NOT NULL DEFAULT FALSE,
                data JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        this.logger.info("[Auth:PG] Table 'aistudio_auth' is ready.");
    }

    async _loadAllRecords() {
        const result = await this.pool.query(
            "SELECT index, account_name, expired, data FROM aistudio_auth ORDER BY index"
        );
        return result.rows.map(row => ({
            index: row.index,
            accountName: row.account_name,
            expired: row.expired === true,
            data: row.data,
        }));
    }

    async _writeRecord(index, authData) {
        const accountName = authData.accountName || null;
        await this.pool.query(
            `INSERT INTO aistudio_auth (index, account_name, data, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (index) DO UPDATE SET account_name = $2, data = $3, updated_at = NOW()`,
            [index, accountName, JSON.stringify(authData)]
        );
    }

    async _deleteRecord(index) {
        const result = await this.pool.query("DELETE FROM aistudio_auth WHERE index = $1", [index]);
        if (result.rowCount === 0) {
            throw new Error(`Auth record for account #${index} does not exist.`);
        }
    }

    async _setExpiredFlag(index, expired) {
        await this.pool.query(
            "UPDATE aistudio_auth SET expired = $2, updated_at = NOW() WHERE index = $1",
            [index, expired]
        );
    }

    async _allocateNextIndex() {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const result = await client.query(
                "SELECT COALESCE(MAX(index), -1) + 1 AS next FROM aistudio_auth"
            );
            const nextIndex = result.rows[0].next;
            await client.query("COMMIT");
            return nextIndex;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async close() {
        this.logger.info("[Auth:PG] Closing database pool...");
        await this.pool.end();
    }
}

module.exports = PgAuthSource;
