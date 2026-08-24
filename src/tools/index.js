import { readFile, writeFile, listFiles } from './fs.js';
import { runCommand } from './shell.js';
import { delegate_task } from './inter_agent.js';
import { browser_tools } from './browser.js';
import { db_tools } from './db.js';
import { schedulerToolDefinitions, schedulerTools } from './scheduler.js';
import { webUiToolDefinitions, webUiTools } from './web_ui.js';
import { smsToolDefinitions, smsTools } from './sms.js';
import { visionToolDefinitions, visionTools } from './vision.js';
import { desktopToolDefinitions, desktopTools } from './desktop.js';
import { githubToolDefinitions, githubTools } from './github.js';
import { ghToolDefinitions, ghTools } from './gh.js';
import { emailToolDefinitions, emailTools } from './email.js';
import { whatsappToolDefinitions, whatsappTools } from './whatsapp.js';
import memoryTools from './memory.js';
import fs from 'fs/promises';
import path from 'path';

const resolvePath = (filePath, cwd) => {
    if (path.isAbsolute(filePath)) return filePath;
    return path.resolve(cwd || process.cwd(), filePath);
};
export const toolDefinitions = [
  {
    name: "read_file",
    description: "Read the content of a file. Use this to inspect code or text files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The relative or absolute path to the file." }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write content to a file. Overwrites existing files or creates new ones.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The path to the file." },
        content: { type: "string", description: "The content to write." }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "update_file",
    description: "Replace text in a file. Useful for editing large files without rewriting everything.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The path to the file." },
        search_text: { type: "string", description: "The exact text to search for." },
        replace_text: { type: "string", description: "The new text to replace with." }
      },
      required: ["path", "search_text", "replace_text"]
    }
  },
  {
    name: "delete_file",
    description: "Delete a file. CAUTION: This is destructive.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The path to the file to delete." }
      },
      required: ["path"]
    }
  },
  {
    name: "run_command",
    description: "Execute a shell command. Use this to list files, run tests, or manage git.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute." }
      },
      required: ["command"]
    }
  },
  {
    name: "list_files",
    description: "List all files in a directory recursively (search).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The directory path (default: current directory)." },
        ignore: { type: "array", items: { type: "string" }, description: "Glob patterns to ignore." }
      }
    }
  },
  {
    name: "read_dir",
    description: "List files and directories in a specific directory (non-recursive ls).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The directory path (default: current directory)." }
      }
    }
  },
  {
    name: "change_directory",
    description: "Change the current working directory (cd).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The target directory path." }
      },
      required: ["path"]
    }
  },
  {
    name: "delegate_task",
    description: "Delegate a task to another specialized agent. Use this to assign work to PM, Lead, QA, etc.",
    parameters: {
      type: "object",
      properties: {
        target_agent_id: { type: "string", description: "The ID or name of the agent (e.g., 'pm', 'lead', 'db')." },
        instruction: { type: "string", description: "The detailed instruction or task for the agent." }
      },
      required: ["target_agent_id", "instruction"]
    }
  },
  {
    name: "browser_visit",
    description: "Visit a URL and get its text content. Use this to read documentation or web pages.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to visit." }
      },
      required: ["url"]
    }
  },
  {
    name: "browser_search",
    description: "Search Google for a query and return top results with snippets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." }
      },
      required: ["query"]
    }
  },
  {
    name: "browser_eval",
    description: "Execute JavaScript code on the current web page. Use this after browser_visit to extract specific data or interact with the page.",
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "The JavaScript code to execute. The last expression is returned." }
      },
      required: ["script"]
    }
  },
  {
    name: "browser_fetch",
    description: "Perform an HTTP request (fetch) using Node.js fetch. Supports GET, POST, PUT, DELETE, etc.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch." },
        method: { type: "string", description: "HTTP Method (GET, POST, etc.). Default: GET" },
        headers: { type: "object", description: "HTTP Headers key-value pairs." },
        body: { type: "string", description: "Request body (string or JSON). For POST/PUT." }
      },
      required: ["url"]
    }
  },
  {
    name: "db_connect",
    description: "Connect to a database (sqlite, mysql, postgres).",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", description: "Database type: 'sqlite', 'mysql', 'postgres'" },
        host: { type: "string", description: "Host (for mysql/postgres)" },
        port: { type: "number", description: "Port (optional)" },
        user: { type: "string", description: "Username" },
        password: { type: "string", description: "Password" },
        database: { type: "string", description: "Database name" },
        filename: { type: "string", description: "Filename (for sqlite)" }
      },
      required: ["type"]
    }
  },
  {
    name: "db_query",
    description: "Execute a SQL query.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL query string" },
        params: { 
          type: "array", 
          description: "Parameters for the query (optional)",
          items: {
            type: ["string", "number", "boolean", "null"]
          }
        }
      },
      required: ["sql"]
    }
  },
  {
    name: "db_list_tables",
    description: "List all tables in the connected database.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "db_schema",
    description: "Get schema/structure of a specific table.",
    parameters: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" }
      },
      required: ["table"]
    }
  },
  {
    name: "memory_save",
    description: "Save information to long-term memory. Use this to remember important facts, rules, or project details.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Unique key/title for the memory (e.g., 'project_setup', 'user_preference_theme')." },
        content: { type: "string", description: "The content to remember." },
        category: { type: "string", description: "Category/folder (default: 'general')." }
      },
      required: ["key", "content"]
    }
  },
  {
    name: "memory_read",
    description: "Read a specific memory by key.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "The key of the memory to read." },
        category: { type: "string", description: "Category (default: 'general')." }
      },
      required: ["key"]
    }
  },
  {
    name: "memory_list",
    description: "List available memory keys.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category to list (optional)." }
      }
    }
  },
  {
    name: "memory_search",
    description: "Search all memories for keywords.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." }
      },
      required: ["query"]
    }
  },
  ...schedulerToolDefinitions,
  ...webUiToolDefinitions,
  ...smsToolDefinitions,
  ...visionToolDefinitions,
  ...desktopToolDefinitions,
  ...githubToolDefinitions,
  ...ghToolDefinitions,
  ...emailToolDefinitions,
  ...whatsappToolDefinitions
];

export const tools = {
  ...memoryTools,
  ...emailTools,
  ...whatsappTools,
  ...browser_tools,
  ...db_tools,
  ...schedulerTools,
  ...webUiTools,
  ...smsTools,
  ...visionTools,
  ...desktopTools,
  ...githubTools,
  ...ghTools,
  delegate_task,
  read_file: async ({ path: filePath }, { agent }) => {
    const fullPath = resolvePath(filePath, agent?.cwd);
    
    // Check file extension for images/binary
    const ext = path.extname(fullPath).toLowerCase();
    const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.pdf', '.zip', '.exe', '.bin'];
    if (binaryExts.includes(ext)) {
        return `Error: File ${path.basename(fullPath)} appears to be a binary or image file. Reading it as text will fail. Use 'analyze_image' for images or other specialized tools.`;
    }

    // Check file size (limit to 100KB for text to be safe, though context window is larger, we want to avoid massive logs)
    try {
        const stats = await fs.stat(fullPath);
        if (stats.size > 100 * 1024) {
             // Read only first 20KB
             const handle = await fs.open(fullPath, 'r');
             const buffer = Buffer.alloc(20000);
             const { bytesRead } = await handle.read(buffer, 0, 20000, 0);
             await handle.close();
             return `Warning: File is large (${(stats.size/1024).toFixed(2)}KB). Showing first 20KB:\n\n${buffer.toString('utf8', 0, bytesRead)}\n\n... (truncated)`;
        }
    } catch (e) {
        // Ignore stat errors, readFile will catch them
    }

    return await readFile(fullPath);
  },
  write_file: async ({ path: filePath, content }, { agent, confirmCallback }) => {
    const fullPath = resolvePath(filePath, agent?.cwd);
    
    if (agent?.safeMode) {
        if (!confirmCallback) return "Error: Safe Mode enabled but no confirmation callback provided.";
        const approved = await confirmCallback(`[SAFE MODE] Write to ${fullPath}?`);
        if (!approved) return "Write cancelled by user.";
    }

    await writeFile(fullPath, content);
    return `Successfully wrote to ${fullPath}`;
  },
  update_file: async ({ path: filePath, search_text, replace_text }, { agent, confirmCallback }) => {
    const fullPath = resolvePath(filePath, agent?.cwd);
    
    if (agent?.safeMode) {
        if (!confirmCallback) return "Error: Safe Mode enabled but no confirmation callback provided.";
        const approved = await confirmCallback(`[SAFE MODE] Update ${fullPath}?`);
        if (!approved) return "Update cancelled by user.";
    }

    try {
        const content = await readFile(fullPath);
        if (content.includes(search_text)) {
            const newContent = content.replace(search_text, replace_text);
            await writeFile(fullPath, newContent);
            return `Successfully updated ${fullPath}`;
        } else {
            return `Error: search_text not found in ${fullPath}`;
        }
    } catch (e) {
        return `Error updating file: ${e.message}`;
    }
  },
  delete_file: async ({ path: filePath }, { confirmCallback, agent }) => {
    const fullPath = resolvePath(filePath, agent?.cwd);
    // Check if file exists first
    try {
        await fs.access(fullPath);
    } catch {
        return `File ${fullPath} does not exist.`;
    }

    if (agent?.safeMode || confirmCallback) {
        if (!confirmCallback) return "Error: Safe Mode enabled but no confirmation callback provided.";
        const confirmed = await confirmCallback(`Are you sure you want to DELETE ${fullPath}?`);
        if (!confirmed) {
            return "Deletion cancelled by user.";
        }
    }
    
    await fs.unlink(fullPath);
    return `Successfully deleted ${fullPath}`;
  },
  run_command: async ({ command }, { agent, confirmCallback }) => {
    const cwd = agent?.cwd || process.cwd();
    
    if (agent?.safeMode) {
        if (!confirmCallback) return "Error: Safe Mode enabled but no confirmation callback provided.";
        const approved = await confirmCallback(`[SAFE MODE] Execute command?\n${command}`);
        if (!approved) return "Command execution cancelled by user.";
    }

    // We execute the command in the agent's cwd
    // Note: runCommand in shell.js currently uses execa(command, { shell: true })
    // We need to check if runCommand supports options. 
    // If not, we might need to modify shell.js or prepend `cd ${cwd} &&`.
    // Let's rely on prepend for now to avoid modifying shell.js deeply if it doesn't support options yet.
    // Better: update shell.js to accept options. But for now:
    const cmdWithCwd = `cd "${cwd}" && ${command}`;
    const { stdout, stderr, error } = await runCommand(cmdWithCwd);
    if (error) {
        return `Error: ${stderr || error.message}`;
    }
    return stdout || stderr || "Command executed with no output.";
  },
  list_files: async ({ path: dirPath = '.', ignore = ['node_modules/**', '.git/**'] }, { agent }) => {
    const fullPath = resolvePath(dirPath, agent?.cwd);
    const files = await listFiles(`${fullPath}/**/*`, ignore);
    return files.join('\n');
  },
  read_dir: async ({ path: dirPath = '.' }, { agent }) => {
      const fullPath = resolvePath(dirPath, agent?.cwd);
      try {
          const files = await fs.readdir(fullPath);
          return `Contents of ${fullPath}:\n${files.join('\n')}`;
      } catch (e) {
          return `Error reading directory: ${e.message}`;
      }
  },
  change_directory: async ({ path: dirPath }, { agent }) => {
      const fullPath = resolvePath(dirPath, agent?.cwd);
      try {
          const stats = await fs.stat(fullPath);
          if (!stats.isDirectory()) {
              return `Error: ${fullPath} is not a directory.`;
          }
          if (agent) {
              agent.cwd = fullPath;
          }
          return `Changed directory to ${fullPath}`;
      } catch (e) {
          return `Error changing directory: ${e.message}`;
      }
  }
};
