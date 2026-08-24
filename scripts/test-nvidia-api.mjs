import fs from 'fs';
import path from 'path';
import os from 'os';
import OpenAI from 'openai';
import { normalizeCompatibleBaseUrl } from '../src/ai/index.js';

const configPath = path.join(os.homedir(), '.ai-agent-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const apiKey = config.compatible_api_key;
const model = config.model || 'deepseek-ai/deepseek-v4-flash-0731';
const rawBase = config.compatible_base_url;
const baseURL = normalizeCompatibleBaseUrl(rawBase);

console.log('Provider:', config.provider);
console.log('Model:', model);
console.log('Raw base URL:', rawBase);
console.log('Normalized base URL:', baseURL);
console.log('Expected endpoint:', `${baseURL}/chat/completions`);
console.log('');

const client = new OpenAI({ apiKey, baseURL });

async function test(label, options) {
  try {
    const response = await client.chat.completions.create(options);
    const text = response.choices?.[0]?.message?.content ?? '(empty)';
    console.log(`✅ ${label}:`, text.slice(0, 120));
    return true;
  } catch (error) {
    console.log(`❌ ${label}:`);
    console.log('   status:', error.status ?? 'n/a');
    console.log('   message:', error.message?.slice(0, 200));
    if (error.error) console.log('   detail:', JSON.stringify(error.error).slice(0, 300));
    return false;
  }
}

await test('simple chat', {
  model,
  messages: [{ role: 'user', content: 'Say hi in 3 words.' }],
  max_tokens: 20,
});

await test('chat with tools (like agent)', {
  model,
  messages: [{ role: 'user', content: 'hey' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    },
  ],
  max_tokens: 20,
});
