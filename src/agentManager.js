import { Agent } from './agent.js';
import { listPersonas } from './personas/index.js';
import { loadConfig } from './config.js';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const SESSION_FILE = path.join(process.cwd(), '.agent', 'sessions.json');

export async function syncSessionModels(model) {
    if (!model) return;
    try {
        const content = await fs.readFile(SESSION_FILE, 'utf-8');
        const data = JSON.parse(content);
        if (!Array.isArray(data.agents)) return;

        for (const agent of data.agents) {
            agent.model = model;
        }

        await fs.writeFile(SESSION_FILE, JSON.stringify(data, null, 2));
    } catch {
        // No session file yet
    }
}

export class AgentManager {
    constructor() {
        this.agents = new Map();
        this.activeAgentId = null;
    }

    async init() {
        await this.loadState();
    }

    async saveState() {
        const data = {
            activeAgentId: this.activeAgentId,
            agents: Array.from(this.agents.values()).map(a => ({
                id: a.id,
                name: a.name,
                personaId: a.personaId,
                safeMode: a.safeMode,
                model: a.initialModel || null,
                customSystemPrompt: a.customSystemPrompt || null,
            }))
        };
        try {
            await fs.mkdir(path.dirname(SESSION_FILE), { recursive: true });
            await fs.writeFile(SESSION_FILE, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error("Failed to save session state:", e);
        }
    }

    async loadState() {
        try {
            const content = await fs.readFile(SESSION_FILE, 'utf-8');
            const data = JSON.parse(content);
            const config = await loadConfig();
            
            for (const agentData of data.agents) {
                const model = agentData.model || config.model;
                const agent = new Agent({
                    id: agentData.id,
                    name: agentData.name,
                    personaId: agentData.personaId,
                    safeMode: agentData.safeMode,
                    model,
                    customSystemPrompt: agentData.customSystemPrompt || null,
                    manager: this
                });
                await agent.init();
                this.agents.set(agent.id, agent);
            }
            
            if (data.activeAgentId && this.agents.has(data.activeAgentId)) {
                this.activeAgentId = data.activeAgentId;
            }
        } catch (e) {
            // Ignore if file doesn't exist
        }
    }

    async createAgent(personaId, customId = null) {
        // Unique ID for the agent instance
        // If customId is provided, treat it as the name/id request
        
        // Logic update: User requested stable IDs. 
        // If customId is passed, use it as ID (and name if not conflicting).
        // If not, generate ID.
        
        const id = customId || `${personaId}-${Math.random().toString(36).substr(2, 4)}`;
        
        // Check if agent with this ID already exists
        if (this.agents.has(id)) {
            return this.agents.get(id);
        }

        console.log(chalk.gray(`Creating agent ${id} with persona ${personaId}...`));
        
        const agent = new Agent({ 
            personaId, 
            id: id,     // Stable ID
            name: id,   // Display name defaults to ID (will be overwritten by persona name if ID looks generated)
            manager: this 
        });
        await agent.init();
        
        this.agents.set(agent.id, agent);
        
        if (!this.activeAgentId) {
            this.activeAgentId = agent.id;
        }
        
        await this.saveState();
        return agent;
    }

    getAgent(id) {
        return this.agents.get(id);
    }

    getActiveAgent() {
        if (!this.activeAgentId && this.agents.size > 0) {
            this.activeAgentId = this.agents.keys().next().value;
        }
        return this.agents.get(this.activeAgentId);
    }

    setActiveAgent(id) {
        if (this.agents.has(id)) {
            this.activeAgentId = id;
            this.saveState(); // Persist active agent choice
            return true;
        }
        return false;
    }

    listAgents() {
        return Array.from(this.agents.values()).map(a => ({
            id: a.id,
            name: a.name,
            persona: a.personaId,
            description: a.persona?.description || a.persona?.name,
            safeMode: a.safeMode,
            model: a.initialModel || null,
            customSystemPrompt: a.customSystemPrompt || null,
        }));
    }

    async updateAgent(id, updates) {
        const agent = this.agents.get(id);
        if (!agent) throw new Error(`Agent ${id} not found`);

        await agent.applySettings({
            name: updates.name,
            model: updates.model,
            customSystemPrompt: updates.customSystemPrompt,
            safeMode: updates.safeMode,
            personaUpdates: updates.personaUpdates,
        });

        return this.getAgentDetails(id);
    }

    getAgentDetails(id) {
        const agent = this.agents.get(id);
        if (!agent) return null;
        return {
            id: agent.id,
            name: agent.name,
            personaId: agent.personaId,
            personaName: agent.persona?.name,
            description: agent.persona?.description || '',
            systemPrompt: agent.persona?.systemPrompt || '',
            customSystemPrompt: agent.customSystemPrompt || '',
            allowedTools: agent.persona?.allowedTools || [],
            model: agent.initialModel || null,
            safeMode: agent.safeMode,
        };
    }
    
    async listAvailablePersonas() {
        return await listPersonas();
    }
}
