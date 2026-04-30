/**
 * File: src/auth/AuthSource.js
 * Description: Authentication source factory - instantiates the appropriate backend based on AUTH_BACKEND env var
 */

const FileAuthSource = require("./sources/FileAuthSource");
const PgAuthSource = require("./sources/PgAuthSource");

class AuthSource {
    constructor(logger) {
        const backend = (process.env.AUTH_BACKEND || "file").toLowerCase();
        if (backend === "pg" || backend === "postgres") {
            return new PgAuthSource(logger);
        }
        return new FileAuthSource(logger);
    }
}

module.exports = AuthSource;
