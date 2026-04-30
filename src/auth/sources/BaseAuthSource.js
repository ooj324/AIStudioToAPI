/**
 * File: src/auth/sources/BaseAuthSource.js
 * Description: Abstract base class for authentication sources with shared memory cache and logic
 */

class BaseAuthSource {
    constructor(logger, backendName) {
        this.logger = logger;
        this.backendName = backendName;
        this.availableIndices = [];
        this.rotationIndices = [];
        this.duplicateIndices = [];
        this.expiredIndices = [];
        this.initialIndices = [];
        this.accountNameMap = new Map();
        this.canonicalIndexMap = new Map();
        this.duplicateGroups = [];
        this._dataCache = new Map();
    }

    // ---- Subclass hooks (must implement) ----

    async _loadAllRecords() {
        throw new Error("_loadAllRecords() must be implemented by subclass");
    }

    async _writeRecord(index, authData) {
        throw new Error("_writeRecord() must be implemented by subclass");
    }

    async _deleteRecord(index) {
        throw new Error("_deleteRecord() must be implemented by subclass");
    }

    async _setExpiredFlag(index, expired) {
        throw new Error("_setExpiredFlag() must be implemented by subclass");
    }

    async _allocateNextIndex() {
        throw new Error("_allocateNextIndex() must be implemented by subclass");
    }

    async close() {
        // Optional hook for cleanup (e.g., closing DB pool)
    }

    // ---- Initialize ----

    async initialize() {
        this.logger.info(`[Auth] Backend=${this.backendName}, loading records...`);
        await this._loadAllRecordsIntoCache();
        if (this.availableIndices.length === 0) {
            this.logger.warn(
                `[Auth] No valid authentication sources found in '${this.backendName}' mode. The server will start in account binding mode.`
            );
        }
    }

    async _loadAllRecordsIntoCache() {
        const records = await this._loadAllRecords();
        this._rebuildCachesFromRecords(records);
    }

    _rebuildCachesFromRecords(records) {
        this.availableIndices = [];
        this.expiredIndices = [];
        this.accountNameMap.clear();
        this._dataCache.clear();

        for (const rec of records) {
            const { index, accountName, expired, data } = rec;
            this.availableIndices.push(index);
            this.accountNameMap.set(index, accountName || null);
            if (expired) {
                this.expiredIndices.push(index);
            }
            this._dataCache.set(index, data);
        }

        this.availableIndices.sort((a, b) => a - b);
        this.initialIndices = [...this.availableIndices];
        this._buildRotationIndices();
    }

    // ---- Shared logic (no IO) ----

    _normalizeEmailKey(accountName) {
        if (typeof accountName !== "string") return null;
        const trimmed = accountName.trim();
        if (!trimmed) return null;
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(trimmed)) return null;
        return trimmed.toLowerCase();
    }

    _buildRotationIndices() {
        this.rotationIndices = [];
        this.duplicateIndices = [];
        this.duplicateGroups = [];
        this.canonicalIndexMap.clear();

        const nonExpiredIndices = this.availableIndices.filter(idx => !this.expiredIndices.includes(idx));
        const emailKeyToIndices = new Map();

        for (const index of nonExpiredIndices) {
            const accountName = this.accountNameMap.get(index);
            const emailKey = this._normalizeEmailKey(accountName);

            if (!emailKey) {
                this.rotationIndices.push(index);
                this.canonicalIndexMap.set(index, index);
                continue;
            }

            const list = emailKeyToIndices.get(emailKey) || [];
            list.push(index);
            emailKeyToIndices.set(emailKey, list);
        }

        for (const [emailKey, indices] of emailKeyToIndices.entries()) {
            indices.sort((a, b) => a - b);
            const keptIndex = indices[indices.length - 1];
            this.rotationIndices.push(keptIndex);

            const duplicateIndices = [];
            for (const index of indices) {
                this.canonicalIndexMap.set(index, keptIndex);
                if (index !== keptIndex) {
                    duplicateIndices.push(index);
                }
            }

            if (duplicateIndices.length > 0) {
                this.duplicateIndices.push(...duplicateIndices);
                this.duplicateGroups.push({
                    email: emailKey,
                    keptIndex,
                    removedIndices: duplicateIndices,
                });
            }
        }

        this.rotationIndices = [...new Set(this.rotationIndices)].sort((a, b) => a - b);
        this.duplicateIndices = [...new Set(this.duplicateIndices)].sort((a, b) => a - b);

        if (this.duplicateIndices.length > 0) {
            this.logger.warn(
                `[Auth] Detected ${this.duplicateIndices.length} duplicate auth entries (same email). ` +
                    `Rotation will only use latest index per account: [${this.rotationIndices.join(", ")}].`
            );
        }

        if (this.expiredIndices.length > 0) {
            this.logger.warn(
                `[Auth] Detected ${this.expiredIndices.length} expired auth entries: [${this.expiredIndices.join(", ")}]. ` +
                    `These accounts are excluded from automatic rotation.`
            );
        }
    }

    // ---- Synchronous read API (all from memory) ----

    getAuth(index) {
        if (!this.availableIndices.includes(index)) {
            this.logger.error(`[Auth] Requested invalid or non-existent authentication index: ${index}`);
            return null;
        }
        const data = this._dataCache.get(index);
        if (!data) {
            this.logger.error(`[Auth] No cached data for authentication source #${index}.`);
            return null;
        }
        return data;
    }

    getRotationIndices() {
        return this.rotationIndices;
    }

    getCanonicalIndex(index) {
        if (!Number.isInteger(index)) return null;
        if (!this.availableIndices.includes(index)) return null;
        return this.canonicalIndexMap.get(index) ?? index;
    }

    getDuplicateGroups() {
        return this.duplicateGroups;
    }

    isExpired(index) {
        return this.expiredIndices.includes(index);
    }

    // ---- Async write API (built on hooks) ----

    async reloadAuthSources() {
        await this._loadAllRecordsIntoCache();
        this.logger.info(
            `[Auth] Reload complete. ${this.availableIndices.length} valid sources available: [${this.availableIndices.join(", ")}]`
        );
    }

    async removeAuth(index) {
        if (!Number.isInteger(index)) {
            throw new Error("Invalid account index.");
        }
        await this._deleteRecord(index);
        // Update caches immediately
        this.availableIndices = this.availableIndices.filter(i => i !== index);
        this.initialIndices = this.initialIndices.filter(i => i !== index);
        this.expiredIndices = this.expiredIndices.filter(i => i !== index);
        this.accountNameMap.delete(index);
        this._dataCache.delete(index);
        this._buildRotationIndices();
        return {
            remainingAccounts: this.availableIndices.length,
            removedIndex: index,
        };
    }

    async markAsExpired(index) {
        if (!this.availableIndices.includes(index)) {
            this.logger.warn(`[Auth] Cannot mark non-existent auth #${index} as expired`);
            return false;
        }
        if (this.expiredIndices.includes(index)) {
            this.logger.debug(`[Auth] Auth #${index} is already marked as expired`);
            return false;
        }
        await this._setExpiredFlag(index, true);
        this.expiredIndices.push(index);
        this._buildRotationIndices();
        this.logger.warn(`[Auth] Marked auth #${index} as expired`);
        return true;
    }

    async unmarkAsExpired(index) {
        if (!this.availableIndices.includes(index)) {
            this.logger.warn(`[Auth] Cannot unmark non-existent auth #${index}`);
            return false;
        }
        if (!this.expiredIndices.includes(index)) {
            this.logger.debug(`[Auth] Auth #${index} is not marked as expired`);
            return false;
        }
        await this._setExpiredFlag(index, false);
        this.expiredIndices = this.expiredIndices.filter(idx => idx !== index);
        this._buildRotationIndices();
        this.logger.info(`[Auth] Restored auth #${index} from expired status`);
        return true;
    }

    async addAuth(authData) {
        const index = await this._allocateNextIndex();
        const accountName = authData.accountName || null;
        await this._writeRecord(index, authData);

        this.availableIndices.push(index);
        this.availableIndices.sort((a, b) => a - b);
        this.initialIndices = [...this.availableIndices];
        this.accountNameMap.set(index, accountName);
        if (authData.expired === true) {
            this.expiredIndices.push(index);
        }
        this._dataCache.set(index, authData);
        this._buildRotationIndices();

        this.logger.info(`[Auth] Added auth #${index} (account: ${accountName || "unknown"})`);
        return { index, accountName };
    }

    async addAuthBatch(authDataList) {
        const results = [];
        for (let i = 0; i < authDataList.length; i++) {
            try {
                const result = await this.addAuth(authDataList[i]);
                results.push({ ...result, success: true });
            } catch (error) {
                results.push({ index: null, accountName: null, success: false, error: error.message });
                this.logger.error(`[Auth] Batch add failed for item ${i}: ${error.message}`);
            }
        }
        return results;
    }
}

module.exports = BaseAuthSource;
