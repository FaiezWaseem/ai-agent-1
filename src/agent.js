import { getAIProvider } from './ai/index.js';
import { loadConfig } from './config.js';
import { readFile, writeFile, listFiles } from './tools/fs.js';
import { runCommand } from './tools/shell.js';
import { tools as toolImplementations, toolDefinitions } from './tools/index.js';
import { loadPersona } from './personas/index.js';
import { loadChatHistory, saveChatHistory } from './chatStorage.js';
import { summarizeMemory } from './memory/summary.js';
import { sendMessage as sendTelegramMessage } from './tools/telegram.js';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs';

export class Agent {
  constructor(config = {}) {
    this.provider = null;
    this.memory = []; // Store chat history
    this._ephemeralContextPrefix = null;
    
    // Config properties
    this.cwd = process.cwd();
    this.personaId = config.personaId || 'default';
    this.persona = null; // Loaded in init()
    this.initialModel = config.model || null;
    this.customSystemPrompt = config.customSystemPrompt || null;
    this.additionalContext = config.context || ''; // Extra instructions (e.g. for integrations)
    
    // ID is stable identifier (e.g. for storage)
    // Name is display name / persona name
    this.id = config.id || config.name || `${this.personaId}-${Math.random().toString(36).substr(2, 4)}`;
    this.name = config.name || null; // Will be set from persona if null
    
    this.manager = config.manager || null;
    this.safeMode = config.safeMode || false; // If true, requires confirmation for side-effects
    
    // Tools will be filtered in init()
    this.toolsDefinition = []; 
    this.tools = {};
  }

  async init() {
    const config = await loadConfig();
    const model = this.initialModel || config.model;
    this.provider = await getAIProvider(model);
    console.log(chalk.gray(`Agent ${this.id} using model: ${this.provider.model}`));

    this.persona = await loadPersona(this.personaId);

    if (!this.name) {
        this.name = this.persona.name;
    }

    const allowed = new Set(this.persona.allowedTools || []);
    this.toolsDefinition = toolDefinitions.filter(t => allowed.has(t.name));
    this.tools = {};
    for (const name of allowed) {
        if (toolImplementations[name]) {
            this.tools[name] = toolImplementations[name];
        }
    }

    const systemPrompt = this._buildSystemPrompt();
    this._setSystemMessage(systemPrompt);

    try {
        const history = await loadChatHistory(this.id);
        if (history && history.length > 0) {
            if (history[0].role === 'system') {
                history[0].content = systemPrompt;
            } else {
                history.unshift({ role: 'system', content: systemPrompt });
            }
            this.memory = history;
        }
    } catch (e) {
        console.error("Failed to load chat history:", e);
        try {
            await sendTelegramMessage(`Agent ${this.id} failed to load chat history: ${e.message || e}`);
        } catch {}
    }
  }

  _buildSystemPrompt() {
    const scriptDir = path.join(os.homedir(), '.agent', 'scripts');
    if (!fs.existsSync(scriptDir)) {
        try {
            fs.mkdirSync(scriptDir, { recursive: true });
        } catch (e) {
            console.error('Failed to create script directory:', e);
        }
    }

    const agentDir = this.id !== 'default' ? `.agent/${this.id}` : '.agent';
    const taskPlanPath = `${agentDir}/task_plan.md`;
    const notesPath = `${agentDir}/notes.md`;
    const personaPrompt = this.customSystemPrompt || this.persona?.systemPrompt || '';

    let systemPrompt = `You are ${this.name}.
${personaPrompt}

CORE OPERATIONAL RULES:
1. You are an autonomous agent. You are expected to ACT, not just chat.
2. When a user asks for a task, use your tools to complete it immediately.
3. Do not refuse tasks. If you are unsure, ask for clarification, but bias towards action.

You have access to the following tools: ${this.toolsDefinition.map(t => t.name).join(', ')}.

IMPORTANT:
1. ALWAYS use the provided tools to perform actions. 
2. Do NOT describe what you are going to do with a tool in JSON format in your text response. USE THE NATIVE TOOL CALLING MECHANISM.
3. If native tool calling fails, output a JSON block in this exact format:
\`\`\`json
{ "tool": "tool_name", "args": { "param": "value" } }
\`\`\`
4. Do not hallucinate file contents.
5. When navigating directories, use change_directory (cd) and read_dir.

PLANNING & PERSISTENCE (CRITICAL):
For any complex task (multi-step, research, or development), you MUST use the "3-File Pattern" to prevent forgetting your goal:
1. Create \`${taskPlanPath}\` FIRST. Define the Goal, Phases (with checkboxes), and current Status.
2. Create \`${notesPath}\` for research findings.
3. READ \`${taskPlanPath}\` before starting each new step to refresh your context.
4. UPDATE \`${taskPlanPath}\` immediately after completing a phase (mark [x], update Status).
5. Log errors in \`${taskPlanPath}\` to build knowledge.

NOTE: Ensure the directory \`${agentDir}\` exists before writing files.
`;

    if (this.additionalContext) {
        systemPrompt += `\n\n${this.additionalContext}\n\nIMPORTANT: The script directory is available at: ${scriptDir}`;
    }

    return systemPrompt;
  }

  _setSystemMessage(systemPrompt) {
    if (this.memory.length > 0 && this.memory[0].role === 'system') {
        this.memory[0].content = systemPrompt;
    } else {
        this.memory.unshift({ role: 'system', content: systemPrompt });
    }
  }

  async applySettings({ name, model, customSystemPrompt, safeMode, personaUpdates }) {
    if (name !== undefined) this.name = name;
    if (safeMode !== undefined) this.safeMode = safeMode;
    if (customSystemPrompt !== undefined) {
        this.customSystemPrompt = customSystemPrompt || null;
    }

    if (personaUpdates) {
        const { updatePersona } = await import('./personas/index.js');
        await updatePersona(this.personaId, personaUpdates);
    }

    this.persona = await loadPersona(this.personaId);

    const allowed = new Set(this.persona.allowedTools || []);
    this.toolsDefinition = toolDefinitions.filter(t => allowed.has(t.name));
    this.tools = {};
    for (const toolName of allowed) {
        if (toolImplementations[toolName]) {
            this.tools[toolName] = toolImplementations[toolName];
        }
    }

    if (model !== undefined) {
        if (model) {
            await this.updateModel(model);
            this.initialModel = model;
        } else {
            this.initialModel = null;
            const globalConfig = await loadConfig();
            await this.updateModel(globalConfig.model);
        }
    }

    const systemPrompt = this._buildSystemPrompt();
    this._setSystemMessage(systemPrompt);

    if (this.manager) {
        await this.manager.saveState();
    }
  }

  async chat(userMessage, confirmCallback = null, onUpdate = null, options = {}) {
    // Channel chats inject workspace context per request — don't bloat agent memory with it.
    const memoryContent = options.channelContext
      ? (typeof userMessage === 'string' ? userMessage : userMessage)
      : userMessage;
    this._ephemeralContextPrefix = options.channelContext || null;

    const entry = { role: 'user', content: memoryContent };
    if (options.replyTo) entry.replyTo = options.replyTo;
    if (options.messageId) entry.id = options.messageId;
    this.memory.push(entry);
    
    // Check and summarize memory if needed
    await summarizeMemory(this);
    
    let loopCount = 0;
    const MAX_LOOPS = 50;
    let finalResponse = null;

    if (onUpdate) onUpdate({ type: 'thinking', message: 'Analyzing request...' });

    while (loopCount < MAX_LOOPS) {
        loopCount++;
        const messagesForModel = this._buildContext();
        
        const response = await this._safeChat(messagesForModel, this.toolsDefinition, onUpdate);
        try {
            sendTelegramMessage(`Agent ${this.id} response: ${response.content} \nTool Calls: ${JSON.stringify(response.toolCalls || [])}`);
        } catch {}
        
        // Fallback: Check for JSON tool calls in content if native toolCalls are empty
        if ((!response.toolCalls || response.toolCalls.length === 0) && response.content) {
            const inferred = this._inferToolCallsFromText(response.content);
            if (inferred.length > 0) {
                response.toolCalls = inferred;
                console.log(chalk.yellow(`(Detected ${inferred.length} JSON tool call(s) in text)`));
            }
        }

        if (response.content) {
            response.content = this._cleanAssistantContent(response.content);
        }

        // Handle Assistant Response
        // If content is present, add it to memory (some models output thought + tool call)
        // CRITICAL FIX: If tool calls are present, they MUST be included in the same assistant message
        // to satisfy OpenAI API requirements (tool_calls must be on the assistant message preceding tool roles).
        
        if (response.toolCalls && response.toolCalls.length > 0) {
             this.memory.push({ 
                 role: 'assistant', 
                 content: response.content || null, 
                 tool_calls: response.toolCalls 
             });
             if (response.content) {
                 finalResponse = response.content;
             }
        } else if (response.content) {
            this.memory.push({ role: 'assistant', content: response.content });
            finalResponse = response.content;
        }

        // If no tool calls, we are done
        if (!response.toolCalls || response.toolCalls.length === 0) {
            await saveChatHistory(this.id, this.memory, this);
            if (onUpdate) onUpdate({ type: 'done' });
            this._ephemeralContextPrefix = null;
            return finalResponse || response.content;
        }

        // If we have tool calls, execute them
        for (const call of response.toolCalls) {
            const toolName = call.function.name;
            const args = JSON.parse(call.function.arguments);
            
            console.log(chalk.cyan(`\n🛠️  Tool Call: ${chalk.bold(toolName)}`));
            console.log(chalk.gray(`   Args: ${JSON.stringify(args)}`));

            if (onUpdate) onUpdate({ type: 'tool_start', tool: toolName });

            let result;
            try {
                if (this.tools[toolName]) {
                    // Pass confirmCallback and agent instance (this) to tools
                    result = await this.tools[toolName](args, { confirmCallback, agent: this });
                } else {
                    result = `Error: Tool ${toolName} not found.`;
                }
            } catch (e) {
                result = `Error executing tool ${toolName}: ${e.message}`;
            }

            if (onUpdate) onUpdate({ type: 'tool_end', tool: toolName, result: typeof result === 'string' ? result.substring(0, 100) + '...' : 'Done' });

            // Add result to memory
            let memoryContent = typeof result === 'string' ? result : JSON.stringify(result);

            this.memory.push({
                role: 'tool',
                tool_call_id: call.id,
                name: toolName,
                content: memoryContent
            });
        }
    }
    
    if (onUpdate) onUpdate({ type: 'done' });
    this._ephemeralContextPrefix = null;
    return finalResponse;
  }

  async _safeChat(messages, tools, onUpdate = null) {
      try {
          return await this.provider.chat(messages, tools, onUpdate);
      } catch (e) {
        const message = e && e.message ? String(e.message) : String(e);
        // Catch various context length errors from different providers
        if (message.includes('Input tokens exceed') || 
            message.includes('context_length_exceeded') || 
            message.includes('maximum context length') ||
            message.includes('maximum prompt length')) {
            
            console.log(chalk.yellow('⚠️  Token limit exceeded. Retrying with smaller context...'));
            
            // Fallback 1: Limit to 20 messages
            try {
                const smaller = this._buildContext(20);
                return await this.provider.chat(smaller, tools, onUpdate);
            } catch (e2) {
                // Fallback 2: Limit to 10 messages AND truncate large outputs
                console.log(chalk.yellow('⚠️  Still too large. Retrying with minimal context and truncation...'));
                try {
                    const tiny = this._buildContext(10, true);
                    return await this.provider.chat(tiny, tools, onUpdate);
                } catch (e3) {
                    // Fallback 3: Last resort - just system prompt and last user message
                    console.log(chalk.red('⚠️  Critical token overflow. Retrying with single message...'));
                    const lastResort = this._buildContext(1, true);
                    return await this.provider.chat(lastResort, tools, onUpdate);
                }
            }
        }
        try {
            await sendTelegramMessage(`Agent ${this.id} provider.chat error: ${message}`);
        } catch {}
        throw e;
      }
  }

  _buildContext(maxMessages = 40, truncateLargeOutputs = false) {
    const systemMessages = this.memory.filter(m => m.role === 'system');
    const nonSystem = this.memory.filter(m => m.role !== 'system');
    let recent = nonSystem.slice(-maxMessages);
    
    // 1. Ensure context doesn't start with a 'tool' message (which would be orphaned)
    while (recent.length > 0 && recent[0].role === 'tool') {
        recent.shift();
    }
    
    // 2. SANITIZATION: Ensure every assistant message with tool_calls has matching tool messages
    // If not, we must remove the assistant message to prevent OpenAI 400 errors.
    const sanitizedRecent = [];
    let i = 0;
    while (i < recent.length) {
        const msg = recent[i];
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            // Look ahead for tool messages
            const expectedIds = new Set(msg.tool_calls.map(tc => tc.id));
            const foundIds = new Set();
            let j = i + 1;
            while (j < recent.length && recent[j].role === 'tool') {
                foundIds.add(recent[j].tool_call_id);
                j++;
            }
            
            // Check if we have all responses
            const missingIds = [...expectedIds].filter(id => !foundIds.has(id));
            
            if (missingIds.length === 0) {
                // All good, keep assistant and its tool responses
                sanitizedRecent.push(msg);
                // The tool messages will be added in the next iterations of the outer loop
                // (Wait, no, we need to skip them in outer loop if we processed them here? 
                //  Actually simpler: just validate here, and if valid, push msg. 
                //  The tool messages are just normal messages in the list, they will be processed when i increments.)
                // BUT: if we remove the assistant message, we MUST remove the tool messages too.
                i++; 
            } else {
                // BROKEN CHAIN! Missing tool responses.
                console.log(chalk.yellow(`⚠️  Removing broken tool call chain (Assistant msg ${i}). Missing IDs: ${missingIds.join(', ')}`));
                // Skip this assistant message AND any partial tool responses following it
                let k = i + 1;
                while (k < recent.length && recent[k].role === 'tool') {
                    k++;
                }
                i = k; // Jump past the broken chain
            }
        } else {
            // Normal message
            sanitizedRecent.push(msg);
            i++;
        }
    }
    
    let context = [...systemMessages, ...sanitizedRecent].map((msg) => {
        if (msg.role !== 'user' || !msg.replyTo) return msg;
        const prefix = `[Replying to ${msg.replyTo.author || msg.replyTo.agentId || 'message'}]: "${String(msg.replyTo.content || '').slice(0, 200)}"\n\n`;
        if (typeof msg.content === 'string') {
            return { role: msg.role, content: prefix + msg.content };
        }
        if (Array.isArray(msg.content)) {
            const copy = [...msg.content];
            const textPart = copy.find((p) => p.type === 'text');
            if (textPart) textPart.text = prefix + (textPart.text || '');
            else copy.unshift({ type: 'text', text: prefix });
            return { role: msg.role, content: copy };
        }
        return msg;
    });

    if (this._ephemeralContextPrefix) {
        for (let idx = context.length - 1; idx >= 0; idx--) {
            if (context[idx].role === 'user') {
                const msg = context[idx];
                if (typeof msg.content === 'string') {
                    context[idx] = {
                        ...msg,
                        content: `${this._ephemeralContextPrefix}\n\n---\n\nUSER MESSAGE IN CHANNEL:\n${msg.content}`,
                    };
                } else if (Array.isArray(msg.content)) {
                    const copy = [...msg.content];
                    const textPart = copy.find((p) => p.type === 'text');
                    const prefix = `${this._ephemeralContextPrefix}\n\n---\n\nUSER MESSAGE IN CHANNEL:\n`;
                    if (textPart) textPart.text = prefix + (textPart.text || '');
                    else copy.unshift({ type: 'text', text: prefix });
                    context[idx] = { ...msg, content: copy };
                }
                break;
            }
        }
    }

    if (truncateLargeOutputs) {
        // Create new objects to avoid mutating memory
        context = context.map(msg => {
            if ((msg.role === 'tool' || msg.role === 'assistant') && msg.content && msg.content.length > 1000) {
                return {
                    ...msg,
                    content: msg.content.substring(0, 1000) + '... [Content truncated due to size limit]'
                };
            }
            return msg;
        });
    } else {
        context = context.map(msg => {
            if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 6000) {
                return {
                    ...msg,
                    content: msg.content.substring(0, 6000) + '... [Tool output truncated]'
                };
            }
            return msg;
        });
    }
    
    return context;
  }

  _cleanAssistantContent(text) {
    if (!text || typeof text !== 'string') return text;
    let cleaned = text;
    cleaned = cleaned.replace(/^(The user message is:[^\n]*\n?)+/gim, '');
    cleaned = cleaned.replace(/^(First, the user message is[^\n]*\n?)+/gim, '');
    cleaned = cleaned.replace(/^(I'm (?:the|acting as)[^\n]*\n?)+/gim, '');
    cleaned = cleaned.replace(/^(My goal:[^\n]*\n?)+/gim, '');
    cleaned = cleaned.replace(/\{[^{}]*\}/g, (match) => {
      try {
        const parsed = JSON.parse(match);
        if (parsed && typeof parsed === 'object' && !parsed.tool && !parsed.name) {
          const keys = Object.keys(parsed);
          if (keys.length <= 3 && (keys.includes('path') || keys.includes('query') || keys.includes('category'))) {
            return '';
          }
        }
      } catch {}
      return match;
    });
    return cleaned.replace(/\n{3,}/g, '\n\n').trim();
  }

  _inferToolCallsFromText(content) {
    const calls = [];
    const seen = new Set();
    const patterns = [
      /```(?:json|python|js)?\s*(\{[\s\S]*?\})\s*```/g,
      /(\{[^{}]*\})/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(match[1]);
          const explicitName = parsed.tool || parsed.cmd_type || parsed.function;
          if (explicitName && this.tools[explicitName]) {
            const args = parsed.args || parsed.arguments || parsed.parameters || parsed;
            const key = `${explicitName}:${JSON.stringify(args)}`;
            if (!seen.has(key)) {
              seen.add(key);
              calls.push({
                id: `fallback-${Date.now()}-${calls.length}`,
                function: { name: explicitName, arguments: JSON.stringify(args) },
              });
            }
            continue;
          }

          for (const def of this.toolsDefinition) {
            const props = def.parameters?.properties || {};
            const required = def.parameters?.required || [];
            const keys = Object.keys(parsed).filter((k) => !['tool', 'name', 'args'].includes(k));
            if (!keys.length) continue;
            const matchesRequired = required.every((k) => k in parsed);
            const matchesProps = keys.every((k) => k in props);
            if (matchesRequired && matchesProps && this.tools[def.name]) {
              const key = `${def.name}:${JSON.stringify(parsed)}`;
              if (!seen.has(key)) {
                seen.add(key);
                calls.push({
                  id: `fallback-${Date.now()}-${calls.length}`,
                  function: { name: def.name, arguments: JSON.stringify(parsed) },
                });
              }
              break;
            }
          }
        } catch {
          // not JSON
        }
      }
    }

    return calls;
  }

  async _maybeSummarizeHistory() {
    const maxMessagesBeforeSummary = 200;
    if (this._hasSummary) return;
    if (this.memory.length <= maxMessagesBeforeSummary) return;
    try {
        await this._summarizeHistory();
    } catch (e) {
        console.error('Failed to summarize history:', e);
        try {
            await sendTelegramMessage(`Agent ${this.id} failed to summarize history: ${e.message || e}`);
        } catch {}
    }
  }

  async _summarizeHistory() {
    const systemMessages = this.memory.filter(m => m.role === 'system');
    const nonSystem = this.memory.filter(m => m.role !== 'system');
    const keepRecentCount = 30;
    const oldPart = nonSystem.slice(0, Math.max(0, nonSystem.length - keepRecentCount));
    if (oldPart.length === 0) return;

    let serialized = JSON.stringify(oldPart);
    const maxSummaryChars = 20000;
    if (serialized.length > maxSummaryChars) {
        serialized = serialized.slice(0, maxSummaryChars) + '... [truncated]';
    }

    const summaryMessages = [];
    if (systemMessages.length > 0) {
        summaryMessages.push(systemMessages[0]);
    }
    summaryMessages.push({
        role: 'user',
        content: 'Summarize the following conversation so far in 1-2 paragraphs focusing on the main tasks, decisions, and important files. Do not include any tool call JSON or code blocks. Conversation:\n' + serialized
    });

    const summaryResponse = await this.provider.chat(summaryMessages, []);
    const summaryText = summaryResponse && summaryResponse.content ? summaryResponse.content : '';

    const recentPart = nonSystem.slice(-keepRecentCount);
    const newMemory = [];
    if (systemMessages.length > 0) {
        newMemory.push(systemMessages[0]);
    }
    newMemory.push({
        role: 'assistant',
        content: 'Summary of previous conversation:\n' + summaryText
    });
    newMemory.push(...recentPart);
    this.memory = newMemory;
    this._hasSummary = true;
  }

  async researchDirectory(dirPath) {
    const files = await listFiles(`${dirPath}/**/*`);
    let summary = `Directory listing for ${dirPath}:\n`;
    
    // Limit to prevent token overflow. 
    // Strategy: List all files, but only read content of first 10 text files or specific types.
    // For now, let's just list them and read the first few relevant files.
    
    summary += files.join('\n');
    summary += '\n\nSelected File Contents:\n';

    let fileCount = 0;
    for (const file of files) {
        if (fileCount >= 5) break; // Limit to 5 files for now
        // Skip lock files, images, etc.
        if (file.endsWith('.json') || file.endsWith('.js') || file.endsWith('.md') || file.endsWith('.html') || file.endsWith('.css')) {
             try {
                 const content = await readFile(file);
                 summary += `\n--- File: ${file} ---\n${content}\n`;
                 fileCount++;
             } catch (e) {
                 // ignore read errors
             }
        }
    }

    const prompt = `
I have investigated the directory "${dirPath}".
Here is the summary of the files and contents:
\`\`\`
${summary}
\`\`\`

Please analyze this project structure and content. Explain what it is and remember this context for future questions.
`;
    
    // We treat this as a user message (or system observation)
    return await this.chat(prompt);
  }

  async analyzeFile(filePath, question) {
    const content = await readFile(filePath);
    const prompt = `
File: ${filePath}
Content:
\`\`\`
${content}
\`\`\`

User Question: ${question || 'Summarize this file and explain what it does.'}
`;
    return await this.provider.generate(prompt);
  }

  async updateModel(modelId) {
      const config = await loadConfig();
      const resolved = modelId;

      if (!resolved) return;

      // Never switch to placeholder provider names or legacy web aliases
      if (['openai', 'gemini', 'compatible', 'grok-cli'].includes(resolved)) {
          console.log(chalk.yellow(`Ignoring invalid model alias "${resolved}", keeping ${this.provider?.model}`));
          return;
      }

      if (config.provider === 'compatible' && !resolved.includes('/')) {
          console.log(chalk.yellow(`Ignoring invalid compatible model "${resolved}", using ${config.model}`));
          if (config.model && this.provider) {
              this.provider.model = config.model;
          }
          return;
      }

      if (this.provider && this.provider.model !== resolved) {
          console.log(chalk.blue(`Switching agent ${this.id} model to ${resolved}`));
          this.provider.model = resolved;
      }
  }

  async updateFile(filePath, instruction) {
    const content = await readFile(filePath);
    const prompt = `
You are an expert software engineer.
File: ${filePath}
Content:
\`\`\`
${content}
\`\`\`

Instruction: ${instruction}

Output ONLY the updated file content. Do not include markdown code blocks (like \`\`\`javascript) or explanations. Just the raw code.
`;
    const newContent = await this.provider.generate(prompt);
    const cleanedContent = newContent.replace(/^```[a-z]*\n/i, '').replace(/\n```$/, '');
    
    return cleanedContent;
  }

  async fixFile(filePath, errorContext = '') {
    const content = await readFile(filePath);
    const prompt = `
You are an expert software engineer.
File: ${filePath}
Content:
\`\`\`
${content}
\`\`\`

${errorContext ? `Error Context:\n${errorContext}` : 'Identify potential bugs or issues in this code and fix them.'}

Output ONLY the fixed file content. Do not include markdown code blocks or explanations.
`;
    const newContent = await this.provider.generate(prompt);
    const cleanedContent = newContent.replace(/^```[a-z]*\n/i, '').replace(/\n```$/, '');
    return cleanedContent;
  }

  async generateCommand(instruction) {
    const prompt = `
You are a CLI expert.
User Instruction: ${instruction}

Return a single line shell command (or a chain of commands with &&) to accomplish this task on Windows.
Do NOT output markdown blocks. Output ONLY the command.
`;
    const command = await this.provider.generate(prompt);
    return command.trim();
  }
}
