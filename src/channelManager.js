import fs from 'fs/promises';
import path from 'path';

const CHANNELS_FILE = path.join(process.cwd(), '.agent', 'channels.json');

const DEFAULT_CHANNEL = {
    id: 'welcome',
    name: 'Welcome',
    description: 'Default team workspace',
    agentIds: ['primary', 'pm', 'lead'],
};

async function ensureFile() {
    await fs.mkdir(path.dirname(CHANNELS_FILE), { recursive: true });
    try {
        await fs.access(CHANNELS_FILE);
    } catch {
        await fs.writeFile(CHANNELS_FILE, JSON.stringify({ channels: [DEFAULT_CHANNEL] }, null, 2));
    }
}

async function loadData() {
    await ensureFile();
    const raw = await fs.readFile(CHANNELS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.channels)) data.channels = [];
    if (data.channels.length === 0) {
        data.channels.push({ ...DEFAULT_CHANNEL, messages: [], sharedContext: '' });
        await saveData(data);
    }
    return data;
}

async function saveData(data) {
    await fs.mkdir(path.dirname(CHANNELS_FILE), { recursive: true });
    await fs.writeFile(CHANNELS_FILE, JSON.stringify(data, null, 2));
}

export async function listChannels() {
    const data = await loadData();
    return data.channels.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description || '',
        agentIds: c.agentIds || [],
        messageCount: (c.messages || []).length,
    }));
}

export async function getChannel(channelId) {
    const data = await loadData();
    return data.channels.find((c) => c.id === channelId) || null;
}

export async function createChannel({ name, description = '', agentIds = [] }) {
    const data = await loadData();
    const id = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `channel-${Date.now()}`;

    if (data.channels.some((c) => c.id === id)) {
        throw new Error(`Channel "${id}" already exists`);
    }

    const channel = {
        id,
        name,
        description,
        agentIds: [...new Set(agentIds)],
        messages: [],
        sharedContext: '',
        createdAt: new Date().toISOString(),
    };

    data.channels.push(channel);
    await saveData(data);
    return channel;
}

export async function addAgentToChannel(channelId, agentId) {
    const data = await loadData();
    const channel = data.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error('Channel not found');

    if (!channel.agentIds.includes(agentId)) {
        channel.agentIds.push(agentId);
        await saveData(data);
    }
    return channel;
}

export async function removeAgentFromChannel(channelId, agentId) {
    const data = await loadData();
    const channel = data.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error('Channel not found');

    channel.agentIds = channel.agentIds.filter((id) => id !== agentId);
    await saveData(data);
    return channel;
}

export function formatReplyPrefix(replyTo) {
    if (!replyTo) return '';
    const author = replyTo.author || replyTo.agentId || 'message';
    const snippet = String(replyTo.content || '').slice(0, 200);
    return `[Replying to ${author}]: "${snippet}"\n\n`;
}

export async function getChannelMessages(channelId) {
    const channel = await getChannel(channelId);
    if (!channel) throw new Error('Channel not found');
    return channel.messages || [];
}

export async function appendChannelMessage(channelId, message) {
    const data = await loadData();
    const channel = data.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error('Channel not found');

    if (!channel.messages) channel.messages = [];

    const entry = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        ...message,
    };

    channel.messages.push(entry);

    // Keep shared context updated for cross-agent awareness
    if (message.role === 'user' || message.role === 'assistant') {
        const author = message.author || message.agentId || message.role;
        const snippet = (message.content || '').slice(0, 300);
        const line = `[${entry.timestamp}] ${author}: ${snippet}`;
        channel.sharedContext = (channel.sharedContext || '') + '\n' + line;
        if (channel.sharedContext.length > 8000) {
            channel.sharedContext = channel.sharedContext.slice(-8000);
        }
    }

    await saveData(data);
    return entry;
}

export function buildChannelContextBlock(channel, manager) {
    const roster = (channel.agentIds || [])
        .map((id) => {
            const agent = manager.getAgent(id);
            if (!agent) return `- ${id} (offline)`;
            return `- ${agent.name || agent.id} (id: ${agent.id}, persona: ${agent.personaId})`;
        })
        .join('\n');

    const recent = (channel.messages || [])
        .slice(-12)
        .map((m) => {
            const who = m.author || m.agentId || m.role;
            return `${who}: ${(m.content || '').slice(0, 400)}`;
        })
        .join('\n');

    return `
CHANNEL WORKSPACE: #${channel.name} (${channel.id})
You are collaborating with other agents in this channel. All agents share this context.

TEAM ROSTER (use delegate_task to assign work):
${roster || '(no agents assigned yet)'}

SHARED CHANNEL MEMORY:
${channel.sharedContext || '(none yet)'}

RECENT CHANNEL MESSAGES:
${recent || '(none yet)'}

RULES:
1. You know about every agent listed above — coordinate and delegate when needed.
2. When you learn something important, remember it applies to the whole channel.
3. Use delegate_task to assign tasks to teammates by their id (e.g. pm, lead, senior).
`.trim();
}

export function parseMentionedAgentIds(text, channel, manager) {
    if (!text) return [];
    const regex = /@([a-zA-Z0-9_-]+)/g;
    const found = new Set();
    let match;

    while ((match = regex.exec(text)) !== null) {
        const token = match[1].toLowerCase();
        for (const agentId of channel.agentIds || []) {
            const agent = manager.getAgent(agentId);
            if (!agent) continue;
            if (
                agentId.toLowerCase() === token ||
                agent.name?.toLowerCase() === token ||
                agent.personaId?.toLowerCase() === token
            ) {
                found.add(agentId);
            }
        }
    }

    return [...found];
}

export function resolveChannelTargets(text, channel, manager) {
    const mentioned = parseMentionedAgentIds(text, channel, manager);
    if (mentioned.length > 0) return mentioned;

    // Default: channel lead (first agent) coordinates
    if (channel.agentIds?.length > 0) {
        return [channel.agentIds[0]];
    }
    return [];
}
