import fs from 'fs/promises';
import path from 'path';

const CHANNELS_FILE = path.join(process.cwd(), '.agent', 'channels.json');

const DEFAULT_CHANNEL = {
    id: 'welcome',
    name: 'Welcome',
    description: 'Default team workspace',
    agentIds: ['primary', 'pm', 'lead'],
};

export const DEFAULT_CHANNEL_SETTINGS = {
    /** When true, every agent in the channel responds to user messages (unless @mentions narrow targets). */
    allParticipantsReply: false,
    /** One bounded round where agents may review teammates' replies after a user message. */
    agentDiscussion: false,
    maxDiscussionRounds: 1,
};

export function normalizeChannelSettings(settings = {}) {
    return {
        allParticipantsReply: Boolean(settings.allParticipantsReply),
        agentDiscussion: Boolean(settings.agentDiscussion),
        maxDiscussionRounds: Math.min(2, Math.max(0, Number(settings.maxDiscussionRounds) || 1)),
    };
}

export function isNoReplyContent(content) {
    if (!content || typeof content !== 'string') return true;
    const trimmed = content.trim();
    if (!trimmed) return true;
    if (/^\[NO_REPLY\]\.?$/i.test(trimmed)) return true;
    if (trimmed.length <= 24 && /^(no reply|nothing to add|pass|n\/a)\.?$/i.test(trimmed)) return true;
    return false;
}

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
        settings: normalizeChannelSettings(c.settings),
        messageCount: (c.messages || []).length,
    }));
}

export async function getChannel(channelId) {
    const data = await loadData();
    const channel = data.channels.find((c) => c.id === channelId) || null;
    if (!channel) return null;
    channel.settings = normalizeChannelSettings(channel.settings);
    return channel;
}

export async function updateChannel(channelId, patch = {}) {
    const data = await loadData();
    const channel = data.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error('Channel not found');

    if (patch.name != null) channel.name = String(patch.name).trim() || channel.name;
    if (patch.description != null) channel.description = String(patch.description);
    if (patch.settings) {
        channel.settings = normalizeChannelSettings({
            ...normalizeChannelSettings(channel.settings),
            ...patch.settings,
        });
    }

    await saveData(data);
    channel.settings = normalizeChannelSettings(channel.settings);
    return channel;
}

export async function createChannel({ name, description = '', agentIds = [], settings = {} }) {
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
        settings: normalizeChannelSettings(settings),
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

export async function removeAgentFromAllChannels(agentId) {
    const data = await loadData();
    let changed = false;
    for (const channel of data.channels) {
        const before = (channel.agentIds || []).length;
        channel.agentIds = (channel.agentIds || []).filter((id) => id !== agentId);
        if (channel.agentIds.length !== before) changed = true;
    }
    if (changed) await saveData(data);
}

export async function deleteChannel(channelId) {
    const data = await loadData();
    const idx = data.channels.findIndex((c) => c.id === channelId);
    if (idx === -1) throw new Error('Channel not found');

    data.channels.splice(idx, 1);
    await saveData(data);

    const { clearChannelScopeHistory } = await import('./chatStorage.js');
    await clearChannelScopeHistory(channelId);

    const memDir = path.join(process.cwd(), '.agent', 'memory', 'channels', channelId);
    await fs.rm(memDir, { recursive: true, force: true }).catch(() => {});

    return { id: channelId, deleted: true };
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

export function buildChannelContextBlock(channel, manager, options = {}) {
    const {
        agentId = null,
        peerResponsesThisTurn = [],
        mode = 'user_turn',
    } = options;
    const settings = normalizeChannelSettings(channel.settings);

    const roster = (channel.agentIds || [])
        .map((id) => {
            const agent = manager.getAgent(id);
            if (!agent) return `- ${id} (offline)`;
            return `- ${agent.name || agent.id} (id: ${agent.id}, persona: ${agent.personaId})`;
        })
        .join('\n');

    const recent = (channel.messages || [])
        .slice(-16)
        .map((m) => {
            const who = m.author || m.agentId || m.role;
            const tag = m.kind === 'discussion' ? ' [discussion]' : '';
            return `${who}${tag}: ${(m.content || '').slice(0, 400)}`;
        })
        .join('\n');

    const peerBlock =
        peerResponsesThisTurn.length > 0
            ? peerResponsesThisTurn
                  .filter((p) => p.agentId !== agentId)
                  .map((p) => `- ${p.author || p.agentId}: ${(p.content || '').slice(0, 600)}`)
                  .join('\n')
            : '(none yet this turn)';

    const modeRules =
        mode === 'discussion'
            ? `
DISCUSSION ROUND RULES (anti-loop):
- The user has NOT sent a new message. Review teammates' replies from this turn only.
- Reply ONLY if you add meaningful value: correction, new info, disagreement, or a concrete next step.
- Do NOT repeat teammates, say thanks, greet, or acknowledge for its own sake.
- Do NOT @mention other agents or ask them questions — speak to the user.
- If you have nothing valuable to add, respond with exactly: [NO_REPLY]
`
            : `
USER TURN RULES:
- You can see what teammates already said this turn (if any). Build on it; do not repeat them.
- Address the user, not other agents, unless delegating via delegate_task.
`;

    return `
CHANNEL WORKSPACE: #${channel.name} (${channel.id})
You are ${agentId || 'an agent'} collaborating with other agents in THIS channel only.
Do NOT reference conversations from other channels — your memory here is isolated to #${channel.name}.

CHANNEL MODE:
- All participants reply to user: ${settings.allParticipantsReply ? 'yes' : 'no (lead/@mentions only)'}
- Agent discussion round: ${settings.agentDiscussion ? 'enabled' : 'disabled'}

TEAM ROSTER (use delegate_task to assign work):
${roster || '(no agents assigned yet)'}

RESPONSES FROM TEAMMATES THIS TURN (read before you reply):
${peerBlock}

SHARED CHANNEL MEMORY:
${channel.sharedContext || '(none yet)'}

RECENT CHANNEL MESSAGES:
${recent || '(none yet)'}
${modeRules}
`.trim();
}

export function buildDiscussionPrompt(peerResponsesThisTurn = []) {
    const summary = peerResponsesThisTurn
        .map((p) => `**${p.author || p.agentId}**: ${(p.content || '').slice(0, 800)}`)
        .join('\n\n');

    return `
DISCUSSION ROUND — optional follow-up after the user's message.

Review your teammates' responses:
${summary || '(no responses yet)'}

Add a short follow-up ONLY if you have meaningful new input for the user.
Otherwise respond with exactly: [NO_REPLY]
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
    const settings = normalizeChannelSettings(channel.settings);
    const mentioned = parseMentionedAgentIds(text, channel, manager);
    if (mentioned.length > 0) return mentioned;

    if (settings.allParticipantsReply) {
        return [...(channel.agentIds || [])];
    }

    if (channel.agentIds?.length > 0) {
        return [channel.agentIds[0]];
    }
    return [];
}

/** Agents eligible for one bounded discussion round after a user message. */
export function resolveDiscussionTargets(channel, peerResponsesThisTurn = []) {
    const ids = channel.agentIds || [];
    if (!ids.length) return [];
    const spoke = new Set(peerResponsesThisTurn.map((p) => p.agentId));
    return ids.filter((id) => spoke.has(id));
}
