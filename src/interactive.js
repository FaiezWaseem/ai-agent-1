import inquirer from 'inquirer';
import chalk from 'chalk';
import { setup, read, update, fix, run } from './commands.js';
import { clearChatHistory } from './chatStorage.js';
import { AgentManager } from './agentManager.js';
import { loadConfig } from './config.js';
import { generateAudio } from './tools/audio.js';
import { registerAgentManagerGetter } from './tools/scheduler.js';
import ora from 'ora';

export async function startInteractiveMode() {
  console.clear();
  console.log(chalk.bold.blue('🤖 AI Agent Interactive Mode (Multi-Agent)'));
  console.log(chalk.gray('Type /help to see available commands.'));
  console.log(chalk.gray('Type /exit to quit.'));
  console.log('');

  const manager = new AgentManager();
  await manager.init();
  registerAgentManagerGetter(() => manager);
  
  // Initialize default agents only if no agents loaded
  if (manager.agents.size === 0) {
      console.log(chalk.gray('Initializing default agents...'));
      await manager.createAgent('default', 'primary');
      
      const defaultRoles = [
          { id: 'project_manager', name: 'pm' },
          { id: 'team_lead', name: 'lead' },
          { id: 'senior_engineer', name: 'senior' },
          { id: 'junior_engineer', name: 'junior' },
          { id: 'testing_engineer', name: 'qa' },
          { id: 'database_manager', name: 'db' },
          { id: 'document_maker', name: 'docs' }
      ];
      
      for (const role of defaultRoles) {
          try {
              await manager.createAgent(role.id, role.name);
          } catch (e) {
              // Ignore if persona file missing
          }
      }
  }

  while (true) {
    const activeAgent = manager.getActiveAgent();
    const promptPrefix = chalk.cyan(`[${activeAgent.name}] >`);

    const { input } = await inquirer.prompt([
      {
        type: 'input',
        name: 'input',
        message: promptPrefix,
        prefix: '',
      },
    ]);

    const trimmedInput = input.trim();
    if (!trimmedInput) continue;

    if (trimmedInput.startsWith('/')) {
      await handleCommand(trimmedInput, manager);
    } else {
      // Chat mode
      const spinner = ora('Thinking...').start();
      try {
        const response = await activeAgent.chat(trimmedInput, async (message) => {
             // Pause spinner to ask for confirmation
             spinner.stop();
             const { confirm } = await inquirer.prompt([{
                 type: 'confirm',
                 name: 'confirm',
                 message: chalk.yellow(message),
                 default: false
             }]);
             spinner.start();
             return confirm;
        });
        spinner.stop();
        console.log(chalk.green('AI: ') + response);

        // Audio Generation
        try {
            const config = await loadConfig();
            if (config.audio_enabled) {
                const audioPath = await generateAudio(response, config.audio_voice);
                if (audioPath) {
                    console.log(chalk.gray(`Audio response generated: ${audioPath}`));
                }
            }
        } catch (err) {
            console.error(chalk.yellow('Failed to generate audio response.'));
        }

        console.log('');
      } catch (error) {
        spinner.fail('Chat failed');
        console.error(chalk.red(error.message));
      }
    }
  }
}

async function handleCommand(inputLine, manager) {
  // Simple argument parser that respects quotes
  const args = inputLine.match(/(?:[^\s"]+|"[^"]*")+/g).map(arg => arg.replace(/^"|"$/g, ''));
  const command = args[0].toLowerCase();
  const agent = manager.getActiveAgent();

  try {
    switch (command) {
      case '/help':
        showHelp();
        break;
      case '/bye':
      case '/exit':
      case '/quit':
        console.log(chalk.green('Goodbye!'));
        process.exit(0);
        break;
      case '/setup':
        await setup();
        // Re-init current agent to pick up new config
        await agent.init();
        break;
      case '/agents':
        const agents = manager.listAgents();
        console.log(chalk.bold('\nActive Agents:'));
        agents.forEach((a, index) => {
            const active = a.id === manager.activeAgentId ? '*' : ' ';
            const activeLabel = active === '*' ? chalk.green('(Active)') : '';
            console.log(` ${index + 1}. ${a.name} ( ${chalk.cyan(a.id)} ) : ${chalk.gray(a.description)} ${activeLabel}`);
        });
        console.log('');
        break;
      case '/create':
          if (args.length < 2) {
              const personas = await manager.listAvailablePersonas();
              console.log(chalk.yellow(`Usage: /create <persona> [name]`));
              console.log(`Available personas: ${personas.join(', ')}`);
          } else {
              const persona = args[1];
              const name = args[2] || null;
              try {
                  const newAgent = await manager.createAgent(persona, name);
                  console.log(chalk.green(`Created agent ${newAgent.name}`));
                  manager.setActiveAgent(newAgent.name);
              } catch (e) {
                  console.error(chalk.red(e.message));
              }
          }
          break;
      case '/switch':
          if (args.length < 2) {
              console.log(chalk.yellow('Usage: /switch <agent_name>'));
          } else {
              if (manager.setActiveAgent(args[1])) {
                  console.log(chalk.green(`Switched to ${args[1]}`));
              } else {
                  console.error(chalk.red(`Agent ${args[1]} not found.`));
              }
          }
          break;
      case '/read':
        if (args.length < 2) {
          console.log(chalk.red('Usage: /read <file> [query]'));
        } else {
          const file = args[1];
          const query = args.slice(2).join(' ');
          await read(file, query, agent);
        }
        break;
      case '/research':
          if (args.length < 2) {
            console.log(chalk.red('Usage: /research <directory>'));
          } else {
            const dir = args[1];
            const spinner = ora(`Researching directory ${dir}...`).start();
            const result = await agent.researchDirectory(dir);
            spinner.stop();
            console.log(chalk.blue.bold(`\nResearch Result for ${dir}:\n`));
            console.log(result);
            console.log('');
          }
          break;
      case '/clear':
        await clearChatHistory(agent.id);
        agent.memory = [];
        await agent.init();
        console.log(chalk.yellow('Memory cleared.'));
        break;
      case '/update':
          if (args.length < 2) {
             console.log(chalk.red('Usage: /update <file> [instruction...]'));
          } else {
             const file = args[1];
             const instruction = args.slice(2).join(' ');
             await update(file, instruction, agent);
          }
          break;
      case '/fix':
          if (args.length < 2) {
             console.log(chalk.red('Usage: /fix <file>'));
          } else {
             await fix(args[1], agent);
          }
          break;
      case '/run':
           if (args.length < 2) {
              console.log(chalk.red('Usage: /run <instruction>'));
           } else {
              const instruction = args.slice(1).join(' ');
              await run(instruction, agent);
           }
           break;
      case '/history':
        console.log(chalk.bold('\n--- Agent Memory Dump ---'));
        console.log(JSON.stringify(agent.memory, null, 2));
        console.log(chalk.bold('-------------------------\n'));
        break;
      case '/safe-mode':
        agent.safeMode = !agent.safeMode;
        await manager.saveState();
        console.log(chalk.yellow(`\nSafe Mode is now ${agent.safeMode ? 'ENABLED' : 'DISABLED'}\n`));
        break;
      default:
        console.log(chalk.red('Unknown command: ' + command));
        console.log('Type /help for list of commands.');
    }
  } catch (error) {
    console.error(chalk.red('Error executing command:'), error);
  }
}

function showHelp() {
  console.log(chalk.bold('\nAvailable Commands:'));
  console.log('  /help                      Show this help message');
  console.log('  /exit                      Exit the application');
  console.log('  /bye                      Exit the application');
  console.log('  /setup                     Configure AI provider');
  console.log('  /agents                    List active agents');
  console.log('  /create <persona> [name]   Create a new agent');
  console.log('  /switch <name>             Switch active agent');
  console.log('  /read <file> [query]       Read and analyze a file');
  console.log('  /update <file> [prompt]    Update a file based on instructions');
  console.log('  /fix <file>                Attempt to fix errors in a file');
  console.log('  /run <instruction>         Generate and run a shell command');
  console.log('  /research <directory>      Analyze a directory structure');
  console.log('  /clear                     Clear chat memory');
  console.log('  /history                   Show agent memory dump');
  console.log('  /safe-mode                 Toggle Safe Mode (ask before dangerous actions)');
  console.log('');
}
