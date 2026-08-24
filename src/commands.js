import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { saveConfig, loadConfig } from './config.js';
import { normalizeCompatibleBaseUrl } from './ai/index.js';
import { getGrokCliProviderStatus, DEFAULT_GROK_CLI_MODEL } from './ai/grok-cli.js';
import { syncSessionModels } from './agentManager.js';
import { Agent } from './agent.js';
import { writeFile, readFile } from './tools/fs.js';
import { runCommand } from './tools/shell.js';
import * as Diff from 'diff';
import { webUiTools } from './tools/web_ui.js';
import { listIntegrations as listInt, setupIntegration as setupInt } from './integrations/index.js';

export async function web() {
  const spinner = ora('Starting web interface...').start();
  try {
    const message = await webUiTools.start_chat_ui();
    spinner.succeed(message);
    console.log(chalk.cyan('Press Ctrl+C to stop the server.'));
  } catch (error) {
    spinner.fail('Failed to start web interface');
    console.error(chalk.red(error));
    process.exit(1);
  }
}

export async function setup() {
  let config = await loadConfig();
  
  console.log(chalk.blue.bold('\n--- AI Agent Setup ---\n'));

  while (true) {
    console.log(chalk.grey.bold('1. AI Provider'));
    console.log(chalk.grey.bold('2. SMS Gateway (sms-gate.app)'));
    console.log(chalk.grey.bold('3. Telegram Integration'));
    console.log(chalk.grey.bold('4. GitHub Integration'));
    console.log(chalk.grey.bold('5. Email Integration (Gmail/SMTP)'));
    console.log(chalk.grey.bold('6. Audio Configuration'));
    console.log(chalk.grey.bold('7. WhatsApp Configuration'));
    console.log(chalk.grey.bold('8. Exit'));
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to configure?',
        choices: [
          { name: '1. AI Provider', value: '1' },
          { name: '2. SMS Gateway (sms-gate.app)', value: '2' },
          { name: '3. Telegram Integration', value: '3' },
          { name: '4. GitHub Integration', value: '4' },
          { name: '5. Email Integration (Gmail/SMTP)', value: '5' },
          { name: '6. Audio Configuration', value: '6' },
          { name: '7. WhatsApp Configuration', value: '7' },
          { name: 'Exit', value: '8' }
        ]
      }
    ]);

    if (action === '8') {
      console.log(chalk.green('Setup completed.'));
      break;
    }

    if (action === '1') {
      const providerAnswers = await inquirer.prompt([
        {
          type: 'list',
          name: 'provider',
          message: 'Select AI Provider:',
          choices: ['openai', 'gemini', 'compatible', 'grok-cli'],
          default: config.provider,
        },
        {
          type: 'input',
          name: 'model',
          message: 'Enter Model Name (optional):',
          default: (answers) => {
            if (answers.provider === 'openai') return 'gpt-4o';
            if (answers.provider === 'gemini') return 'gemini-1.5-flash';
            if (answers.provider === 'grok-cli') return DEFAULT_GROK_CLI_MODEL;
            return 'gpt-3.5-turbo';
          },
        },
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter API Key:',
          mask: '*',
          when: (answers) => answers.provider !== 'grok-cli',
        },
        {
          type: 'input',
          name: 'baseUrl',
          message: 'Enter Base URL (must end with /v1):',
          default: 'http://localhost:8080/v1',
          when: (answers) => answers.provider === 'compatible',
        },
      ]);

      if (providerAnswers.provider === 'grok-cli') {
          const statusSpinner = ora('Checking Grok CLI session (~/.grok/auth.json)...').start();
          const draftConfig = {
              ...config,
              provider: 'grok-cli',
              model: providerAnswers.model,
          };
          const status = await getGrokCliProviderStatus(draftConfig);
          if (status.available) {
              statusSpinner.succeed(
                  `Grok CLI ready${status.cliAuth.email ? ` (${status.cliAuth.email})` : ''}`
              );
          } else if (status.cliAuth.connected) {
              statusSpinner.warn(status.reason || 'Grok CLI session found but not usable');
          } else {
              statusSpinner.warn('No Grok CLI session — run `grok login` first');
          }
      }

      config.provider = providerAnswers.provider;
      config.model = providerAnswers.model;
      
      if (providerAnswers.provider === 'openai') {
          config.openai_api_key = providerAnswers.apiKey;
      } else if (providerAnswers.provider === 'gemini') {
          config.gemini_api_key = providerAnswers.apiKey;
      } else if (providerAnswers.provider === 'compatible') {
          config.compatible_api_key = providerAnswers.apiKey;
          config.compatible_base_url = normalizeCompatibleBaseUrl(providerAnswers.baseUrl);
      }
      
      await saveConfig(config);
      if (config.model) {
          await syncSessionModels(config.model);
      }
      console.log(chalk.green('AI Provider configuration saved!\n'));

    } else if (action === '2') {
      const smsAnswers = await inquirer.prompt([
        {
            type: 'input',
            name: 'sms_username',
            message: 'Enter SMS Gateway Username (leave empty to skip):',
            default: config.sms_username || '',
        },
        {
            type: 'password',
            name: 'sms_password',
            message: 'Enter SMS Gateway Password (leave empty to skip):',
            mask: '*',
            default: config.sms_password || '',
            when: (answers) => answers.sms_username
        },
        {
            type: 'input',
            name: 'sms_device_id',
            message: 'Enter Default Device ID (optional):',
            default: config.sms_device_id || '',
            when: (answers) => answers.sms_username
        }
      ]);

      if (smsAnswers.sms_username !== undefined) config.sms_username = smsAnswers.sms_username;
      if (smsAnswers.sms_password !== undefined) config.sms_password = smsAnswers.sms_password;
      if (smsAnswers.sms_device_id !== undefined) config.sms_device_id = smsAnswers.sms_device_id;
      
      await saveConfig(config);
      console.log(chalk.green('SMS Gateway configuration saved!\n'));

    } else if (action === '3') {
      const telegramAnswers = await inquirer.prompt([
        {
            type: 'password',
            name: 'telegram_bot_token',
            message: 'Enter Telegram Bot Token (leave empty to skip):',
            mask: '*',
            default: config.telegram_bot_token || '',
        }
      ]);

      if (telegramAnswers.telegram_bot_token !== undefined) config.telegram_bot_token = telegramAnswers.telegram_bot_token;
      
      await saveConfig(config);
      console.log(chalk.green('Telegram configuration saved!\n'));

    } else if (action === '4') {
      const githubAnswers = await inquirer.prompt([
        {
            type: 'password',
            name: 'github_token',
            message: 'Enter GitHub Token (leave empty to skip):',
            mask: '*',
            default: config.github_token || '',
        }
      ]);

      if (githubAnswers.github_token !== undefined) config.github_token = githubAnswers.github_token;
      
      await saveConfig(config);
      console.log(chalk.green('GitHub configuration saved!\n'));

    } else if (action === '5') {
        const emailAnswers = await inquirer.prompt([
            {
                type: 'list',
                name: 'provider',
                message: 'Select Email Provider:',
                choices: ['Gmail', 'Custom SMTP/IMAP'],
                default: config.email?.provider || 'Gmail'
            },
            {
                type: 'input',
                name: 'user',
                message: 'Email Address:',
                default: config.email?.user || '',
                validate: input => input.includes('@') ? true : 'Invalid email'
            },
            {
                type: 'password',
                name: 'password',
                message: 'Password (or App Password):',
                mask: '*',
                default: config.email?.password || '',
                validate: input => input.length > 0 ? true : 'Password is required'
            }
        ]);

        let emailConfig = {
            user: emailAnswers.user,
            password: emailAnswers.password,
            provider: emailAnswers.provider
        };

        if (emailAnswers.provider === 'Custom SMTP/IMAP') {
            const customAnswers = await inquirer.prompt([
                { type: 'input', name: 'host', message: 'IMAP Host:', default: config.email?.host || '' },
                { type: 'number', name: 'port', message: 'IMAP Port:', default: config.email?.port || 993 },
                { type: 'confirm', name: 'tls', message: 'Use TLS?', default: config.email?.tls !== false },
                { type: 'input', name: 'smtpHost', message: 'SMTP Host:', default: config.email?.smtpHost || '' },
                { type: 'number', name: 'smtpPort', message: 'SMTP Port:', default: config.email?.smtpPort || 587 }
            ]);
            Object.assign(emailConfig, customAnswers);
        } else {
            // Gmail Defaults
            emailConfig.host = 'imap.gmail.com';
            emailConfig.port = 993;
            emailConfig.tls = true;
            emailConfig.smtpHost = 'smtp.gmail.com';
            emailConfig.smtpPort = 587;
        }

        config.email = emailConfig;
        await saveConfig(config);
        console.log(chalk.green('Email configuration saved!\n'));
    }

    if (action === '6') {
      const audioAnswers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'audio_enabled',
          message: 'Enable Audio Responses (TTS)?',
          default: config.audio_enabled || false,
        },
        {
          type: 'list',
          name: 'audio_voice',
          message: 'Select Voice:',
          choices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
          default: config.audio_voice || 'alloy',
          when: (answers) => answers.audio_enabled,
        }
      ]);

      config.audio_enabled = audioAnswers.audio_enabled;
      if (audioAnswers.audio_enabled) {
          config.audio_voice = audioAnswers.audio_voice;
      }
      await saveConfig(config);
      console.log(chalk.green('Audio configuration saved!'));
    }

    if (action === '7') {
        const waAnswers = await inquirer.prompt([
            {
                type: 'input',
                name: 'trigger',
                message: 'Enter custom trigger (leave empty for "@ai", type "none" for all messages):',
                default: config.whatsapp_trigger || '@ai'
            },
            {
                type: 'input',
                name: 'excluded',
                message: 'Enter numbers (e.g. 1234567890) or exact Group Names to exclude (comma separated):',
                default: config.whatsapp_excluded || ''
            },
            {
                type: 'confirm',
                name: 'groupsEnabled',
                message: 'Enable AI in WhatsApp Groups?',
                default: config.whatsapp_groups_enabled !== false // Default to true
            },
            {
                type: 'confirm',
                name: 'updatePrompt',
                message: 'Do you want to update the custom System Prompt?',
                default: false
            },
            {
                type: 'editor',
                name: 'systemPrompt',
                message: 'Enter custom System Prompt for WhatsApp Agent:',
                default: config.whatsapp_system_prompt || '',
                when: (answers) => answers.updatePrompt
            }
        ]);

        config.whatsapp_trigger = waAnswers.trigger;
        config.whatsapp_excluded = waAnswers.excluded;
        config.whatsapp_groups_enabled = waAnswers.groupsEnabled;
        if (waAnswers.updatePrompt) {
            config.whatsapp_system_prompt = waAnswers.systemPrompt;
        }
        
        await saveConfig(config);
        console.log(chalk.green('WhatsApp configuration saved!'));
    }
  }
}

export async function read(filePath, query, agentInstance = null) {
  const spinner = ora('Analyzing file...').start();
  try {
    const agent = agentInstance || new Agent();
    if (!agentInstance) await agent.init();
    
    const result = await agent.analyzeFile(filePath, query);
    spinner.stop();
    console.log(chalk.blue.bold(`\nAnalysis of ${filePath}:\n`));
    console.log(result);
  } catch (error) {
    spinner.fail('Analysis failed');
    console.error(chalk.red(error.message));
  }
}

export async function update(filePath, instruction, agentInstance = null) {
  if (!instruction) {
      const answer = await inquirer.prompt([{
          type: 'input',
          name: 'instruction',
          message: 'What changes do you want to make?',
      }]);
      instruction = answer.instruction;
  }

  const spinner = ora('Updating file...').start();
  try {
    const agent = agentInstance || new Agent();
    if (!agentInstance) await agent.init();
    
    // Read original content for simple diff or backup
    const originalContent = await readFile(filePath);
    
    const newContent = await agent.updateFile(filePath, instruction);
    
    // Show Diff
    const diff = Diff.diffLines(originalContent, newContent);
    console.log(chalk.bold('\nProposed Changes:\n'));
    diff.forEach((part) => {
      // green for additions, red for deletions
      // grey for common parts
      const color = part.added ? chalk.green :
        part.removed ? chalk.red : chalk.grey;
      process.stdout.write(color(part.value));
    });
    console.log('\n');

    // Confirm changes
    const confirm = await inquirer.prompt([{
        type: 'confirm',
        name: 'apply',
        message: 'Do you want to apply these changes?',
        default: true
    }]);

    if (confirm.apply) {
        await writeFile(filePath, newContent);
        spinner.succeed(chalk.green(`Successfully updated ${filePath}`));
    } else {
        spinner.info(chalk.yellow('Changes discarded.'));
    }
  } catch (error) {
    spinner.fail('Update failed');
    console.error(chalk.red(error.message));
  }
}

export async function fix(filePath, agentInstance = null) {
  const spinner = ora('Fixing file...').start();
  try {
    const agent = agentInstance || new Agent();
    if (!agentInstance) await agent.init();
    
    // Read file
    const content = await readFile(filePath);
    
    // Ask AI to fix
    // We can reuse updateFile logic or create a specialized fix method
    // For now, let's use updateFile with a "fix" instruction
    const newContent = await agent.updateFile(filePath, "Fix any bugs, syntax errors, or logical issues in this code. Return the full fixed code.");
    
    // Show Diff (reusing update logic would be better but for now inline)
    const diff = Diff.diffLines(content, newContent);
    console.log(chalk.bold('\nProposed Fixes:\n'));
    diff.forEach((part) => {
      const color = part.added ? chalk.green :
        part.removed ? chalk.red : chalk.grey;
      process.stdout.write(color(part.value));
    });
    console.log('\n');

    const confirm = await inquirer.prompt([{
        type: 'confirm',
        name: 'apply',
        message: 'Do you want to apply these fixes?',
        default: true
    }]);

    if (confirm.apply) {
        await writeFile(filePath, newContent);
        spinner.succeed(chalk.green(`Successfully fixed ${filePath}`));
    } else {
        spinner.info(chalk.yellow('Fixes discarded.'));
    }

  } catch (error) {
    spinner.fail('Fix failed');
    console.error(chalk.red(error.message));
  }
}

export async function run(instruction, agentInstance = null) {
  const spinner = ora('Generating command...').start();
  try {
    const agent = agentInstance || new Agent();
    if (!agentInstance) await agent.init();

    const command = await agent.generateCommand(instruction);
    spinner.stop();
    
    console.log(chalk.bold('Generated Command:'), chalk.cyan(command));
    
    const confirm = await inquirer.prompt([{
        type: 'confirm',
        name: 'run',
        message: 'Do you want to run this command?',
        default: false
    }]);

    if (confirm.run) {
        const { stdout, stderr } = await runCommand(command);
        if (stdout) console.log(stdout);
        if (stderr) console.error(chalk.red(stderr));
    } else {
        console.log(chalk.yellow('Command skipped.'));
    }

  } catch (error) {
    spinner.fail('Command generation failed');
    console.error(chalk.red(error.message));
  }
}

export function integrationList() {
    listInt();
}

export async function integrationSetup(name) {
    await setupInt(name);
}
