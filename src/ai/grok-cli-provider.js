import crypto from 'crypto';
import {
    GROK_CLI_BASE_URL,
    buildCliHeaders,
    getValidCliCredentials,
} from './grok-cli-auth.js';
import {
    chatCompletionsToResponses,
    countUserTurns,
    extractStreamTextDelta,
    responsesToChatCompletions,
} from './grok-cli-proxy.js';

export class GrokCliProvider {
    constructor(model = 'grok-build', baseUrl = GROK_CLI_BASE_URL) {
        this.model = model;
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.sessionId = crypto.randomUUID();
    }

    async generate(prompt, systemInstruction) {
        const messages = [];
        if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
        messages.push({ role: 'user', content: prompt });
        const result = await this.chat(messages);
        return result.content || '';
    }

    async chat(messages, tools = null, onUpdate = null) {
        const credentials = await getValidCliCredentials();
        if (!credentials?.accessToken) {
            throw new Error('Grok CLI not authenticated. Run `grok login` on this machine.');
        }

        const body = chatCompletionsToResponses(
            {
                model: this.model,
                messages,
                stream: Boolean(onUpdate),
                tools: tools?.length ? tools : undefined,
            },
            { defaultModel: this.model },
        );

        const headers = buildCliHeaders(credentials, {
            sessionId: this.sessionId,
            requestId: crypto.randomUUID(),
            turnIdx: countUserTurns(body.input),
            model: body.model,
            stream: Boolean(onUpdate),
        });

        let response = await fetch(`${this.baseUrl}/responses`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (response.status === 401) {
            const refreshed = await getValidCliCredentials({ forceRefresh: true });
            if (!refreshed?.accessToken) {
                throw new Error('Grok CLI session expired. Run `grok login` again.');
            }
            const retryHeaders = buildCliHeaders(refreshed, {
                sessionId: this.sessionId,
                requestId: crypto.randomUUID(),
                turnIdx: countUserTurns(body.input),
                model: body.model,
                stream: Boolean(onUpdate),
            });
            response = await fetch(`${this.baseUrl}/responses`, {
                method: 'POST',
                headers: retryHeaders,
                body: JSON.stringify(body),
            });
        }

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`Grok CLI API Error (${response.status}): ${errText.slice(0, 400)}`);
        }

        if (onUpdate) {
            return this._handleStream(response, onUpdate, body.model);
        }

        const payload = await response.json();
        const completion = responsesToChatCompletions(payload, { model: body.model });
        const choice = completion.choices[0];
        return {
            content: choice.message.content,
            toolCalls: choice.message.tool_calls || null,
        };
    }

    async _handleStream(response, onUpdate, model) {
        const reader = response.body?.getReader();
        if (!reader) {
            const payload = await response.json();
            const completion = responsesToChatCompletions(payload, { model });
            const text = completion.choices[0]?.message?.content || '';
            if (text) onUpdate({ type: 'token', content: text });
            return {
                content: text || null,
                toolCalls: completion.choices[0]?.message?.tool_calls || null,
            };
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';

            for (const block of events) {
                for (const line of block.split('\n')) {
                    if (!line.startsWith('data:')) continue;
                    const data = line.slice(5).trim();
                    if (!data || data === '[DONE]') continue;

                    try {
                        const event = JSON.parse(data);
                        const delta = extractStreamTextDelta(event);
                        if (delta) {
                            fullContent += delta;
                            onUpdate({ type: 'token', content: delta });
                        }
                    } catch {
                        // ignore malformed SSE chunks
                    }
                }
            }
        }

        return { content: fullContent || null, toolCalls: null };
    }
}
