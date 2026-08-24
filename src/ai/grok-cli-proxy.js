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

/**
 * Responses API tools use flat shape: { type, name, description, parameters }.
 * Chat Completions uses nested { type, function: { name, ... } }.
 * Agent tools are plain { name, description, parameters }.
 */
export function normalizeToolsForResponses(tools) {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;

    return tools.map((tool) => {
        const fn = tool.function || tool;
        const name = fn.name || tool.name;
        if (!name) return null;

        const normalized = {
            type: 'function',
            name,
            description: fn.description || tool.description || '',
            parameters: fn.parameters || tool.parameters || { type: 'object', properties: {} },
        };

        if (fn.strict != null || tool.strict != null) {
            normalized.strict = Boolean(fn.strict ?? tool.strict);
        }

        return normalized;
    }).filter(Boolean);
}

export function chatCompletionsToResponses(body, { defaultModel = 'grok-build' } = {}) {
    const model = body?.model || defaultModel;
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    const input = messages.map((message) => ({
        type: 'message',
        role: message.role || 'user',
        content: stringifyContent(message.content),
    }));

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

    next.reasoning = { summary: 'concise' };
    if (/^grok-4\.5(?:$|-)/.test(String(model))) {
        next.reasoning.effort = 'high';
    }
    next.include = ['reasoning.encrypted_content'];

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
        if (item.type === 'message' || item.role === 'assistant') {
            for (const part of item.content || []) {
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

export function responsesToChatCompletions(payload, { model } = {}) {
    const text = extractResponsesText(payload);
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

    if (typeof event.delta === 'string') return event.delta;
    if (typeof event.text === 'string') return event.text;
    if (typeof event.output_text === 'string') return event.output_text;

    if (event.delta && typeof event.delta === 'object') {
        if (typeof event.delta.text === 'string') return event.delta.text;
        if (typeof event.delta.content === 'string') return event.delta.content;
    }

    const type = event.type || '';
    if (type.includes('output_text') && typeof event.part?.text === 'string') {
        return event.part.text;
    }

    return '';
}
