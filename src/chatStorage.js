
import fs from 'fs/promises';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DB_FILE = path.join(process.cwd(), '.agent', '.ai-agent-chat.sqlite');
const MAX_SIZE_BYTES = 100 * 1024 * 1024; // Keep this for file size check if needed, but per-agent limits are handled differently now

let dbPromise = null;

async function initDb() {
    await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
    const db = await open({
        filename: DB_FILE,
        driver: sqlite3.Database
    });

    await db.exec('PRAGMA foreign_keys = ON;');

    // 1. Agents Table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS agents (
            agent_id TEXT PRIMARY KEY,
            agent_name TEXT,
            about_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 2. Chat Sessions Table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
        );
    `);

    // 3. Chat Messages Table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS chat (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT,
            tool_calls TEXT,
            tool_call_id TEXT,
            name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
        );
    `);

    // Migration: metadata column for reply info etc.
    try {
        await db.exec('ALTER TABLE chat ADD COLUMN metadata TEXT');
    } catch {
        // Column already exists
    }

    // Migration Check
    try {
        const legacyTable = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_history'");
        if (legacyTable) {
            console.log("Migrating legacy chat history...");
            const rows = await db.all("SELECT * FROM chat_history");
            for (const row of rows) {
                const agentId = row.agent_id;
                let messages = [];
                try { messages = JSON.parse(row.messages); } catch (e) {}

                if (messages.length > 0) {
                    // Create agent placeholder
                    await db.run("INSERT OR IGNORE INTO agents (agent_id, agent_name) VALUES (?, ?)", agentId, agentId);
                    
                    // Create session
                    const result = await db.run("INSERT INTO chat_sessions (agent_id) VALUES (?)", agentId);
                    const sessionId = result.lastID;

                    // Insert messages
                    for (const msg of messages) {
                         await db.run(
                            "INSERT INTO chat (session_id, role, content, tool_calls, tool_call_id, name) VALUES (?, ?, ?, ?, ?, ?)",
                            sessionId, 
                            msg.role, 
                            msg.content || '', 
                            msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
                            msg.tool_call_id || null,
                            msg.name || null
                        );
                    }
                }
            }
            await db.exec("DROP TABLE chat_history");
        }
    } catch (e) {
        console.error("Migration warning:", e);
    }

    return db;
}

function getDb() {
    if (!dbPromise) {
        dbPromise = initDb();
    }
    return dbPromise;
}

export async function loadChatHistory(agentId) {
    try {
        const db = await getDb();
        
        // Get the latest session for this agent
        const session = await db.get(
            "SELECT id FROM chat_sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1",
            agentId
        );

        if (!session) {
            return [];
        }

        const rows = await db.all(
            "SELECT role, content, tool_calls, tool_call_id, name, metadata FROM chat WHERE session_id = ? ORDER BY id ASC",
            session.id
        );

        return rows.map(row => {
            const msg = {
                role: row.role,
                content: row.content
            };
            if (row.tool_calls) {
                try { msg.tool_calls = JSON.parse(row.tool_calls); } catch (e) {}
            }
            if (row.tool_call_id) msg.tool_call_id = row.tool_call_id;
            if (row.name) msg.name = row.name;
            if (row.metadata) {
                try {
                    const meta = JSON.parse(row.metadata);
                    if (meta.replyTo) msg.replyTo = meta.replyTo;
                    if (meta.id) msg.id = meta.id;
                } catch (e) {}
            }
            return msg;
        });

    } catch (error) {
        console.error("Error loading chat history:", error);
        return [];
    }
}

export async function saveChatHistory(agentId, messages, agentInstance = null) {
    const db = await getDb();

    // 1. Ensure Agent Exists
    if (agentInstance) {
        await db.run(
            `INSERT INTO agents (agent_id, agent_name, about_agent) 
             VALUES (?, ?, ?) 
             ON CONFLICT(agent_id) DO UPDATE SET 
                agent_name = excluded.agent_name,
                about_agent = excluded.about_agent`,
            agentId,
            agentInstance.name || agentId,
            agentInstance.persona ? agentInstance.persona.description : null
        );
    } else {
        // Fallback if no instance provided
        await db.run("INSERT OR IGNORE INTO agents (agent_id, agent_name) VALUES (?, ?)", agentId, agentId);
    }

    // 2. Get or Create Session
    // For now, we reuse the latest session or create one if none.
    // Since we overwrite history in the current logic, let's keep it simple:
    // If we are saving, we are appending to the current "active" session.
    let session = await db.get(
        "SELECT id FROM chat_sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1",
        agentId
    );

    if (!session) {
        const result = await db.run("INSERT INTO chat_sessions (agent_id) VALUES (?)", agentId);
        session = { id: result.lastID };
    }

    // 3. Sync Messages
    // Strategy: Delete all for this session and re-insert. 
    // This handles pruning/summarization correctly (where old messages are removed from memory).
    await db.run("DELETE FROM chat WHERE session_id = ?", session.id);

    const stmt = await db.prepare(
        "INSERT INTO chat (session_id, role, content, tool_calls, tool_call_id, name, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    for (const msg of messages) {
        const metadata = (msg.replyTo || msg.id)
            ? JSON.stringify({ replyTo: msg.replyTo || null, id: msg.id || null })
            : null;
        await stmt.run(
            session.id,
            msg.role,
            msg.content || '',
            msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
            msg.tool_call_id || null,
            msg.name || null,
            metadata
        );
    }
    await stmt.finalize();
}

export async function clearChatHistory(agentId = null) {
    const db = await getDb();
    if (agentId) {
        await db.run("DELETE FROM agents WHERE agent_id = ?", agentId);
    } else {
        // Drop all data?
        await db.run("DELETE FROM chat");
        await db.run("DELETE FROM chat_sessions");
        await db.run("DELETE FROM agents");
    }
}
