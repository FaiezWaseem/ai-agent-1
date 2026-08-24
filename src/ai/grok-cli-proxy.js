function stringifyContent(content) {
    if (typeof content === 'string') return content;
    if (content == null) return '';
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part?.type === 'text' && typeof part.text === 'string') return part.text;
                if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
                if (typeof part?.text === 'string') return part.text;
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }
    return JSON.stringify(content);
}

export const MAX_INPUT_CONTENT_CHARS = 12000;
export const MAX_TOOL_OUTPUT_CHARS = 6000;

export function truncateText(text, max = MAX_INPUT_CONTENT_CHARS) {
    if (!text || text.length <= max) return text;
    return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

/**
 * Responses API tools use flat shape: { type, name, description, parameters }.
 */
export function normalizeToolsForResponses(tools) {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;

    return tools.map((tool) => {
        const fn = tool.function || tool;
        const name = fn.name || tool.name;
        if (!name) return null;

        return {
            type: 'function',
            name,
            description: fn.description || tool.description || '',
            parameters: fn.parameters || tool.parameters || { type: 'object', properties: {} },
        };
    }).filter(Boolean);
}

/**
 * Convert agent memory messages → Responses API input (with truncation + tool shapes).
 */
export function messagesToResponsesInput(messages, { maxChars = MAX_INPUT_CONTENT_CHARS } = {}) {
    const input = [];

    for (const message of messages || []) {
        if (!message) continue;

        if (message.role === 'tool') {
            input.push({
                type: 'function_call_output',
                call_id: message.tool_call_id || message.call_id || 'call_unknown',
                output: truncateText(stringifyContent(message.content), MAX_TOOL_OUTPUT_CHARS),
            });
            continue;
        }

        if (message.role === 'assistant' && message.tool_calls?.length) {
            const text = stringifyContent(message.content);
            if (text.trim()) {
                input.push({
                    type: 'message',
                    role: 'assistant',
                    content: truncateText(text, maxChars),
                });
            }
            for (const tc of message.tool_calls) {
                input.push({
                    type: 'function_call',
                    call_id: tc.id,
                    name: tc.function?.name || tc.name,
                    arguments: tc.function?.arguments || tc.arguments || '{}',
                });
            }
            continue;
        }

        const role = message.role === 'system' ? 'system' : message.role || 'user';
        input.push({
            type: 'message',
            role,
            content: truncateText(stringifyContent(message.content), maxChars),
        });
    }

    return input;
}

export function chatCompletionsToResponses(body, { defaultModel = 'grok-build' } = {}) {
    const model = body?.model || defaultModel;
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const input = messagesToResponsesInput(messages);

    const next = {
        model,
        input: input.length > 0 ? input : [{ type: 'message', role: 'user', content: '...' }],
        stream: Boolean(body?.stream),
        store: false,
    };

    if (body?.temperature != null) next.temperature = body.temperature;
    if (body?.top_p != null) next.top_p = body.top_p;
    if (body?.max_tokens != null) next.max_output_tokens = body.max_tokens;
    if (body?.tools) next.tools = normalizeToolsForResponses(body.tools);
    if (body?.tool_choice) next.tool_choice = body.tool_choice;

    // Reasoning stays server-side; don't request encrypted blobs back into our context.
    next.reasoning = { summary: 'concise' };

    return next;
}

export function countUserTurns(input) {
    if (!Array.isArray(input)) return 1;
    let n = 0;
    for (const item of input) {
        if (!item || typeof item !== 'object') continue;
        const type = typeof item.type === 'string' ? item.type : '';
        if (item.role === 'user' && (!type || type === 'message')) n += 1;
    }
    return Math.max(1, n);
}

export function extractResponsesText(payload) {
    if (!payload || typeof payload !== 'object') return '';

    if (typeof payload.output_text === 'string') return payload.output_text;

    const chunks = [];
    for (const item of payload.output || []) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === 'reasoning' || item.type === 'reasoning_summary') continue;
        if (item.type === 'message' || item.role === 'assistant') {
            for (const part of item.content || []) {
                if (part?.type === 'reasoning' || part?.type === 'summary_text') continue;
                if (typeof part?.text === 'string') chunks.push(part.text);
                else if (typeof part === 'string') chunks.push(part);
            }
        }
        if (item.type === 'output_text' && typeof item.text === 'string') {
            chunks.push(item.text);
        }
    }
    return chunks.join('');
}

export function extractResponsesToolCalls(payload) {
    const toolCalls = [];
    for (const item of payload?.output || []) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === 'function_call' || item.type === 'tool_call') {
            toolCalls.push({
                id: item.call_id || item.id || `call_${toolCalls.length}`,
                type: 'function',
                function: {
                    name: item.name || item.function?.name || '',
                    arguments:
                        typeof item.arguments === 'string'
                            ? item.arguments
                            : JSON.stringify(item.arguments || item.function?.arguments || {}),
                },
            });
        }
    }
    return toolCalls.length ? toolCalls : null;
}

export function cleanAssistantText(text) {
    if (!text || typeof text !== 'string') return text;

    let cleaned = text;
    cleaned = cleaned.replace(/^(The user message is:[^\n]*\n?)+/gim, '');
    cleaned = cleaned.replace(/^(First, the user message is[^\n]*\n?)+/gim, '');
    cleaned = cleaned.replace(/^(I'm (?:the|acting as)[^\n]*\n?)+/gim, '');
    cleaned = cleaned.replace(/^(My goal:[^\n]*\n?)+/gim, '');
    cleaned = cleaned.replace(/^(The instructions:[^\n]*\n?)+/gim, '');
    cleaned = cleaned.replace(/^(From history:[^\n]*\n?)+/gim, '');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}

export function responsesToChatCompletions(payload, { model } = {}) {
    const text = cleanAssistantText(extractResponsesText(payload));
    const toolCalls = extractResponsesToolCalls(payload);
    const message = { role: 'assistant', content: text || null };
    if (toolCalls) message.tool_calls = toolCalls;

    return {
        id: payload?.id || `chatcmpl_${Date.now()}`,
        object: 'chat.completion',
        created: payload?.created_at || Math.floor(Date.now() / 1000),
        model: model || payload?.model || 'grok-build',
        choices: [
            {
                index: 0,
                message,
                finish_reason: toolCalls ? 'tool_calls' : 'stop',
            },
        ],
        usage: payload?.usage || undefined,
    };
}

export function extractStreamTextDelta(event) {
    if (!event || typeof event !== 'object') return '';

    const type = String(event.type || '');
    if (
        type.includes('reasoning') ||
        type.includes('summary') ||
        type.includes('encrypted')
    ) {
        return '';
    }

    if (type.includes('output_text') || type.includes('content_part')) {
        if (typeof event.delta === 'string') return event.delta;
        if (typeof event.text === 'string') return event.text;
        if (event.delta && typeof event.delta === 'object') {
            if (typeof event.delta.text === 'string') return event.delta.text;
        }
        if (typeof event.part?.text === 'string') return event.part.text;
    }

    return '';
}

export function emitContentAsStream(content, onUpdate) {
    if (!content || !onUpdate) return;
    const chunkSize = 24;
    for (let i = 0; i < content.length; i += chunkSize) {
        onUpdate({ type: 'token', content: content.slice(i, i + chunkSize) });
    }
}
