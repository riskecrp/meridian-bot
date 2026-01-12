// index.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { Client, Collection, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

// Setup Paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Client
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Collection to hold commands
client.commands = new Collection();

// 1. LOAD COMMANDS
const commandsPath = path.join(__dirname, 'commands');
// Ensure commands folder exists
if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath);
}

const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
const commandsToRegister = [];

console.log(`[SYSTEM] Loading ${commandFiles.length} commands...`);

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    // Dynamic import for ES Modules
    const command = await import(pathToFileURL(filePath).href);

    if ('data' in command.default && 'execute' in command.default) {
        client.commands.set(command.default.data.name, command.default);
        commandsToRegister.push(command.default.data.toJSON());
        console.log(`  -> Loaded: ${command.default.data.name}`);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

// Helper for Windows/Linux path compatibility in imports
function pathToFileURL(path) {
    return new URL('file://' + path);
}

// 2. DEPLOY COMMANDS (Register with Discord)
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`[SYSTEM] Refreshing ${commandsToRegister.length} application (/) commands.`);
        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commandsToRegister },
        );
        console.log(`[SYSTEM] Successfully registered ${data.length} commands.`);
    } catch (error) {
        console.error(error);
    }
})();

// 3. EVENT HANDLERS
client.once(Events.ClientReady, c => {
    console.log(`[SYSTEM] Ready! Logged in as ${c.user.tag}`);
    client.user.setPresence({
        activities: [{ name: "Waiting for associate request...", type: 3 }],
        status: "online"
    });
    
    // Start your Cron/Tick here if you have one
    setInterval(() => console.log('[CRON] Tick.'), 60000); 
});

client.on(Events.InteractionCreate, async interaction => {
    // Handle Chat Commands
    if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error executing this command!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true });
            }
        }
    } 
    // Handle Autocomplete
    else if (interaction.isAutocomplete()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            if (command.autocomplete) {
                await command.autocomplete(interaction);
            }
        } catch (error) {
            console.error(error);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
