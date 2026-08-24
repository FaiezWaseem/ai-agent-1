import { saveChatHistory } from '../chatStorage.js';
import chalk from 'chalk';

// Constants
const MAX_CONTEXT_TOKENS = 120000; // Safe limit for GPT-4o (128k context)
const SUMMARY_THRESHOLD = 80000; // Trigger summary when we hit this
const MESSAGES_TO_KEEP = 10; // Keep last N messages raw
const TOKEN_ESTIMATE_CHAR = 4; // 1 token ~= 4 chars

function estimateTokens(messages) {
    let text = '';
    for (const msg of messages) {
        if (msg.content) text += msg.content;
        if (msg.tool_calls) text += JSON.stringify(msg.tool_calls);
    }
    return Math.ceil(text.length / TOKEN_ESTIMATE_CHAR);
}

export async function summarizeMemory(agent) {
    const totalTokens = estimateTokens(agent.memory);
    
    if (totalTokens < SUMMARY_THRESHOLD) {
        return false;
    }

    console.log(chalk.yellow(`\n⚠️  Memory usage high (~${totalTokens} tokens). Summarizing...`));

    // 1. Identify split point
    // We keep:
    // - System prompt (index 0 usually)
    // - Last MESSAGES_TO_KEEP messages
    // We summarize:
    // - Everything in between
    
    // Find system prompt
    let systemPromptIdx = -1;
    if (agent.memory.length > 0 && agent.memory[0].role === 'system') {
        systemPromptIdx = 0;
    }

    const startIndex = systemPromptIdx + 1;
    const endIndex = Math.max(startIndex, agent.memory.length - MESSAGES_TO_KEEP);
    
    if (startIndex >= endIndex) {
        console.log(chalk.gray("Not enough messages to summarize yet."));
        return false;
    }

    const messagesToSummarize = agent.memory.slice(startIndex, endIndex);
    const messagesToKeep = agent.memory.slice(endIndex);

    // 2. Archive/Checkpoint (Save full history before modifying)
    // We use a separate 'archive' concept or just rely on the fact that we might have saved it before?
    // Current saveChatHistory overwrites. We need a way to append to an archive file.
    // For now, let's create a specialized archive file.
    await archiveMessages(agent.id, messagesToSummarize);

    // 3. Generate Summary
    // We use the agent's provider to generate a summary
    // We need a separate simple chat completion for this, not using the main agent loop to avoid recursion
    try {
        const summaryPrompt = `
        Summarize the following conversation history concisely. 
        Focus on:
        1. Key decisions made.
        2. Important facts learned (file paths, variable names, bugs found).
        3. Current goals and progress.
        4. User preferences.
        
        Do NOT lose critical technical details.
        
        History:
        ${messagesToSummarize.map(m => `${m.role}: ${JSON.stringify(m.content || m.tool_calls)}`).join('\n')}
        `;

        const summaryResponse = await agent.provider.generate(summaryPrompt, "You are a helpful assistant that summarizes technical conversations.");
        
        const summaryMessage = {
            role: 'system',
            content: `[PREVIOUS CONVERSATION SUMMARY]:\n${summaryResponse}\n[END SUMMARY]`
        };

        // 4. Update Memory
        const newMemory = [];
        if (systemPromptIdx !== -1) {
            newMemory.push(agent.memory[0]);
        }
        newMemory.push(summaryMessage);
        
        // If there was already a summary in the "to summarize" block, it gets rolled into the new summary.
        // If there were other system messages (like persona updates), we might lose them if we aren't careful.
        // For simplicity, we assume one main system prompt at top.

        newMemory.push(...messagesToKeep);
        
        agent.memory = newMemory;
        
        // Save the compacted memory
        await saveChatHistory(agent.id, agent.memory, agent, agent._activeScopeKey || 'dm');
        
        console.log(chalk.green(`✅ Memory summarized. Reduced from ${messagesToSummarize.length + messagesToKeep.length} to ${newMemory.length} messages.`));
        return true;

    } catch (e) {
        console.error("Failed to summarize memory:", e);
        return false;
    }
}

async function archiveMessages(agentId, messages) {
    const fs = (await import('fs/promises')).default;
    const path = (await import('path')).default;
    
    const archiveDir = path.join(process.cwd(), '.agent', 'archive');
    await fs.mkdir(archiveDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(archiveDir, `${agentId}_${timestamp}.json`);
    
    await fs.writeFile(filename, JSON.stringify(messages, null, 2));
    console.log(chalk.gray(`Archived ${messages.length} messages to ${filename}`));
}
