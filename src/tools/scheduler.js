import fs from 'fs/promises';
import path from 'path';
import cron from 'node-cron';
import chalk from 'chalk';
import { runCommand } from './shell.js';

const SCHEDULE_FILE = path.join(process.cwd(), '.agent', 'scheduled_tasks.json');
const BACKGROUND_FILE = path.join(process.cwd(), '.agent', 'background_tasks.json');
const MAX_BACKGROUND_HISTORY = 100;

const scheduledTasks = new Map();
const backgroundTasks = new Map();

let agentManagerGetter = null;

export function registerAgentManagerGetter(getter) {
    agentManagerGetter = getter;
}

async function getAgentManager() {
    if (agentManagerGetter) {
        const mgr = agentManagerGetter();
        return mgr instanceof Promise ? mgr : mgr;
    }
    const { AgentManager } = await import('../agentManager.js');
    const mgr = new AgentManager();
    await mgr.init();
    return mgr;
}

function resolveAgent(mgr, agentId) {
    let agent = mgr.getAgent(agentId);
    if (!agent) {
        agent = Array.from(mgr.agents.values()).find(
            (a) =>
                a.id === agentId ||
                a.name?.toLowerCase() === agentId.toLowerCase() ||
                a.personaId === agentId
        );
    }
    return agent;
}

function createTaskId(prefix, id) {
    const baseId = id && typeof id === 'string' ? id : null;
    return baseId && !scheduledTasks.has(baseId)
        ? baseId
        : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createCommandJob(taskId, expr, command, cwd) {
    return cron.schedule(expr, async () => {
        const { stdout, stderr, error } = await runCommand(command, [], cwd);
        if (error) {
            console.error(chalk.red(`Scheduled task ${taskId} error:`), error.message || error);
        } else if (stdout || stderr) {
            console.log(chalk.gray(`Scheduled task ${taskId} output:`), stdout || stderr);
        }
    });
}

function createAgentCronJob(taskId, expr, agentId, instruction) {
    return cron.schedule(expr, async () => {
        const runId = `${taskId}_${Date.now()}`;
        console.log(chalk.cyan(`Running scheduled agent task ${taskId} (${runId})`));
        await executeAgentTask(runId, agentId, instruction, { scheduledFrom: taskId });
    });
}

async function loadScheduledTasksFromDisk() {
    try {
        const data = await fs.readFile(SCHEDULE_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) return [];
        return parsed;
    } catch {
        return [];
    }
}

async function persistScheduledTasks() {
    const data = [];
    for (const [id, task] of scheduledTasks.entries()) {
        const entry = {
            id,
            type: task.type,
            cron_expression: task.cron_expression,
        };
        if (task.type === 'command') {
            entry.command = task.command;
            entry.cwd = task.cwd;
        } else {
            entry.agent_id = task.agent_id;
            entry.instruction = task.instruction;
        }
        data.push(entry);
    }
    await fs.mkdir(path.dirname(SCHEDULE_FILE), { recursive: true });
    await fs.writeFile(SCHEDULE_FILE, JSON.stringify(data, null, 2));
}

async function persistBackgroundTasks() {
    const entries = Array.from(backgroundTasks.values())
        .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
        .slice(0, MAX_BACKGROUND_HISTORY);
    await fs.mkdir(path.dirname(BACKGROUND_FILE), { recursive: true });
    await fs.writeFile(BACKGROUND_FILE, JSON.stringify(entries, null, 2));
}

async function loadBackgroundTasksFromDisk() {
    try {
        const data = await fs.readFile(BACKGROUND_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) return;
        for (const task of parsed) {
            if (task?.id) backgroundTasks.set(task.id, task);
        }
    } catch {
        // No history yet
    }
}

async function initScheduledTasks() {
    const tasks = await loadScheduledTasksFromDisk();
    for (const t of tasks) {
        if (!t?.id || !t.cron_expression || !cron.validate(t.cron_expression)) continue;
        if (scheduledTasks.has(t.id)) continue;

        const type = t.type || 'command';
        if (type === 'agent') {
            if (!t.agent_id || !t.instruction) continue;
            const job = createAgentCronJob(t.id, t.cron_expression, t.agent_id, t.instruction);
            scheduledTasks.set(t.id, {
                job,
                type: 'agent',
                agent_id: t.agent_id,
                instruction: t.instruction,
                cron_expression: t.cron_expression,
            });
        } else {
            if (!t.command) continue;
            const cwd = t.cwd || process.cwd();
            const job = createCommandJob(t.id, t.cron_expression, t.command, cwd);
            scheduledTasks.set(t.id, {
                job,
                type: 'command',
                command: t.command,
                cron_expression: t.cron_expression,
                cwd,
            });
        }
    }
}

async function executeAgentTask(taskId, agentId, instruction, meta = {}) {
    const startedAt = new Date().toISOString();
    backgroundTasks.set(taskId, {
        id: taskId,
        agent_id: agentId,
        instruction,
        status: 'running',
        startedAt,
        ...meta,
    });
    await persistBackgroundTasks();

    try {
        const mgr = await getAgentManager();
        const agent = resolveAgent(mgr, agentId);
        if (!agent) {
            throw new Error(`Agent '${agentId}' not found`);
        }

        const confirmCallback = async () => true;
        const result = await agent.chat(instruction, confirmCallback);

        backgroundTasks.set(taskId, {
            id: taskId,
            agent_id: agent.id,
            agent_name: agent.name,
            instruction,
            status: 'completed',
            startedAt,
            completedAt: new Date().toISOString(),
            result: typeof result === 'string' ? result : JSON.stringify(result),
            ...meta,
        });
        console.log(chalk.green(`Background agent task ${taskId} completed (${agent.name})`));
    } catch (error) {
        backgroundTasks.set(taskId, {
            id: taskId,
            agent_id: agentId,
            instruction,
            status: 'failed',
            startedAt,
            completedAt: new Date().toISOString(),
            error: error.message,
            ...meta,
        });
        console.error(chalk.red(`Background agent task ${taskId} failed:`), error.message);
    }

    await persistBackgroundTasks();
    return backgroundTasks.get(taskId);
}

function runAgentTaskInBackground(taskId, agentId, instruction, meta = {}) {
    executeAgentTask(taskId, agentId, instruction, meta).catch((e) => {
        console.error('Unhandled background task error:', e);
    });
}

await Promise.all([
    initScheduledTasks().catch((e) => console.error('Failed to restore scheduled tasks:', e)),
    loadBackgroundTasksFromDisk().catch((e) => console.error('Failed to load background tasks:', e)),
]);

export const schedulerToolDefinitions = [
    {
        name: 'schedule_task',
        description: 'Schedule a shell command to run periodically using a cron expression (node-cron).',
        parameters: {
            type: 'object',
            properties: {
                cron_expression: { type: 'string', description: "Cron expression, e.g. '0 * * * *' (every hour)." },
                command: { type: 'string', description: 'Shell command to execute.' },
                id: { type: 'string', description: 'Optional identifier for this scheduled task.' },
            },
            required: ['cron_expression', 'command'],
        },
    },
    {
        name: 'schedule_agent_task',
        description: 'Schedule an agent instruction to run in the background on a cron schedule. The agent runs autonomously each time the cron fires.',
        parameters: {
            type: 'object',
            properties: {
                cron_expression: { type: 'string', description: "Cron expression, e.g. '0 9 * * *' (daily at 9am)." },
                agent_id: { type: 'string', description: 'Target agent id, name, or persona (e.g. pm, lead, primary).' },
                instruction: { type: 'string', description: 'Instruction/message for the agent to execute on each run.' },
                id: { type: 'string', description: 'Optional identifier for this scheduled task.' },
            },
            required: ['cron_expression', 'agent_id', 'instruction'],
        },
    },
    {
        name: 'run_agent_task_background',
        description: 'Run an agent instruction immediately in the background without blocking the current conversation. Returns a task id to check later.',
        parameters: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'Target agent id, name, or persona.' },
                instruction: { type: 'string', description: 'Instruction for the agent to execute.' },
                id: { type: 'string', description: 'Optional task id.' },
            },
            required: ['agent_id', 'instruction'],
        },
    },
    {
        name: 'list_scheduled_tasks',
        description: 'List all cron-scheduled tasks (shell commands and agent tasks).',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'list_background_tasks',
        description: 'List recent background agent task runs and their status (running, completed, failed).',
        parameters: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Max tasks to return (default 20).' },
            },
        },
    },
    {
        name: 'get_background_task',
        description: 'Get the status and result of a background agent task by id.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Background task id.' },
            },
            required: ['id'],
        },
    },
    {
        name: 'cancel_scheduled_task',
        description: 'Cancel a previously scheduled cron task by its identifier.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Identifier of the scheduled task to cancel.' },
            },
            required: ['id'],
        },
    },
];

export function getRecentBackgroundTasks(limit = 20) {
    return Array.from(backgroundTasks.values())
        .sort((a, b) => (b.completedAt || b.startedAt || '').localeCompare(a.completedAt || a.startedAt || ''))
        .slice(0, Math.max(1, limit));
}

export const schedulerTools = {
    schedule_task: async ({ cron_expression, command, id }, { agent, confirmCallback }) => {
        if (!cron.validate(cron_expression)) {
            return `Invalid cron expression: ${cron_expression}`;
        }
        const taskId = createTaskId('task', id);
        if (scheduledTasks.has(taskId)) {
            return `Task with id ${taskId} already exists.`;
        }
        const cwd = agent?.cwd || process.cwd();
        if (agent?.safeMode) {
            if (!confirmCallback) return 'Error: Safe Mode enabled but no confirmation callback provided.';
            const approved = await confirmCallback(`[SAFE MODE] Schedule command?\n${command}\nCron: ${cron_expression}`);
            if (!approved) return 'Task scheduling cancelled by user.';
        }
        const job = createCommandJob(taskId, cron_expression, command, cwd);
        scheduledTasks.set(taskId, {
            job,
            type: 'command',
            command,
            cron_expression,
            cwd,
        });
        await persistScheduledTasks();
        return `Scheduled command task "${taskId}" with cron "${cron_expression}".`;
    },

    schedule_agent_task: async ({ cron_expression, agent_id, instruction, id }, { agent, confirmCallback }) => {
        if (!cron.validate(cron_expression)) {
            return `Invalid cron expression: ${cron_expression}`;
        }
        const taskId = createTaskId('agent_task', id);
        if (scheduledTasks.has(taskId)) {
            return `Task with id ${taskId} already exists.`;
        }
        if (agent?.safeMode) {
            if (!confirmCallback) return 'Error: Safe Mode enabled but no confirmation callback provided.';
            const approved = await confirmCallback(
                `[SAFE MODE] Schedule agent task for ${agent_id}?\nCron: ${cron_expression}\nInstruction: ${instruction}`
            );
            if (!approved) return 'Agent task scheduling cancelled by user.';
        }
        const job = createAgentCronJob(taskId, cron_expression, agent_id, instruction);
        scheduledTasks.set(taskId, {
            job,
            type: 'agent',
            agent_id,
            instruction,
            cron_expression,
        });
        await persistScheduledTasks();
        return `Scheduled agent task "${taskId}" for agent "${agent_id}" with cron "${cron_expression}". The agent will run in the background on each trigger.`;
    },

    run_agent_task_background: async ({ agent_id, instruction, id }, { agent, confirmCallback }) => {
        const taskId = id && typeof id === 'string' && !backgroundTasks.has(id)
            ? id
            : createTaskId('bg', id);
        if (backgroundTasks.get(taskId)?.status === 'running') {
            return `Background task ${taskId} is already running.`;
        }
        if (agent?.safeMode) {
            if (!confirmCallback) return 'Error: Safe Mode enabled but no confirmation callback provided.';
            const approved = await confirmCallback(
                `[SAFE MODE] Run background agent task for ${agent_id}?\n${instruction}`
            );
            if (!approved) return 'Background task cancelled by user.';
        }
        runAgentTaskInBackground(taskId, agent_id, instruction, { requestedBy: agent?.id || null });
        return `Started background agent task "${taskId}" for agent "${agent_id}". Use get_background_task or list_background_tasks to check progress.`;
    },

    list_scheduled_tasks: async () => {
        if (scheduledTasks.size === 0) {
            return 'No scheduled tasks.';
        }
        const lines = [];
        for (const [id, task] of scheduledTasks.entries()) {
            if (task.type === 'agent') {
                lines.push(`${id} | type: agent | cron: ${task.cron_expression} | agent: ${task.agent_id} | instruction: ${task.instruction}`);
            } else {
                lines.push(`${id} | type: command | cron: ${task.cron_expression} | command: ${task.command} | cwd: ${task.cwd}`);
            }
        }
        return lines.join('\n');
    },

    list_background_tasks: async ({ limit = 20 } = {}) => {
        const tasks = Array.from(backgroundTasks.values())
            .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
            .slice(0, Math.max(1, limit));
        if (!tasks.length) return 'No background tasks yet.';
        return tasks
            .map((t) => {
                const name = t.agent_name || t.agent_id || 'unknown';
                return `${t.id} | status: ${t.status} | agent: ${name} | started: ${t.startedAt}${t.error ? ` | error: ${t.error}` : ''}`;
            })
            .join('\n');
    },

    get_background_task: async ({ id }) => {
        const task = backgroundTasks.get(id);
        if (!task) return `Background task ${id} not found.`;
        const summary = {
            id: task.id,
            status: task.status,
            agent_id: task.agent_id,
            agent_name: task.agent_name,
            instruction: task.instruction,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            error: task.error,
            result: task.result,
        };
        return JSON.stringify(summary, null, 2);
    },

    cancel_scheduled_task: async ({ id }) => {
        const task = scheduledTasks.get(id);
        if (!task) {
            return `Task ${id} not found.`;
        }
        task.job.stop();
        scheduledTasks.delete(id);
        await persistScheduledTasks();
        return `Cancelled scheduled task ${id}.`;
    },
};
