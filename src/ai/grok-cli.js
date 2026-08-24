import crypto from 'crypto';
import {
    GROK_CLI_BASE_URL,
    buildCliHeaders,
    getValidCliCredentials,
    readCliAuthStatus,
} from './grok-cli-auth.js';

export const DEFAULT_GROK_CLI_BASE_URL = GROK_CLI_BASE_URL;
export const DEFAULT_GROK_CLI_MODEL = 'grok-build';

export { readCliAuthStatus as readGrokCliAuthStatus };
export { getValidCliCredentials, buildCliHeaders, GROK_CLI_BASE_URL } from './grok-cli-auth.js';
export { GrokCliProvider } from './grok-cli-provider.js';

export function resolveGrokCliConfig(config = {}, env = process.env) {
    const baseUrl =
        env.GROK_CLI_BASE_URL ||
        config.grok_cli_base_url ||
        DEFAULT_GROK_CLI_BASE_URL;
    const model =
        config.model ||
        env.GROK_CHAT_MODEL ||
        DEFAULT_GROK_CLI_MODEL;

    return { baseUrl: baseUrl.replace(/\/+$/, ''), model };
}

export async function getGrokCliProviderStatus(config = {}, env = process.env) {
    const resolved = resolveGrokCliConfig(config, env);
    const cliAuth = await readCliAuthStatus({ env });

    let refreshError = null;
    let credentials = null;
    try {
        credentials = await getValidCliCredentials({ env });
    } catch (error) {
        refreshError = error?.message || 'Failed to refresh Grok CLI session';
    }

    const available = Boolean(credentials?.accessToken);
    let reason = null;

    if (!cliAuth.connected) {
        reason = 'Run `grok login` to authenticate the official Grok CLI';
    } else if (cliAuth.expired === true && !credentials?.accessToken) {
        reason = refreshError || 'Session expired — run `grok login` again';
    } else if (!credentials?.accessToken) {
        reason = refreshError || 'No usable Grok CLI session found in ~/.grok/auth.json';
    }

    return {
        provider: 'grok-cli',
        available,
        reason,
        config: {
            baseUrl: resolved.baseUrl,
            model: resolved.model,
        },
        cliAuth: credentials
            ? {
                  connected: true,
                  expired: Boolean(credentials.expired),
                  path: credentials.path,
                  email: credentials.email,
                  expiresAt: credentials.expiresAt,
                  error: refreshError,
              }
            : cliAuth,
        setup: {
            login: 'grok login',
            authPath: cliAuth.path,
        },
    };
}

export async function fetchGrokCliModels(config = {}, env = process.env) {
    const { baseUrl, model } = resolveGrokCliConfig(config, env);
    const credentials = await getValidCliCredentials({ env });
    if (!credentials?.accessToken) return [{ id: model, name: model }];

    try {
        const headers = buildCliHeaders(credentials, {
            sessionId: crypto.randomUUID(),
            requestId: crypto.randomUUID(),
        });
        const response = await fetch(`${baseUrl}/models`, { headers });
        if (!response.ok) return [{ id: model, name: model }];
        const data = await response.json();
        const models = (data.data || []).map((m) => ({ id: m.id, name: m.id }));
        return models.length ? models : [{ id: model, name: model }];
    } catch {
        return [{ id: model, name: model }];
    }
}
