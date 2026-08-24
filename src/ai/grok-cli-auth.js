import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/** Same public OIDC client as official Grok CLI / grok-cli-api. */
export const GROK_CLI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const GROK_CLI_TOKEN_URL = 'https://auth.x.ai/oauth2/token';
export const GROK_CLI_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
export const GROK_CLI_VERSION = process.env.GROK_CLI_VERSION || '0.2.102';
export const GROK_CLI_CLIENT_IDENTIFIER = 'grok-shell';
export const GROK_CLI_USER_AGENT = `grok-shell/${GROK_CLI_VERSION} (nodejs; ${process.platform}; ${process.arch})`;
export const GROK_CLI_REFRESH_LEAD_MS = Number(process.env.GROK_CLI_REFRESH_LEAD_MS || 5 * 60 * 1000);

export function resolveAuthJsonPath(env = process.env, homeDir = os.homedir()) {
    if (env.GROK_AUTH_JSON) return path.resolve(env.GROK_AUTH_JSON);
    if (env.GROK_HOME) return path.join(path.resolve(env.GROK_HOME), 'auth.json');
    return path.join(homeDir, '.grok', 'auth.json');
}

function pickLatestEntry(store) {
    if (!store || typeof store !== 'object' || Array.isArray(store)) return null;

    const entries = Object.entries(store)
        .map(([id, value]) => ({ id, ...(value && typeof value === 'object' ? value : {}) }))
        .filter((entry) => entry.key || entry.access_token || entry.refresh_token || entry.email);

    if (!entries.length) return null;

    entries.sort((a, b) => {
        const aTime = Date.parse(a.create_time || a.expires_at || 0) || 0;
        const bTime = Date.parse(b.create_time || b.expires_at || 0) || 0;
        return bTime - aTime;
    });

    return entries[0];
}

function emptyStatus(authPath, error = null) {
    return {
        connected: false,
        expired: null,
        path: authPath,
        email: null,
        expiresAt: null,
        error,
    };
}

function statusFromEntry(authPath, entry, now = () => new Date()) {
    const expiresAt = typeof entry.expires_at === 'string' ? entry.expires_at : null;
    const expired = expiresAt ? Date.parse(expiresAt) <= now().getTime() : null;

    return {
        connected: true,
        expired,
        path: authPath,
        email: typeof entry.email === 'string' ? entry.email : null,
        expiresAt,
        error: null,
    };
}

export async function readCliAuthStatus(options = {}) {
    const env = options.env || process.env;
    const homeDir = options.homeDir || os.homedir();
    const now = options.now || (() => new Date());
    const readFile = options.readFile || fs.readFile;
    const authPath = resolveAuthJsonPath(env, homeDir);

    try {
        const raw = await readFile(authPath, 'utf8');
        const store = JSON.parse(raw);
        const entry = pickLatestEntry(store);
        if (!entry) {
            return emptyStatus(authPath, 'auth.json exists but has no usable session entries');
        }
        return statusFromEntry(authPath, entry, now);
    } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
            return emptyStatus(authPath);
        }
        return emptyStatus(authPath, error?.message || 'Failed to read Grok CLI auth.json');
    }
}

export async function readCliCredentials(options = {}) {
    const env = options.env || process.env;
    const homeDir = options.homeDir || os.homedir();
    const now = options.now || (() => new Date());
    const readFile = options.readFile || fs.readFile;
    const authPath = resolveAuthJsonPath(env, homeDir);

    try {
        const raw = await readFile(authPath, 'utf8');
        const store = JSON.parse(raw);
        const entry = pickLatestEntry(store);
        if (!entry) return null;

        const accessToken =
            (typeof entry.key === 'string' && entry.key) ||
            (typeof entry.access_token === 'string' && entry.access_token) ||
            null;
        const refreshToken = typeof entry.refresh_token === 'string' ? entry.refresh_token : null;
        if (!accessToken && !refreshToken) return null;

        const status = statusFromEntry(authPath, entry, now);
        const clientId =
            (typeof entry.oidc_client_id === 'string' && entry.oidc_client_id) ||
            (entry.id?.includes('::') ? entry.id.split('::')[1] : null) ||
            GROK_CLI_CLIENT_ID;

        return {
            ...status,
            entryId: entry.id,
            accessToken,
            refreshToken,
            clientId,
            store,
            path: authPath,
        };
    } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
        throw error;
    }
}

export function shouldRefreshCredentials(credentials, now = () => new Date(), leadMs = GROK_CLI_REFRESH_LEAD_MS) {
    if (!credentials?.refreshToken) return false;
    if (!credentials?.accessToken) return true;
    if (credentials.expired === true) return true;
    if (!credentials.expiresAt) return false;
    const expiresAt = Date.parse(credentials.expiresAt);
    if (Number.isNaN(expiresAt)) return true;
    return expiresAt - now().getTime() <= leadMs;
}

export async function refreshCliAccessToken(refreshToken, options = {}) {
    const {
        clientId = GROK_CLI_CLIENT_ID,
        tokenUrl = GROK_CLI_TOKEN_URL,
        fetchImpl = fetch,
    } = options;

    if (!refreshToken) throw new Error('Missing refresh_token for Grok CLI session');

    const response = await fetchImpl(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: refreshToken,
        }),
    });

    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Grok CLI token refresh failed (${response.status}): ${text.slice(0, 300)}`);
    }

    let tokens;
    try {
        tokens = JSON.parse(text);
    } catch {
        throw new Error('Grok CLI token refresh returned non-JSON');
    }

    if (!tokens.access_token) {
        throw new Error('Grok CLI token refresh missing access_token');
    }

    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: Number(tokens.expires_in) || 21600,
    };
}

export async function persistCliCredentials(credentials, tokens, options = {}) {
    const writeFile = options.writeFile || fs.writeFile;
    const rename = options.rename || fs.rename;
    const now = options.now || (() => new Date());

    if (!credentials?.path || !credentials?.entryId || !credentials?.store) return credentials;

    const expiresAt = new Date(now().getTime() + tokens.expiresIn * 1000).toISOString();
    const nextStore = structuredClone(credentials.store);
    const entry = nextStore[credentials.entryId];
    if (!entry || typeof entry !== 'object') return credentials;

    entry.key = tokens.accessToken;
    entry.access_token = tokens.accessToken;
    entry.refresh_token = tokens.refreshToken;
    entry.expires_at = expiresAt;

    const tmpPath = `${credentials.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(nextStore, null, 2)}\n`, { mode: 0o600 });
    await rename(tmpPath, credentials.path);

    return {
        ...credentials,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt,
        expired: false,
        store: nextStore,
    };
}

const refreshInFlightByPath = new Map();

async function performCliRefresh(credentials, options = {}) {
    const latest = (await readCliCredentials(options)) || credentials;
    if (latest?.accessToken && !options.forceRefresh && !shouldRefreshCredentials(latest, options.now)) {
        return latest;
    }

    const refreshToken = latest.refreshToken || credentials.refreshToken;
    if (!refreshToken) {
        if (latest.accessToken && latest.expired !== true) return latest;
        return null;
    }

    const tokens = await refreshCliAccessToken(refreshToken, {
        clientId: latest.clientId || credentials.clientId,
        fetchImpl: options.fetchImpl,
    });
    return persistCliCredentials(latest, tokens, options);
}

export async function getValidCliCredentials(options = {}) {
    const credentials = await readCliCredentials(options);
    if (!credentials) return null;

    if (!options.forceRefresh && !shouldRefreshCredentials(credentials, options.now)) {
        return credentials;
    }

    if (!credentials.refreshToken) {
        if (credentials.accessToken && credentials.expired !== true) return credentials;
        return null;
    }

    const useSingleFlight = !options.readFile && !options.writeFile && !options.fetchImpl;
    const flightKey = useSingleFlight ? credentials.path : null;

    if (flightKey && refreshInFlightByPath.has(flightKey)) {
        return refreshInFlightByPath.get(flightKey);
    }

    const work = (async () => {
        try {
            return await performCliRefresh(credentials, options);
        } catch (error) {
            if (!options.forceRefresh && credentials.accessToken && credentials.expired !== true) {
                return credentials;
            }
            const wrapped = new Error(error.message || 'Failed to refresh Grok CLI credentials');
            wrapped.cause = error;
            throw wrapped;
        } finally {
            if (flightKey) refreshInFlightByPath.delete(flightKey);
        }
    })();

    if (flightKey) refreshInFlightByPath.set(flightKey, work);
    return work;
}

export function buildCliHeaders(credentials, options = {}) {
    const {
        sessionId,
        requestId,
        turnIdx = 1,
        model,
        stream = false,
    } = options;

    const headers = {
        Authorization: `Bearer ${credentials.accessToken}`,
        Accept: stream ? 'text/event-stream' : 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': GROK_CLI_USER_AGENT,
        'x-xai-token-auth': 'xai-grok-cli',
        'x-grok-client-identifier': GROK_CLI_CLIENT_IDENTIFIER,
        'x-grok-client-version': GROK_CLI_VERSION,
        'x-grok-client-mode': 'headless',
    };

    if (credentials.email) headers['x-email'] = credentials.email;
    if (credentials.userId) headers['x-userid'] = credentials.userId;
    if (sessionId) {
        headers['x-grok-session-id'] = sessionId;
        headers['x-grok-conv-id'] = sessionId;
    }
    if (requestId) headers['x-grok-req-id'] = requestId;
    if (turnIdx != null) headers['x-grok-turn-idx'] = String(turnIdx);
    if (model) headers['x-grok-model-override'] = model;

    return headers;
}
