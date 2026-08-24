import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentManager } from '../agentManager.js';
import { savePersona, listPersonas } from '../personas/index.js';
import { loadConfig, sanitizeConfigForClient, mergeConfigUpdate } from '../config.js';
import { normalizeCompatibleBaseUrl, fetchGrokCliModels, getGrokCliProviderStatus } from '../ai/index.js';
import { getPersonaById, updatePersona } from '../personas/index.js';
import {
    listChannels,
    getChannel,
    createChannel,
    addAgentToChannel,
    getChannelMessages,
    appendChannelMessage,
    buildChannelContextBlock,
    resolveChannelTargets,
    formatReplyPrefix,
    buildDiscussionPrompt,
    resolveDiscussionTargets,
    isNoReplyContent,
    normalizeChannelSettings,
    updateChannel,
    deleteChannel,
} from '../channelManager.js';
import { registerAgentManagerGetter } from './scheduler.js';
import { getInboxItems } from '../inbox.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Adjust path to point to src/web/public
// src/tools/web_ui.js -> ../web/public
const PUBLIC_DIR = path.join(__dirname, '../web/public');

let server = null;
let manager = null;

async function getManager() {
    if (!manager) {
        manager = new AgentManager();
        await manager.init();
        registerAgentManagerGetter(() => manager);

        // Ensure core team exists for channels
        const coreTeam = [
            { personaId: 'default', id: 'primary' },
            { personaId: 'project_manager', id: 'pm' },
            { personaId: 'team_lead', id: 'lead' },
            { personaId: 'senior_engineer', id: 'senior' },
            { personaId: 'testing_engineer', id: 'qa' },
        ];

        for (const role of coreTeam) {
            if (!manager.getAgent(role.id)) {
                try {
                    await manager.createAgent(role.personaId, role.id);
                } catch {
                    // persona may be missing
                }
            }
        }

        if (manager.agents.size === 0) {
            await manager.createAgent('default', 'primary');
        }
    }
    return manager;
}

async function resolveRequestedModel(requestedModel) {
    const config = await loadConfig();
    const fallback = config.model || null;

    if (!requestedModel || typeof requestedModel !== 'string') {
        return fallback;
    }

    if (['openai', 'gemini', 'compatible', 'grok-cli', 'gpt-4o', 'gpt-3.5-turbo'].includes(requestedModel)) {
        return fallback;
    }

    if (!requestedModel.includes('/') && config.provider === 'compatible') {
        return fallback;
    }

    return requestedModel;
}

async function fetchCompatibleModels(config) {
    const apiKey = config.compatible_api_key || process.env.COMPATIBLE_API_KEY;
    const rawBaseURL = process.env.OPENAI_BASE_URL || config.compatible_base_url;
    if (!apiKey || !rawBaseURL) return null;

    const baseURL = normalizeCompatibleBaseUrl(rawBaseURL);
    const response = await fetch(`${baseURL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) return null;

    const data = await response.json();
    return (data.data || []).map((m) => ({
        id: m.id,
        name: m.id,
    }));
}

export const webUiToolDefinitions = [
  {
    name: 'start_chat_ui',
    description: 'Starts a local web server to serve the chat UI on localhost:8456.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

export const webUiTools = {
  start_chat_ui: async () => {
    if (server) {
      return 'Chat UI server is already running at http://localhost:8456';
    }

    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(express.static(PUBLIC_DIR));

    // --- Global AI config ---
    app.get('/api/config', async (req, res) => {
        try {
            const config = await loadConfig();
            res.json(sanitizeConfigForClient(config));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/config', async (req, res) => {
        try {
            const body = { ...req.body };
            if (body.compatible_base_url) {
                body.compatible_base_url = normalizeCompatibleBaseUrl(body.compatible_base_url);
            }
            const updated = await mergeConfigUpdate(body);
            res.json(updated);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/providers/grok-cli/status', async (req, res) => {
        try {
            const config = await loadConfig();
            const status = await getGrokCliProviderStatus(config);
            res.json(status);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // --- Inbox (activity feed) ---
    app.get('/api/inbox', async (req, res) => {
        try {
            const mgr = await getManager();
            const items = await getInboxItems(mgr);
            res.json(items);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // --- Channels (multi-agent workspaces) ---

    app.get('/api/channels', async (req, res) => {
        try {
            const mgr = await getManager();
            const channels = await listChannels();
            const enriched = channels.map((c) => ({
                ...c,
                agents: (c.agentIds || []).map((id) => {
                    const a = mgr.getAgent(id);
                    return a
                        ? { id: a.id, name: a.name || a.id, persona: a.personaId }
                        : { id, name: id, persona: null };
                }),
            }));
            res.json(enriched);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/channels', async (req, res) => {
        try {
            const mgr = await getManager();
            const { name, description, agentIds = [], settings = {} } = req.body;
            if (!name) return res.status(400).json({ error: 'Channel name is required' });

            const validIds = agentIds.filter((id) => mgr.getAgent(id));
            const channel = await createChannel({ name, description, agentIds: validIds, settings });
            res.json(channel);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/channels/:id', async (req, res) => {
        try {
            const mgr = await getManager();
            const channel = await getChannel(req.params.id);
            if (!channel) return res.status(404).json({ error: 'Channel not found' });

            res.json({
                ...channel,
                agents: (channel.agentIds || []).map((id) => {
                    const a = mgr.getAgent(id);
                    return a ? { id: a.id, name: a.name, persona: a.personaId } : { id, name: id };
                }),
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/channels/:id/agents', async (req, res) => {
        try {
            const mgr = await getManager();
            const { agentId } = req.body;
            if (!agentId || !mgr.getAgent(agentId)) {
                return res.status(400).json({ error: 'Valid agentId required' });
            }
            const channel = await addAgentToChannel(req.params.id, agentId);
            res.json(channel);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/channels/:id', async (req, res) => {
        try {
            const channel = await updateChannel(req.params.id, req.body);
            res.json(channel);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/channels/:id', async (req, res) => {
        try {
            const result = await deleteChannel(req.params.id);
            res.json(result);
        } catch (e) {
            const status = e.message === 'Channel not found' ? 404 : 500;
            res.status(status).json({ error: e.message });
        }
    });

    app.get('/api/channels/:id/messages', async (req, res) => {
        try {
            const messages = await getChannelMessages(req.params.id);
            res.json(messages);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/channels/:id/chat/stream', async (req, res) => {
        try {
            const { message, model, images, replyTo } = req.body;
            const channelId = req.params.id;

            if (!message && (!images || images.length === 0)) {
                return res.status(400).send('Missing message content');
            }

            const mgr = await getManager();
            let channel = await getChannel(channelId);
            if (!channel) return res.status(404).send('Channel not found');

            const settings = normalizeChannelSettings(channel.settings);

            await appendChannelMessage(channelId, {
                role: 'user',
                author: 'You',
                content: message || '',
                replyTo: replyTo || null,
            });

            const targets = resolveChannelTargets(message, channel, mgr);
            if (targets.length === 0) {
                return res.status(400).send('No agents in this channel. Add agents first.');
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const confirmCallback = async (msg) => {
                console.log(`[WebUI Auto-Confirm] ${msg}`);
                return true;
            };

            const replyPrefix = formatReplyPrefix(replyTo);
            const messageBody = `${replyPrefix}${message || ''}`;
            const peerResponses = [];

            async function runAgentTurn(agentId, { prompt, mode, kind = 'response' }) {
                const agent = mgr.getAgent(agentId);
                if (!agent) return null;

                if (model) {
                    const resolvedModel = await resolveRequestedModel(model);
                    if (resolvedModel && agent.provider?.model !== resolvedModel) {
                        await agent.updateModel(resolvedModel);
                    }
                }

                channel = await getChannel(channelId);
                const channelContext = buildChannelContextBlock(channel, mgr, {
                    agentId,
                    peerResponsesThisTurn: peerResponses,
                    mode,
                });

                res.write(`data: ${JSON.stringify({ type: 'agent_start', agent: agent.name || agent.id, agentId: agent.id, kind })}\n\n`);

                let userMessage = prompt;
                if (images?.length > 0 && mode === 'user_turn') {
                    userMessage = [
                        { type: 'text', text: prompt },
                        ...images.map((img) => ({ type: 'image_url', image_url: { url: img } })),
                    ];
                }

                let fullResponse = '';
                const onUpdate = (data) => {
                    if (data.type === 'token') {
                        fullResponse += data.content || '';
                        res.write(`data: ${JSON.stringify({ ...data, agent: agent.name || agent.id, agentId: agent.id, kind })}\n\n`);
                    } else {
                        res.write(`data: ${JSON.stringify({ ...data, agent: agent.name || agent.id, agentId: agent.id, kind })}\n\n`);
                    }
                };

                try {
                    await agent.chat(userMessage, confirmCallback, onUpdate, {
                        channelContext,
                        channelId,
                        replyTo: replyTo || null,
                    });

                    if (isNoReplyContent(fullResponse)) {
                        res.write(`data: ${JSON.stringify({ type: 'agent_skip', agentId: agent.id, reason: 'no_reply' })}\n\n`);
                        return null;
                    }

                    const entry = {
                        role: 'assistant',
                        author: agent.name || agent.id,
                        agentId: agent.id,
                        content: fullResponse || '(completed)',
                        kind: mode === 'discussion' ? 'discussion' : 'response',
                    };
                    await appendChannelMessage(channelId, entry);

                    const result = {
                        agentId: agent.id,
                        author: agent.name || agent.id,
                        content: fullResponse || '',
                    };
                    peerResponses.push(result);
                    return result;
                } catch (err) {
                    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message, agentId: agent.id })}\n\n`);
                    return null;
                } finally {
                    res.write(`data: ${JSON.stringify({ type: 'agent_done', agentId: agent.id, kind })}\n\n`);
                }
            }

            // Phase 1: respond to the user (each agent sees prior replies this turn)
            for (const agentId of targets) {
                await runAgentTurn(agentId, { prompt: messageBody, mode: 'user_turn', kind: 'response' });
            }

            // Phase 2: optional bounded discussion (one round, [NO_REPLY] to skip — no infinite loops)
            if (settings.agentDiscussion && settings.maxDiscussionRounds > 0 && peerResponses.length > 1) {
                const discussionTargets = resolveDiscussionTargets(channel, peerResponses);

                for (let round = 0; round < settings.maxDiscussionRounds; round++) {
                    for (const agentId of discussionTargets) {
                        const discussionPrompt = buildDiscussionPrompt(peerResponses);
                        await runAgentTurn(agentId, {
                            prompt: discussionPrompt,
                            mode: 'discussion',
                            kind: 'discussion',
                        });
                    }
                }
            }

            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
        } catch (e) {
            console.error('Channel chat stream error:', e);
            res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
            res.end();
        }
    });

    // --- Individual agent sessions (DMs) ---
    app.get('/api/sessions', async (req, res) => {
        try {
            const mgr = await getManager();
            const sessions = Array.from(mgr.agents.values()).map(a => ({
                id: a.id,
                name: a.name || a.id,
                persona: a.personaId,
                model: a.initialModel || null,
                safeMode: a.safeMode,
                customSystemPrompt: a.customSystemPrompt || null,
            }));
            res.json(sessions);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/sessions/:id', async (req, res) => {
        try {
            const mgr = await getManager();
            const details = mgr.getAgentDetails(req.params.id);
            if (!details) return res.status(404).json({ error: 'Agent not found' });
            res.json(details);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/sessions/:id', async (req, res) => {
        try {
            const mgr = await getManager();
            const updated = await mgr.updateAgent(req.params.id, req.body);
            res.json(updated);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/sessions/:id', async (req, res) => {
        try {
            const mgr = await getManager();
            const result = await mgr.deleteAgent(req.params.id);
            res.json(result);
        } catch (e) {
            const status =
                e.message?.includes('not found') ? 404
                : e.message?.includes('last agent') ? 400
                : 500;
            res.status(status).json({ error: e.message });
        }
    });

    // Get available models from config / provider
    app.get('/api/models', async (req, res) => {
        try {
            const config = await loadConfig();
            let models = [];

            if (config.provider === 'compatible') {
                const remoteModels = await fetchCompatibleModels(config);
                if (remoteModels?.length) {
                    models = remoteModels;
                }
            } else if (config.provider === 'grok-cli') {
                const remoteModels = await fetchGrokCliModels(config);
                if (remoteModels?.length) {
                    models = remoteModels;
                }
            }

            if (models.length === 0 && config.model) {
                models = [{ id: config.model, name: config.model }];
            }

            if (models.length === 0) {
                models = [{ id: 'default', name: 'Default Model' }];
            }

            // Put configured model first so the UI defaults to it
            if (config.model) {
                models.sort((a, b) => {
                    if (a.id === config.model) return -1;
                    if (b.id === config.model) return 1;
                    return a.id.localeCompare(b.id);
                });
            }

            res.json({
                defaultModel: config.model || models[0].id,
                models,
            });
        } catch (e) {
            res.status(500).json({
                defaultModel: 'default',
                models: [{ id: 'default', name: 'Default Model' }],
            });
        }
    });

    // Get available personas
    app.get('/api/personas', async (req, res) => {
        try {
            const personas = await listPersonas();
            res.json(personas);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/personas/:id', async (req, res) => {
        try {
            const persona = await getPersonaById(req.params.id);
            res.json(persona);
        } catch (e) {
            res.status(404).json({ error: e.message });
        }
    });

    app.put('/api/personas/:id', async (req, res) => {
        try {
            const persona = await updatePersona(req.params.id, req.body);
            res.json(persona);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Create new persona
    app.post('/api/personas', async (req, res) => {
        try {
            const persona = await savePersona(req.body);
            res.json(persona);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Get available tools
    app.get('/api/tools', async (req, res) => {
        try {
            const { toolDefinitions } = await import('./index.js');
            res.json(toolDefinitions);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Create new session
    app.post('/api/sessions', async (req, res) => {
        try {
            const mgr = await getManager();
            const { personaId, name } = req.body;
            // Generate a simple name/id if not provided
            const agent = await mgr.createAgent(personaId || 'default', name);
            res.json({
                id: agent.id,
                name: agent.name,
                persona: agent.personaId
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Get chat history for a session
    app.get('/api/history/:id', async (req, res) => {
        try {
            const mgr = await getManager();
            const agent = mgr.getAgent(req.params.id);
            if (!agent) {
                return res.status(404).json({ error: 'Session not found' });
            }
            res.json(agent.memory);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Send message
    // Stream message
    app.post('/api/chat/stream', async (req, res) => {
        try {
            const { sessionId, message, model, images, replyTo } = req.body;

            console.log(`[WebUI] Stream Request: session=${sessionId}, message length=${message ? message.length : 0}, images count=${images ? images.length : 0}`);
            if (images && images.length > 0) {
                console.log(`[WebUI] First image size: ${images[0].length} chars`);
            }

            if (!sessionId || (!message && (!images || images.length === 0))) {
                return res.status(400).send('Missing sessionId or message content');
            }

            const mgr = await getManager();
            const agent = mgr.getAgent(sessionId);
            if (!agent) {
                return res.status(404).send('Session not found');
            }

            // Only override model when the client explicitly sends one
            if (model) {
                const resolvedModel = await resolveRequestedModel(model);
                if (resolvedModel && agent.provider?.model !== resolvedModel) {
                    await agent.updateModel(resolvedModel);
                }
            }

            // Construct user message (text or multimodal)
            let userMessage = message;
            if (images && images.length > 0) {
                userMessage = [
                    { type: 'text', text: message || '' },
                    ...images.map(img => ({
                        type: 'image_url',
                        image_url: { url: img }
                    }))
                ];
            }

            // Setup SSE
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // Simple auto-confirmation for tools
            const confirmCallback = async (msg) => {
                console.log(`[WebUI Auto-Confirm] ${msg}`);
                return true;
            };

            const onUpdate = (data) => {
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            };

            await agent.chat(userMessage, confirmCallback, onUpdate, {
                replyTo: replyTo || null,
                messageId: req.body.messageId || null,
            });
            
            res.end();
        } catch (e) {
            console.error('Chat stream error:', e);
            res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
            res.end();
        }
    });

    app.post('/api/chat', async (req, res) => {
        try {
            const { sessionId, message } = req.body;
            if (!sessionId || !message) {
                return res.status(400).json({ error: 'Missing sessionId or message' });
            }

            const mgr = await getManager();
            const agent = mgr.getAgent(sessionId);
            if (!agent) {
                return res.status(404).json({ error: 'Session not found' });
            }

            // Simple auto-confirmation for tools
            const confirmCallback = async (msg) => {
                console.log(`[WebUI Auto-Confirm] ${msg}`);
                return true;
            };

            const response = await agent.chat(message, confirmCallback);
            res.json({ response });
        } catch (e) {
            console.error('Chat error:', e);
            res.status(500).json({ error: e.message });
        }
    });

    return new Promise((resolve, reject) => {
      try {
        server = app.listen(8456, () => {
            console.log('Chat UI server started on port 8456');
            resolve('Chat UI server started successfully at http://localhost:8456');
        });
        
        server.on('error', (e) => {
             if (e.code === 'EADDRINUSE') {
                // If port is in use, assume it's our server or another instance
                console.log('Port 8456 is already in use.');
                resolve('Chat UI server is already running at http://localhost:8456 (port 8456 in use)');
             } else {
                reject(e);
             }
        });
      } catch (error) {
        reject(error);
      }
    });
  },
};
