/**
 * File: src/utils/ResinClient.js
 * Description: Client utility for the Resin sticky proxy pool. Resolves business
 *              identity to forward-proxy credentials / reverse-proxy URLs and
 *              calls Resin's inherit-lease API.
 *
 * Configuration:
 *   - RESIN_URL              base proxy URL plus token, e.g. http://127.0.0.1:2260/my-token
 *   - RESIN_PLATFORM_NAME    business platform value (must be a single path segment)
 *
 * When either env var is unset, isEnabled() returns false and the project keeps
 * its existing (no-Resin) behavior.
 */

const crypto = require("crypto");
const axios = require("axios");

const consoleFallback = {
    debug: (...args) => console.debug("[Resin]", ...args),
    error: (...args) => console.error("[Resin]", ...args),
    info: (...args) => console.log("[Resin]", ...args),
    warn: (...args) => console.warn("[Resin]", ...args),
};

class ResinClient {
    constructor(logger) {
        this.logger = logger || consoleFallback;
        this.enabled = false;
        this.platform = null;
        this.token = null;
        this.proxyServer = null; // e.g. "http://127.0.0.1:2260"
        this.basePath = ""; // e.g. "/my-token"
        this.resinUrl = null; // e.g. "http://127.0.0.1:2260/my-token"

        const rawUrl = (process.env.RESIN_URL || "").trim();
        const rawPlatform = (process.env.RESIN_PLATFORM_NAME || "").trim();

        if (!rawUrl && !rawPlatform) {
            return;
        }
        if (!rawUrl || !rawPlatform) {
            this.logger.error(
                `[Resin] Both RESIN_URL and RESIN_PLATFORM_NAME must be set. Got RESIN_URL=${rawUrl ? "<set>" : "<empty>"}, RESIN_PLATFORM_NAME=${rawPlatform ? "<set>" : "<empty>"}. Resin is DISABLED.`
            );
            return;
        }

        if (rawPlatform.includes("/")) {
            this.logger.error(
                `[Resin] RESIN_PLATFORM_NAME must be a single path segment (no "/"): ${rawPlatform}. Resin is DISABLED.`
            );
            return;
        }

        let parsed;
        try {
            parsed = new URL(rawUrl);
        } catch (err) {
            this.logger.error(`[Resin] Invalid RESIN_URL "${rawUrl}": ${err.message}. Resin is DISABLED.`);
            return;
        }

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            this.logger.error(
                `[Resin] RESIN_URL must use http:// or https:// scheme, got ${parsed.protocol}. Resin is DISABLED.`
            );
            return;
        }

        const cleanedPath = parsed.pathname.replace(/\/+$/, "");
        const tokenMatch = cleanedPath.match(/^\/([^/]+)$/);
        if (!tokenMatch) {
            this.logger.error(
                `[Resin] RESIN_URL must include a single token path segment, e.g. "http://host:port/my-token". Got: ${rawUrl}. Resin is DISABLED.`
            );
            return;
        }

        this.token = tokenMatch[1];
        this.proxyServer = `${parsed.protocol}//${parsed.host}`;
        this.basePath = cleanedPath;
        this.resinUrl = `${this.proxyServer}${this.basePath}`;
        this.platform = rawPlatform;
        this.enabled = true;

        this.logger.info(
            `[Resin] Sticky proxy pool ENABLED. platform="${this.platform}", server="${this.proxyServer}".`
        );
    }

    isEnabled() {
        return this.enabled;
    }

    getPlatform() {
        return this.platform;
    }

    /**
     * Build a fresh, unique TempIdentity for use before a stable account
     * identifier (e.g. email) is known. MUST be unique per login attempt —
     * never reuse the same TempIdentity for multiple logins, otherwise every
     * inherit-lease call would inherit from the same parent lease.
     */
    static generateTempIdentity(prefix = "temp") {
        const id = crypto.randomBytes(8).toString("hex");
        return `${prefix}-${id}`;
    }

    /**
     * Build forward-proxy config for Playwright's `proxy` option (browser-level
     * or context-level). Returns null when Resin is not enabled, so callers can
     * fall back to existing HTTP_PROXY logic with `?? parseProxyFromEnv()`.
     *
     * @param {string} account stable account identifier (email / TempIdentity)
     */
    getForwardProxyForAccount(account) {
        if (!this.enabled) return null;
        if (!account) {
            const generated = ResinClient.generateTempIdentity("anon");
            this.logger.warn(
                `[Resin] getForwardProxyForAccount called without account identifier; falling back to "${generated}". This identity will not be sticky across calls.`
            );
            account = generated;
        }
        return {
            password: this.token,
            server: this.proxyServer,
            username: `${this.platform}.${account}`,
        };
    }

    /**
     * Build a reverse-proxy URL for an http/https target.
     * Example: "https://api.example.com/x?y=1" =>
     *          "<resin_url>/<platform>/https/api.example.com/x?y=1"
     * Returns the original URL untouched if Resin is disabled.
     */
    buildReverseProxyUrl(targetUrl) {
        if (!this.enabled) return targetUrl;
        const u = new URL(targetUrl);
        const protocol = u.protocol.replace(/:$/, "");
        if (protocol !== "http" && protocol !== "https") {
            throw new Error(`[Resin] Unsupported target protocol for reverse proxy: ${u.protocol}`);
        }
        return `${this.resinUrl}/${this.platform}/${protocol}/${u.host}${u.pathname}${u.search}`;
    }

    /**
     * Build a reverse-proxy WebSocket URL for a ws/wss target.
     * The client always connects via plain ws:// to Resin; the inner protocol
     * is encoded in the path as http/https (NOT ws/wss).
     */
    buildReverseProxyWsUrl(targetWsUrl) {
        if (!this.enabled) return targetWsUrl;
        const u = new URL(targetWsUrl);
        const wsProto = u.protocol.replace(/:$/, "");
        if (wsProto !== "ws" && wsProto !== "wss") {
            throw new Error(`[Resin] Unsupported target protocol for reverse WS proxy: ${u.protocol}`);
        }
        const innerProto = wsProto === "wss" ? "https" : "http";
        const proxyU = new URL(this.resinUrl);
        return `ws://${proxyU.host}${proxyU.pathname}/${this.platform}/${innerProto}/${u.host}${u.pathname}${u.search}`;
    }

    /**
     * Header to attach to reverse-proxy requests so Resin can route by account.
     */
    getAccountHeader(account) {
        return account ? { "X-Resin-Account": account } : {};
    }

    /**
     * Best-effort call to Resin's lease inheritance endpoint. Used to migrate a
     * TempIdentity's IP lease to a stable identifier once it becomes known
     * (e.g. after extracting the account email post-login). Logs and swallows
     * errors — the lease is still usable, just not inherited.
     */
    async inheritLease(parentAccount, newAccount) {
        if (!this.enabled) return false;
        if (!parentAccount || !newAccount) {
            this.logger.warn(`[Resin] inheritLease skipped: parentAccount=${parentAccount}, newAccount=${newAccount}`);
            return false;
        }
        if (parentAccount === newAccount) {
            this.logger.debug(`[Resin] inheritLease skipped: parent and new accounts are identical.`);
            return true;
        }
        const url = `${this.resinUrl}/api/v1/${encodeURIComponent(this.platform)}/actions/inherit-lease`;
        try {
            await axios.post(
                url,
                { new_account: newAccount, parent_account: parentAccount },
                { headers: { "Content-Type": "application/json" }, timeout: 10000 }
            );
            this.logger.info(`[Resin] Inherited lease: "${parentAccount}" -> "${newAccount}".`);
            return true;
        } catch (err) {
            const status = err.response?.status;
            const body = err.response?.data;
            const bodyStr = typeof body === "object" ? JSON.stringify(body) : String(body ?? "");
            this.logger.warn(
                `[Resin] inheritLease failed (${parentAccount} -> ${newAccount}): ${err.message}` +
                    (status ? ` status=${status}` : "") +
                    (bodyStr ? ` body=${bodyStr.slice(0, 300)}` : "")
            );
            return false;
        }
    }

    /**
     * Resolve the stable Resin account identifier for an auth record.
     * Preference order:
     *   1) explicit resinAccount field on the auth data
     *   2) accountName, if set and not the placeholder "unknown"
     *   3) null (caller should warn / generate a TempIdentity)
     */
    static resolveAccountFromAuth(authData) {
        if (!authData) return null;
        const explicit = authData.resinAccount;
        if (typeof explicit === "string" && explicit.trim()) {
            return explicit.trim();
        }
        const name = authData.accountName;
        if (typeof name === "string") {
            const trimmed = name.trim();
            if (trimmed && trimmed.toLowerCase() !== "unknown") {
                return trimmed;
            }
        }
        return null;
    }
}

let _instance = null;

/**
 * Get a process-wide ResinClient instance. The first caller's logger wins; pass
 * `console`-shaped objects from scripts where the project logger isn't available.
 */
function getResinClient(logger) {
    if (!_instance) {
        _instance = new ResinClient(logger);
    }
    return _instance;
}

module.exports = { getResinClient, ResinClient };
