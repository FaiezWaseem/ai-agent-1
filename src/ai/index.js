import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { GrokCliProvider } from './grok-cli-provider.js';
import { loadConfig, getApiKey } from '../config.js';
import {
    resolveGrokCliConfig,
    getGrokCliProviderStatus,
    DEFAULT_GROK_CLI_MODEL,
} from './grok-cli.js';

/**
 * Normalize OpenAI-compatible base URLs.
 * The OpenAI SDK appends paths like /chat/completions to baseURL, so the base
 * must end with /v1 (e.g. https://integrate.api.nvidia.com/v1).
 */
export function normalizeCompatibleBaseUrl(baseURL) {
  if (!baseURL || typeof baseURL !== 'string') return baseURL;

  let url = baseURL.trim().replace(/\/+$/, '');
  // Allow users to paste a full endpoint by mistake
  url = url.replace(/\/chat\/completions\/?$/i, '');

  if (!url.endsWith('/v1')) {
    url += '/v1';
  }

  return url;
}

export {
    readGrokCliAuthStatus,
    resolveGrokCliConfig,
    getGrokCliProviderStatus,
    fetchGrokCliModels,
    DEFAULT_GROK_CLI_BASE_URL,
    DEFAULT_GROK_CLI_MODEL,
} from './grok-cli.js';

export async function getAIProvider(modelOverride = null) {
  const config = await loadConfig();
  const providerType = config.provider;

  if (providerType === 'grok-cli') {
    const status = await getGrokCliProviderStatus(config);
    if (!status.available) {
      throw new Error(
        status.reason ||
          'Grok CLI provider unavailable. Run `grok login` on this machine.'
      );
    }

    const { baseUrl, model } = resolveGrokCliConfig(config);
    const resolvedModel = modelOverride || model || DEFAULT_GROK_CLI_MODEL;
    return new GrokCliProvider(resolvedModel, baseUrl);
  }

  const apiKey = await getApiKey(providerType);
  if (!apiKey) {
    throw new Error(`API Key for ${providerType} not found in environment variables.`);
  }

  if (providerType === 'openai') {
    return new OpenAIProvider(apiKey, null, modelOverride || config.model || 'gpt-4o');
  } else if (providerType === 'gemini') {
    return new GeminiProvider(apiKey, modelOverride || config.model || 'gemini-1.5-flash');
  } else if (providerType === 'compatible') {
     // OpenAI compatible (e.g. LocalAI, Groq, NVIDIA NIM, etc.)
     const rawBaseURL = process.env.OPENAI_BASE_URL || config.compatible_base_url;
     if (!rawBaseURL) {
       throw new Error(
         'Compatible provider requires a base URL. Set OPENAI_BASE_URL or run `ai-agent setup` and enter the API root (e.g. https://integrate.api.nvidia.com/v1).'
       );
     }
     const baseURL = normalizeCompatibleBaseUrl(rawBaseURL);
     return new OpenAIProvider(apiKey, baseURL, modelOverride || config.model || 'gpt-3.5-turbo');
  } else {
    throw new Error(`Unknown provider: ${providerType}`);
  }
}
