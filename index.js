import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Client, Collection, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';

// --- UPDATED IMPORTS ---
import { startScheduler } from "./utils/scheduler.js"; // Use the new Scheduler file
import { sheets, GOOGLE_SHEET_ID } from "./utils/googleClient.js"; // Needed for Snooze logic

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
if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath);
}

const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
const commandsToRegister = [];

console.log(`[SYSTEM] Loading ${commandFiles.length} commands...`);

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = await import(pathToFileURL(filePath).href);

    if ('data' in command.default && 'execute' in command.default) {
        client.commands.set(command.default.data.name, command.default);
        commandsToRegister.push(command.default.data.toJSON());
        console.log(`  -> Loaded: ${command.default.data.name}`);
    }
}

// 2. DEPLOY COMMANDS
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
    
    // START THE NEW SCHEDULER
    startScheduler(client); 
    console.log("[SYSTEM] Reminder Scheduler Started.");
});

client.on(Events.InteractionCreate, async interaction => {
    // --- COMMAND HANDLER ---
    if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Error executing command.', ephemeral: true });
            } else {
                await interaction.followUp({ content: 'Error executing command.', ephemeral: true });
            }
        }
    } 
    // --- AUTOCOMPLETE HANDLER ---
    else if (interaction.isAutocomplete()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            if (command.autocomplete) await command.autocomplete(interaction);
        } catch (error) {
            console.error(error);
        }
    }
    // --- BUTTON HANDLER (NEW) ---
    else if (interaction.isButton()) {
        const { customId } = interaction;

        // 1. DISMISS BUTTON
        if (customId === "dismiss") {
            await interaction.update({ content: "✅ **Acknowledged.**", components: [] });
            return;
        }

        // 2. SNOOZE BUTTONS
        if (customId.startsWith("snooze_")) {
            const duration = customId.split("_")[1]; // "15m" or "1h"
            
            // Calculate Milliseconds
            let addMs = 0;
            if (duration === "15m") addMs = 15 * 60 * 1000;
            if (duration === "1h") addMs = 60 * 60 * 1000;

            const newTime = Date.now() + addMs;
            const newReadable = new Date(newTime).toISOString();
            
            // Data Setup
            // We pull the original message text from the Embed itself
            const originalEmbed = interaction.message.embeds[0];
            const originalMsg = originalEmbed ? originalEmbed.description : "Snoozed Reminder";
            
            const userId = interaction.user.id;
            const channelId = interaction.channelId;
            // The person clicking snooze gets the ping next time
            const targetString = `<@${userId}>`; 
            const newUUID = Math.random().toString(36).substring(2, 8);

            try {
                // WRITE TO SHEET: Add a new temporary reminder row
                await sheets.spreadsheets.values.append({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: "Reminders!A:H",
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: [[
                            userId, 
                            channelId, 
                            `(Snoozed) ${originalMsg}`, 
                            newTime, 
                            newReadable, 
                            "None", // Snoozes do not repeat
                            targetString, 
                            newUUID
                        ]]
                    }
                });
                
                await interaction.update({ content: `💤 **Snoozed for ${duration}.**`, components: [] });
            } catch (err) {
                console.error("[BUTTON ERROR]", err);
                await interaction.reply({ content: "❌ Failed to snooze. Check bot logs.", ephemeral: true });
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
