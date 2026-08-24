import { listChannels, getChannelMessages } from './channelManager.js';
import { loadChatHistory } from './chatStorage.js';

function truncate(text, max = 160) {
    const plain = String(text || '')
        .replace(/```[\s\S]*?```/g, '[code]')
        .replace(/[#*_>`\[\]()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!plain) return '';
    return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

function messageContent(msg) {
    if (!msg?.content) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        const textPart = msg.content.find((p) => p.type === 'text');
        return textPart?.text || '';
    }
    return String(msg.content);
}

function lastAssistantMessage(messages) {
    if (!Array.isArray(messages) || !messages.length) return null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'assistant') return messages[i];
    }
    return null;
}

async function loadChannelsRaw() {
    return listChannels();
}

export async function getInboxItems(manager) {
    const items = [];

    const channels = await loadChannelsRaw();
    for (const channel of channels) {
        const messages = await getChannelMessages(channel.id);
        const last = lastAssistantMessage(messages);
        if (!last) continue;

        const author = last.author || last.agentId || 'Agent';
        const timestamp = last.timestamp || channel.createdAt || new Date().toISOString();
        const content = messageContent(last);

        items.push({
            id: `channel:${channel.id}:${last.id || timestamp}`,
            type: 'channel',
            sourceId: channel.id,
            sourceName: channel.name,
            title: `# ${channel.name}`,
            author,
            preview: truncate(content),
            timestamp,
            isFromAgent: true,
        });
    }

    if (manager) {
        const sessions = Array.from(manager.agents.values());
        await Promise.all(
            sessions.map(async (agent) => {
                let last = null;

                const memory = agent.memory?.filter((m) => m.role === 'assistant') || [];
                if (memory.length) {
                    last = memory[memory.length - 1];
                } else {
                    const history = await loadChatHistory(agent.id);
                    last = lastAssistantMessage(history);
                }

                if (!last) return;

                const content = messageContent(last);
                items.push({
                    id: `dm:${agent.id}:${last.id || content.slice(0, 32)}`,
                    type: 'dm',
                    sourceId: agent.id,
                    sourceName: agent.name || agent.id,
                    title: agent.name || agent.id,
                    author: agent.name || agent.id,
                    preview: truncate(content),
                    timestamp: new Date().toISOString(),
                    isFromAgent: true,
                });
            })
        );
    }

    try {
        const { getRecentBackgroundTasks } = await import('./tools/scheduler.js');
        const tasks = getRecentBackgroundTasks(15);
        for (const task of tasks) {
            const ts = task.completedAt || task.startedAt || new Date().toISOString();
            let preview = task.instruction || '';
            if (task.status === 'completed' && task.result) {
                preview = truncate(task.result, 120);
            } else if (task.status === 'failed' && task.error) {
                preview = task.error;
            } else if (task.status === 'running') {
                preview = 'Task is running…';
            }

            items.push({
                id: `bg:${task.id}`,
                type: 'background',
                sourceId: task.agent_id || task.id,
                sourceName: task.agent_name || task.agent_id || 'Agent',
                title: `Background task · ${task.agent_name || task.agent_id || 'agent'}`,
                author: task.status,
                preview: truncate(preview, 140),
                timestamp: ts,
                isFromAgent: true,
                taskId: task.id,
                taskStatus: task.status,
            });
        }
    } catch {
        // Scheduler not loaded
    }

    items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return items;
}
