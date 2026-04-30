/**
 * File: src/auth/sources/FileAuthSource.js
 * Description: File-based authentication source that reads/writes configs/auth/auth-N.json files
 */

const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const BaseAuthSource = require("./BaseAuthSource");

class FileAuthSource extends BaseAuthSource {
    constructor(logger) {
        super(logger, "file");
        this.logger.info('[Auth] Using files in "configs/auth/" directory for authentication.');
    }

    async _loadAllRecords() {
        const configDir = path.join(process.cwd(), "configs", "auth");
        if (!fs.existsSync(configDir)) {
            return [];
        }

        let indices = [];
        try {
            const files = fs.readdirSync(configDir);
            const authFiles = files.filter(file => /^auth-\d+\.json$/.test(file));
            indices = authFiles.map(file => parseInt(file.match(/^auth-(\d+)\.json$/)[1], 10));
        } catch (error) {
            this.logger.error(`[Auth] Failed to scan "configs/auth/" directory: ${error.message}`);
            return [];
        }

        indices = [...new Set(indices)].sort((a, b) => a - b);

        const records = [];
        for (const index of indices) {
            const content = this._readFileContent(index);
            if (content) {
                try {
                    const authData = JSON.parse(content);
                    records.push({
                        index,
                        accountName: authData.accountName || null,
                        expired: authData.expired === true,
                        data: authData,
                    });
                } catch (e) {
                    this.logger.warn(`[Auth] Skipping auth-${index}.json (parse error)`);
                }
            }
        }
        return records;
    }

    _readFileContent(index) {
        const authFilePath = path.join(process.cwd(), "configs", "auth", `auth-${index}.json`);
        if (!fs.existsSync(authFilePath)) return null;
        try {
            return fs.readFileSync(authFilePath, "utf-8");
        } catch (e) {
            return null;
        }
    }

    async _writeRecord(index, authData) {
        const configDir = path.join(process.cwd(), "configs", "auth");
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const filePath = path.join(configDir, `auth-${index}.json`);
        await fsPromises.writeFile(filePath, JSON.stringify(authData, null, 2));
    }

    async _deleteRecord(index) {
        const authFilePath = path.join(process.cwd(), "configs", "auth", `auth-${index}.json`);
        if (!fs.existsSync(authFilePath)) {
            throw new Error(`Auth file for account #${index} does not exist.`);
        }
        await fsPromises.unlink(authFilePath);
    }

    async _setExpiredFlag(index, expired) {
        const authFilePath = path.join(process.cwd(), "configs", "auth", `auth-${index}.json`);
        const fileContent = await fsPromises.readFile(authFilePath, "utf-8");
        const authData = JSON.parse(fileContent);
        if (expired) {
            authData.expired = true;
        } else {
            delete authData.expired;
        }
        await fsPromises.writeFile(authFilePath, JSON.stringify(authData, null, 2));
    }

    async _allocateNextIndex() {
        const existing = this.availableIndices.length > 0 ? Math.max(...this.availableIndices) : -1;
        return existing + 1;
    }
}

module.exports = FileAuthSource;
