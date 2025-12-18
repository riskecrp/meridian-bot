import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    AttachmentBuilder
} from "discord.js";
import { google } from "googleapis";
import { randomUUID } from 'crypto';

// ENV VARS (MUST MATCH RAILWAY)
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// GOOGLE AUTH
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// ───────────────────────────────────────────────
// REMINDER MANAGEMENT (IN-MEMORY)
// ───────────────────────────────────────────────
const reminders = new Map();
const reminderTimeouts = new Map();
const MAX_TIMEOUT_DELAY = 2147483647; // ~24.8 days

async function setReminder(userId, reminderData) {
    const reminderId = randomUUID();
    const reminderTime = new Date(reminderData.time);

    const reminder = {
        id: reminderId,
        userId,
        message: reminderData.message,
        time: reminderTime,
        channelId: reminderData.channelId,
    };

    reminders.set(reminderId, reminder);

    const delay = reminderTime.getTime() - Date.now();
    if (delay > 0) {
        if (delay > MAX_TIMEOUT_DELAY) {
            throw new Error(`Reminder time is too far in the future. Maximum delay is approximately 24 days.`);
        }

        const timeoutId = setTimeout(async () => {
            try {
                if (!reminders.has(reminderId)) {
                    return;
                }

                const channel = await client.channels.fetch(reminder.channelId);
                if (channel) {
                    await channel.send(`<@${userId}> Reminder: ${reminder.message}`);
                }
            } catch (error) {
                console.error(`Error sending reminder ${reminderId}:`, error);
                try {
                    const channel = await client.channels.fetch(reminder.channelId);
                    if (channel) {
                        await channel.send(`<@${userId}> ⚠️ Failed to send reminder: ${reminder.message}`);
                    }
                } catch (notifyError) {
                    console.error(`Failed to send error notification:`, notifyError);
                }
            } finally {
                reminders.delete(reminderId);
                reminderTimeouts.delete(reminderId);
            }
        }, delay);

        reminderTimeouts.set(reminderId, timeoutId);
    }

    return reminderId;
}

function listReminders(userId = null) {
    const userReminders = [];
    for (const [id, reminder] of reminders.entries()) {
        if (!userId || reminder.userId === userId) {
            userReminders.push({
                id,
                message: reminder.message,
                time: reminder.time.toISOString(),
            });
        }
    }
    return userReminders;
}

function deleteReminder(reminderId, userId) {
    const reminder = reminders.get(reminderId);
    if (reminder && reminder.userId === userId) {
        const timeoutId = reminderTimeouts.get(reminderId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            reminderTimeouts.delete(reminderId);
        }

        reminders.delete(reminderId);
        return true;
    }
    return false;
}

function parseTimeString(timeStr) {
    let date = new Date(timeStr);
    if (!isNaN(date.getTime())) {
        return date;
    }

    const relativeMatch = timeStr.match(/in (\d+) (minute|minutes|hour|hours|day|days)/i);
    if (relativeMatch) {
        const amount = parseInt(relativeMatch[1]);
        const unit = relativeMatch[2].toLowerCase();
        const now = new Date();

        if (unit.startsWith('minute')) {
            now.setMinutes(now.getMinutes() + amount);
        } else if (unit.startsWith('hour')) {
            now.setHours(now.getHours() + amount);
        } else if (unit.startsWith('day')) {
            now.setDate(now.getDate() + amount);
        }

        return now;
    }

    return null;
}

// ───────────────────────────────────────────────
// HELPER FUNCTIONS FOR GOOGLE SHEETS
// ───────────────────────────────────────────────

function formatDate(date = new Date()) {
    return date.toISOString().split('T')[0];
}

async function findNextRowSheet1() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Sheet1!F:F"
    });
    return (res.data.values || []).length + 1;
}

async function findNextRowRewards() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "PropertyRewards!A:A"
    });
    return (res.data.values || []).length + 1;
}

async function findNextRowTable1() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Sheet1!A:A"
    });
    return (res.data.values || []).length + 1;
}

async function getOrCreateSheet(sheetName) {
    try {
        const res = await sheets.spreadsheets.get({
            spreadsheetId: GOOGLE_SHEET_ID
        });
        
        const sheetExists = res.data.sheets.some(s => s.properties.title === sheetName);
        
        if (!sheetExists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: GOOGLE_SHEET_ID,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: sheetName
                            }
                        }
                    }]
                }
            });
            console.log(`Created new sheet: ${sheetName}`);
        }
        
        return sheetName;
    } catch (error) {
        console.error(`Error getting/creating sheet ${sheetName}:`, error);
        throw error;
    }
}

async function ensureHeaders(sheetName, headers) {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A1:Z1`
        });
        
        const existingHeaders = res.data.values?.[0] || [];
        
        if (existingHeaders.length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${sheetName}!A1`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [headers]
                }
            });
        }
    } catch (error) {
        console.error(`Error ensuring headers for ${sheetName}:`, error);
        throw error;
    }
}

async function appendRow(sheetName, values) {
    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A:Z`,
            valueInputOption: "USER_ENTERED",
            insertDataOption: "INSERT_ROWS",
            requestBody: {
                values: [values]
            }
        });
    } catch (error) {
        console.error(`Error appending row to ${sheetName}:`, error);
        throw error;
    }
}

async function getSheetData(sheetName, range) {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!${range}`
        });
        return res.data.values || [];
    } catch (error) {
        console.error(`Error getting data from ${sheetName}:`, error);
        return [];
    }
}

function chunkLinesToFieldValues(lines, maxLen = 1024) {
    const chunks = [];
    let current = "";

    for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > maxLen) {
            if (current) {
                chunks.push(current);
                current = line;
                if (current.length > maxLen) {
                    let start = 0;
                    while (start < current.length) {
                        const piece = current.slice(start, start + maxLen);
                        chunks.push(piece);
                        start += maxLen;
                    }
                    current = "";
                }
            } else {
                let start = 0;
                while (start < line.length) {
                    const piece = line.slice(start, start + maxLen);
                    chunks.push(piece);
                    start += maxLen;
                }
                current = "";
            }
        } else {
            current = next;
        }
    }

    if (current) chunks.push(current);

    return chunks;
}

// ───────────────────────────────────────────────
// NEW FEATURE IMPLEMENTATIONS
// ───────────────────────────────────────────────

// Property Information (NEW)
async function addPropertyInfo(name, data) {
    await getOrCreateSheet('Properties');
    await ensureHeaders('Properties', ['Name', 'Description', 'Location', 'Owner', 'LastUpdated']);
    await appendRow('Properties', [
        name,
        data.description || '',
        data.location || '',
        data.owner || '',
        formatDate()
    ]);
}

async function getPropertyInfo(propertyName) {
    const rows = await getSheetData('Properties', 'A2:E999');
    const property = rows.find(row => 
        row[0]?.toLowerCase() === propertyName.toLowerCase()
    );
    
    if (property) {
        return {
            Name: property[0],
            Description: property[1],
            Location: property[2],
            Owner: property[3],
            LastUpdated: property[4]
        };
    }
    return null;
}

// People Information (NEW)
async function addPersonInfo(name, data) {
    await getOrCreateSheet('People');
    await ensureHeaders('People', ['Name', 'Faction', 'Role', 'Description', 'LastUpdated']);
    await appendRow('People', [
        name,
        data.faction || '',
        data.role || '',
        data.description || '',
        formatDate()
    ]);
}

async function getPersonInfo(personName) {
    const rows = await getSheetData('People', 'A2:E999');
    const person = rows.find(row => 
        row[0]?.toLowerCase() === personName.toLowerCase()
    );
    
    if (person) {
        return {
            Name: person[0],
            Faction: person[1],
            Role: person[2],
            Description: person[3],
            LastUpdated: person[4]
        };
    }
    return null;
}

// Faction Notes (NEW)
async function addFactionNote(faction, note, author) {
    await getOrCreateSheet('FactionNotes');
    await ensureHeaders('FactionNotes', ['Faction', 'Note', 'Author', 'Date']);
    await appendRow('FactionNotes', [
        faction,
        note,
        author,
        new Date().toISOString()
    ]);
}

async function getFactionNotes(faction, daysBack = 30, getAll = false) {
    const rows = await getSheetData('FactionNotes', 'A2:D999');
    
    let notes = rows.filter(row => 
        row[0]?.toLowerCase() === faction.toLowerCase()
    );
    
    if (!getAll && daysBack) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysBack);
        
        notes = notes.filter(row => {
            const noteDate = new Date(row[3]);
            return noteDate >= cutoffDate;
        });
    }
    
    return notes.map(row => ({
        Faction: row[0],
        Note: row[1],
        Author: row[2],
        Date: row[3]
    }));
}

// Scene Management (NEW)
async function addScene(sceneData) {
    await getOrCreateSheet('Scenes');
    await ensureHeaders('Scenes', ['Title', 'Description', 'Participants', 'Location', 'Date', 'AddedBy']);
    await appendRow('Scenes', [
        sceneData.title,
        sceneData.description || '',
        sceneData.participants || '',
        sceneData.location || '',
        new Date().toISOString(),
        sceneData.addedBy
    ]);
}

async function logScene(sceneInfo) {
    await getOrCreateSheet('SceneLogs');
    await ensureHeaders('SceneLogs', ['SceneName', 'LogEntry', 'LoggedBy', 'Timestamp']);
    await appendRow('SceneLogs', [
        sceneInfo.sceneName,
        sceneInfo.logEntry,
        sceneInfo.loggedBy,
        new Date().toISOString()
    ]);
}

async function getSceneCount() {
    const rows = await getSheetData('Scenes', 'A2:F999');
    return rows.length;
}

// ───────────────────────────────────────────────
// SLASH COMMAND DEFINITIONS
// ───────────────────────────────────────────────

// ORIGINAL COMMANDS
const factionInfoCmd = new SlashCommandBuilder()
    .setName("factioninfo")
    .setDescription("Look up faction information from the Meridian database.")
    .addStringOption(option =>
        option.setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
            .setAutocomplete(true)
    );

const addPropertyCmd = new SlashCommandBuilder()
    .setName("addproperty")
    .setDescription("Add a property reward and update the faction database.")
    .addStringOption(o =>
        o.setName("date")
            .setDescription("Date Given (YYYY-MM-DD)")
            .setRequired(true)
    )
    .addStringOption(o =>
        o.setName("faction")
            .setDescription("Faction Name")
            .setRequired(true)
            .setAutocomplete(true)
    )
    .addStringOption(o =>
        o.setName("address")
            .setDescription("Property Address")
            .setRequired(true)
    )
    .addStringOption(o =>
        o.setName("type")
            .setDescription("Property Type")
            .setRequired(true)
            .addChoices(
                { name: "Property", value: "Property" },
                { name: "Warehouse", value: "Warehouse" },
                { name: "HQ", value: "HQ" }
            )
    )
    .addBooleanOption(o =>
        o.setName("confiscated")
            .setDescription("Confiscated or not?")
            .setRequired(true)
    );

const listPropertiesCmd = new SlashCommandBuilder()
    .setName("listproperties")
    .setDescription("List all properties recorded on the PropertyRewards sheet.");

const addDossierCmd = new SlashCommandBuilder()
    .setName("adddossier")
    .setDescription("Add a dossier entry (person or location) to Sheet1.")
    .addSubcommand(sub =>
        sub
            .setName("person")
            .setDescription("Add a person (Table 1: Sheet1 A-E)")
            .addStringOption(o =>
                o.setName("faction")
                    .setDescription("Faction Name")
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(o =>
                o.setName("character")
                    .setDescription("Character name")
                    .setRequired(true)
            )
            .addStringOption(o =>
                o.setName("phone")
                    .setDescription("Phone")
                    .setRequired(false)
            )
            .addStringOption(o =>
                o.setName("personaladdress")
                    .setDescription("Personal Address")
                    .setRequired(false)
            )
            .addBooleanOption(o =>
                o.setName("leader")
                    .setDescription("Is this character a leader?")
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub
            .setName("location")
            .setDescription("Add a location tied to a faction (Table 2: Sheet1 F-H)")
            .addStringOption(o =>
                o.setName("faction")
                    .setDescription("Faction Name")
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addStringOption(o =>
                o.setName("address")
                    .setDescription("Property Address")
                    .setRequired(true)
            )
            .addBooleanOption(o =>
                o.setName("is_hq")
                    .setDescription("Is this property an HQ?")
                    .setRequired(true)
            )
    );

const confiscatePropertyCmd = new SlashCommandBuilder()
    .setName("confiscateproperty")
    .setDescription("Mark a previously-recorded property as confiscated and set the Date Confiscated.")
    .addStringOption(o =>
        o.setName("date")
            .setDescription("Date Given (YYYY-MM-DD) — kept for context but NOT required to match")
            .setRequired(true)
    )
    .addStringOption(o =>
        o.setName("faction")
            .setDescription("Faction Name")
            .setRequired(true)
            .setAutocomplete(true)
    )
    .addStringOption(o =>
        o.setName("address")
            .setDescription("Property Address")
            .setRequired(true)
    )
    .addStringOption(o =>
        o.setName("type")
            .setDescription("Property Type (kept for context but NOT required to match)")
            .setRequired(true)
            .addChoices(
                { name: "Property", value: "Property" },
                { name: "Warehouse", value: "Warehouse" },
                { name: "HQ", value: "HQ" }
            )
    )
    .addBooleanOption(o =>
        o.setName("confiscated")
            .setDescription("Set to true to mark confiscated")
            .setRequired(true)
    );

// NEW COMMANDS - Property Info
const getPropertyCmd = new SlashCommandBuilder()
    .setName('getproperty')
    .setDescription('Get property information')
    .addStringOption(option => 
        option.setName('name')
            .setDescription('Property name')
            .setRequired(true));

// NEW COMMANDS - People Info
const addPersonCmd = new SlashCommandBuilder()
    .setName('addperson')
    .setDescription('Add person information')
    .addStringOption(option => 
        option.setName('name')
            .setDescription('Person name')
            .setRequired(true))
    .addStringOption(option => 
        option.setName('faction')
            .setDescription('Faction affiliation')
            .setRequired(false))
    .addStringOption(option => 
        option.setName('role')
            .setDescription('Role or title')
            .setRequired(false))
    .addStringOption(option => 
        option.setName('description')
            .setDescription('Person description')
            .setRequired(false));

const getPersonCmd = new SlashCommandBuilder()
    .setName('getperson')
    .setDescription('Get person information')
    .addStringOption(option => 
        option.setName('name')
            .setDescription('Person name')
            .setRequired(true));

// NEW COMMANDS - Faction Notes
const addNoteCmd = new SlashCommandBuilder()
    .setName('addnote')
    .setDescription('Add a notable interaction for a faction')
    .addStringOption(option => 
        option.setName('faction')
            .setDescription('Faction name')
            .setRequired(true))
    .addStringOption(option => 
        option.setName('note')
            .setDescription('Note content')
            .setRequired(true));

const getNotesCmd = new SlashCommandBuilder()
    .setName('getnotes')
    .setDescription('Retrieve notable interactions for a faction')
    .addStringOption(option => 
        option.setName('faction')
            .setDescription('Faction name')
            .setRequired(true))
    .addIntegerOption(option => 
        option.setName('days')
            .setDescription('Number of days to look back (default: 30)')
            .setRequired(false))
    .addBooleanOption(option => 
        option.setName('all')
            .setDescription('Retrieve all notes regardless of date')
            .setRequired(false));

// NEW COMMANDS - Scene Management
const addSceneCmd = new SlashCommandBuilder()
    .setName('addscene')
    .setDescription('Add scene data')
    .addStringOption(option => 
        option.setName('title')
            .setDescription('Scene title')
            .setRequired(true))
    .addStringOption(option => 
        option.setName('description')
            .setDescription('Scene description')
            .setRequired(false))
    .addStringOption(option => 
        option.setName('participants')
            .setDescription('Participants (comma-separated)')
            .setRequired(false))
    .addStringOption(option => 
        option.setName('location')
            .setDescription('Scene location')
            .setRequired(false));

const logSceneCmd = new SlashCommandBuilder()
    .setName('logscene')
    .setDescription('Log information about a specific scene')
    .addStringOption(option => 
        option.setName('scenename')
            .setDescription('Scene name')
            .setRequired(true))
    .addStringOption(option => 
        option.setName('logentry')
            .setDescription('Log entry')
            .setRequired(true));

const getSceneCountCmd = new SlashCommandBuilder()
    .setName('getscenecount')
    .setDescription('Retrieve the count of scenes');

// NEW COMMANDS - Reminder Management
const setReminderCmd = new SlashCommandBuilder()
    .setName('setreminder')
    .setDescription('Set a reminder for an event')
    .addStringOption(option => 
        option.setName('message')
            .setDescription('Reminder message')
            .setRequired(true))
    .addStringOption(option => 
        option.setName('time')
            .setDescription('Time (e.g., "2024-12-25 10:00" or "in 2 hours")')
            .setRequired(true));

const listRemindersCmd = new SlashCommandBuilder()
    .setName('listreminders')
    .setDescription('List all active reminders');

const deleteReminderCmd = new SlashCommandBuilder()
    .setName('deletereminder')
    .setDescription('Delete a specific reminder')
    .addStringOption(option => 
        option.setName('reminderid')
            .setDescription('Reminder ID')
            .setRequired(true));

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

// ───────────────────────────────────────────────
// DEPLOY COMMANDS
// ───────────────────────────────────────────────

async function deployCommands() {
    try {
        const commands = [
            // Original commands
            factionInfoCmd.toJSON(),
            addPropertyCmd.toJSON(),
            listPropertiesCmd.toJSON(),
            addDossierCmd.toJSON(),
            confiscatePropertyCmd.toJSON(),
            // New commands
            getPropertyCmd.toJSON(),
            addPersonCmd.toJSON(),
            getPersonCmd.toJSON(),
            addNoteCmd.toJSON(),
            getNotesCmd.toJSON(),
            addSceneCmd.toJSON(),
            logSceneCmd.toJSON(),
            getSceneCountCmd.toJSON(),
            setReminderCmd.toJSON(),
            listRemindersCmd.toJSON(),
            deleteReminderCmd.toJSON()
        ];

        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );
        console.log("Commands registered.");
    } catch (err) {
        console.error("DEPLOY ERROR:", err);
    }
}

// ───────────────────────────────────────────────
// AUTOCOMPLETE SUPPORT
// ───────────────────────────────────────────────

let cachedFactions = [];

async function loadFactions() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Sheet1!A1:H999"
    });

    const rows = res.data.values || [];
    const set = new Set();

    for (const r of rows.slice(1)) {
        if (r[0]) set.add(r[0].trim());
        if (r[5]) set.add(r[5].trim());
    }

    cachedFactions = [...set];
}

// ───────────────────────────────────────────────
// DISCORD CLIENT
// ───────────────────────────────────────────────

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
    client.user.setPresence({
        activities: [{ name: "Waiting for associate request...", type: 3 }],
        status: "online"
    });
});

// ───────────────────────────────────────────────
// AUTOCOMPLETE HANDLER
// ───────────────────────────────────────────────

client.on("interactionCreate", async interaction => {
    if (!interaction.isAutocomplete()) return;

    const focused = interaction.options.getFocused();
    if (cachedFactions.length === 0) await loadFactions();

    const suggestions = cachedFactions
        .filter(f => f.toLowerCase().includes(focused.toLowerCase()))
        .slice(0, 25)
        .map(f => ({ name: f, value: f }));

    interaction.respond(suggestions);
});

// ───────────────────────────────────────────────
// COMMAND HANDLER
// ───────────────────────────────────────────────

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        // ────────────────
        // /factioninfo (ORIGINAL)
        // ────────────────
        if (interaction.commandName === "factioninfo") {
            const factionRequested = interaction.options.getString("faction").toLowerCase();

            try {
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: "Sheet1!A1:H999"
                });

                const rows = res.data.values || [];
                const data = rows.slice(1);

                const people = data
                    .filter(r => r[0] && r[0].toLowerCase() === factionRequested)
                    .map(r => ({
                        character: r[1] || "N/A",
                        phone: r[2] || "N/A",
                        personalAddress: r[3] || "N/A",
                        leader: r[4]?.toUpperCase() === "TRUE"
                    }));

                const locationRows = data.filter(r =>
                    r[5] && r[5].toLowerCase() === factionRequested
                );

                let hqs = [];
                let addresses = [];

                for (const r of locationRows) {
                    const addr = r[6];
                    const isHQ = r[7] === "TRUE";

                    if (!addr) continue;
                    if (isHQ) hqs.push(addr);
                    else addresses.push(addr);
                }

                const uniqueHQs = [...new Set(hqs)];
                const uniqueAddrs = [...new Set(addresses.filter(a => !uniqueHQs.includes(a)))];

                const embed = new EmbedBuilder()
                    .setColor(0x2b6cb0)
                    .setTitle(
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `🗂️  **MERIDIAN DATABASE ENTRY**\n` +
                        `**Organization: ${interaction.options.getString("faction")}**\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                    )
                    .addFields({
                        name: "⠀",
                        value:
                            `__**Known Command Members**__\n` +
                            (
                                people.length
                                    ? people
                                        .map(p =>
                                            `**${p.character}**${p.leader ? " (Leader)" : ""}\n` +
                                            `• Phone: ${p.phone}\n` +
                                            `• Residence: ${p.personalAddress}`
                                        )
                                        .join("\n\n")
                                    : "_No command members listed._"
                            )
                            +
                            `\n\n⠀\n` +
                            `__**Known Organization Properties**__\n` +
                            (
                                uniqueHQs.length || uniqueAddrs.length
                                    ? [
                                        ...uniqueHQs.map(a => `🏠 **HQ:** ${a}`),
                                        ...uniqueAddrs.map(a => `📍 Property: ${a}`)
                                    ].join("\n")
                                    : "_No faction properties listed._"
                            )
                    });

                return interaction.reply({ embeds: [embed] });

            } catch (err) {
                console.error("FACTIONINFO ERROR:", err);
                return interaction.reply("There was an error accessing the Google Sheet.");
            }
        }

        // ────────────────
        // /addproperty (ORIGINAL - Management-only)
        // ────────────────
        if (interaction.commandName === "addproperty") {
            const memberRoles = interaction.member?.roles?.cache;
            const hasManagement = memberRoles ? memberRoles.some(r => r.name === "Management") : false;

            if (!hasManagement) {
                return interaction.reply({ content: "You do not have permission to run this command. (Requires Management role)", ephemeral: true });
            }

            try {
                await interaction.deferReply({ ephemeral: true });
            } catch (err) {
                console.warn("Failed to defer reply:", err);
            }

            const date = interaction.options.getString("date");
            const faction = interaction.options.getString("faction");
            const address = interaction.options.getString("address");
            const type = interaction.options.getString("type");
            const confiscated = interaction.options.getBoolean("confiscated");

            try {
                const rewardsRow = await findNextRowRewards();
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `PropertyRewards!A${rewardsRow}:E${rewardsRow}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: [[date, faction, address, type, confiscated]]
                    }
                });

                const row = await findNextRowSheet1();
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `Sheet1!F${row}:H${row}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: [
                            [
                                faction,
                                address,
                                type === "HQ" ? true : false
                            ]
                        ]
                    }
                });

                return interaction.editReply({
                    content: "✅ Property recorded and added to faction database."
                });

            } catch (err) {
                console.error("ADDPROPERTY ERROR:", err);
                try {
                    return interaction.editReply("There was an error updating the Google Sheet.");
                } catch (e) {
                    return interaction.followUp({ content: "There was an error updating the Google Sheet.", ephemeral: true });
                }
            }
        }

        // ────────────────
        // /listproperties (ORIGINAL - Management-only)
        // ────────────────
        if (interaction.commandName === "listproperties") {
            const memberRoles = interaction.member?.roles?.cache;
            const hasManagement = memberRoles ? memberRoles.some(r => r.name === "Management") : false;

            if (!hasManagement) {
                return interaction.reply({ content: "You do not have permission to run this command. (Requires Management role)", ephemeral: true });
            }

            try {
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: "PropertyRewards!A1:E999"
                });

                const rows = res.data.values || [];
                const data = rows.slice(1);

                if (data.length === 0) {
                    const embedEmpty = new EmbedBuilder()
                        .setColor(0x2b6cb0)
                        .setTitle(
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `🗂️  **FACTION MANAGEMENT**\n` +
                            `**Property List**\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                        )
                        .addFields({ name: "⠀", value: "_No properties listed._" });

                    return interaction.reply({ embeds: [embedEmpty] });
                }

                const lines = data.map(r => {
                    const faction = r[1] || "Unknown Faction";
                    const address = r[2] || "N/A";
                    const type = r[3] || "Property";
                    const icon = type === "HQ" ? "🏠" : type === "Warehouse" ? "📦" : "📍";
                    return `**${faction}** - ${icon} ${type}: ${address}`;
                });

                const fieldValues = chunkLinesToFieldValues(lines, 1024);
                const fields = fieldValues.map((v) => ({ name: "⠀", value: v }));

                const MAX_FIELDS_PER_EMBED = 25;
                const MAX_EMBEDS = 10;

                if (fields.length <= MAX_FIELDS_PER_EMBED) {
                    const embed = new EmbedBuilder()
                        .setColor(0x2b6cb0)
                        .setTitle(
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `🗂️  **FACTION MANAGEMENT**\n` +
                            `**Property List**\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                        )
                        .addFields(fields);
                    return interaction.reply({ embeds: [embed] });
                }

                const embeds = [];
                for (let i = 0; i < fields.length && embeds.length < MAX_EMBEDS; i += MAX_FIELDS_PER_EMBED) {
                    const slice = fields.slice(i, i + MAX_FIELDS_PER_EMBED);
                    const embed = new EmbedBuilder()
                        .setColor(0x2b6cb0)
                        .setTitle(
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `🗂️  **FACTION MANAGEMENT**\n` +
                            `**Property List**\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                        )
                        .addFields(slice);
                    embeds.push(embed);
                }

                if (fields.length <= MAX_FIELDS_PER_EMBED * MAX_EMBEDS) {
                    return interaction.reply({ embeds });
                }

                const fullText = lines.join("\n");
                const buffer = Buffer.from(fullText, "utf8");
                const attachment = new AttachmentBuilder(buffer, { name: "properties.txt" });

                const fallbackEmbed = new EmbedBuilder()
                    .setColor(0x2b6cb0)
                    .setTitle(
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `🗂️  **FACTION MANAGEMENT**\n` +
                        `**Property List**\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                    )
                    .setDescription("Property list is too long for embeds; attached as properties.txt");

                return interaction.reply({ embeds: [fallbackEmbed], files: [attachment] });

            } catch (err) {
                console.error("LISTPROPERTIES ERROR:", err);
                return interaction.reply("There was an error accessing the Google Sheet.");
            }
        }

        // ────────────────
        // /confiscateproperty (ORIGINAL - Management-only)
        // ────────────────
        if (interaction.commandName === "confiscateproperty") {
            const memberRoles = interaction.member?.roles?.cache;
            const hasManagement = memberRoles ? memberRoles.some(r => r.name === "Management") : false;

            if (!hasManagement) {
                return interaction.reply({ content: "You do not have permission to run this command. (Requires Management role)", ephemeral: true });
            }

            try {
                await interaction.deferReply({ ephemeral: true });
            } catch (err) {
                console.warn("Failed to defer reply:", err);
            }

            const dateGivenInput = interaction.options.getString("date");
            const factionInput = interaction.options.getString("faction");
            const addressInput = interaction.options.getString("address");
            const typeInput = interaction.options.getString("type");
            const confiscatedFlag = interaction.options.getBoolean("confiscated");

            if (!confiscatedFlag) {
                return interaction.editReply({ content: "No action taken — 'confiscated' was not set to true.", ephemeral: true });
            }

            try {
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: "PropertyRewards!A1:F999"
                });

                const rows = res.data.values || [];

                const factionNorm = (factionInput || "").trim().toLowerCase();
                const addressNorm = (addressInput || "").trim().toLowerCase();

                const candidates = [];
                for (let i = 1; i < rows.length; i++) {
                    const r = rows[i];
                    const rFaction = (r[1] || "").toString().trim().toLowerCase();
                    const rAddress = (r[2] || "").toString().trim().toLowerCase();
                    if (rFaction === factionNorm && rAddress === addressNorm) {
                        let ts = 0;
                        if (r[0]) {
                            const parsed = Date.parse(r[0].toString().trim());
                            if (!isNaN(parsed)) ts = parsed;
                        }
                        candidates.push({ index: i, dateTimestamp: ts, row: r });
                    }
                }

                if (candidates.length === 0) {
                    return interaction.editReply({ content: "No matching PropertyRewards row found for that Faction and Address." });
                }

                candidates.sort((a, b) => {
                    if (a.dateTimestamp === b.dateTimestamp) return a.index - b.index;
                    return b.dateTimestamp - a.dateTimestamp;
                });

                const chosen = candidates[0];
                const sheetRow = chosen.index + 1;

                const existingRow = chosen.row;
                const updatedA = existingRow[0] || dateGivenInput;
                const updatedB = existingRow[1] || factionInput;
                const updatedC = existingRow[2] || addressInput;
                const updatedD = existingRow[3] || typeInput;
                const updatedE = true;
                const dateConfiscated = new Date().toISOString().slice(0, 10);
                const updatedF = dateConfiscated;

                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `PropertyRewards!A${sheetRow}:F${sheetRow}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: [[updatedA, updatedB, updatedC, updatedD, updatedE, updatedF]]
                    }
                });

                return interaction.editReply({ content: `✅ Property row updated for Faction="${updatedB}", Address="${updatedC}": Confiscated=TRUE, Date Confiscated=${dateConfiscated}` });

            } catch (err) {
                console.error("CONFISCATEPROPERTY ERROR:", err);
                try {
                    return interaction.editReply("There was an error updating the Google Sheet.");
                } catch (e) {
                    return interaction.followUp({ content: "There was an error updating the Google Sheet.", ephemeral: true });
                }
            }
        }

        // ────────────────
        // /adddossier (ORIGINAL - Team Lead OR Management roles required)
        // ────────────────
        if (interaction.commandName === "adddossier") {
            const memberRoles = interaction.member?.roles?.cache;
            const hasTeamLead = memberRoles ? memberRoles.some(r => r.name === "Team Lead") : false;
            const hasManagement = memberRoles ? memberRoles.some(r => r.name === "Management") : false;

            if (!(hasTeamLead || hasManagement)) {
                return interaction.reply({ content: "You do not have permission to run this command. (Requires Team Lead or Management role)", ephemeral: true });
            }

            const sub = interaction.options.getSubcommand();

            try {
                if (sub === "person") {
                    const faction = interaction.options.getString("faction");
                    const character = interaction.options.getString("character");
                    const phone = interaction.options.getString("phone") || "";
                    const personalAddress = interaction.options.getString("personaladdress") || "";
                    const leader = interaction.options.getBoolean("leader") ? true : false;

                    const row = await findNextRowTable1();
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        range: `Sheet1!A${row}:E${row}`,
                        valueInputOption: "USER_ENTERED",
                        requestBody: {
                            values: [[faction, character, phone, personalAddress, leader]]
                        }
                    });

                    return interaction.reply({ content: "✅ Person dossier recorded to Sheet1 (A-E).", ephemeral: true });
                }

                if (sub === "location") {
                    const faction = interaction.options.getString("faction");
                    const address = interaction.options.getString("address");
                    const isHQ = interaction.options.getBoolean("is_hq") ? true : false;

                    const row = await findNextRowSheet1();
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        range: `Sheet1!F${row}:H${row}`,
                        valueInputOption: "USER_ENTERED",
                        requestBody: {
                            values: [[faction, address, isHQ]]
                        }
                    });

                    return interaction.reply({ content: "✅ Location dossier recorded to Sheet1 (F-H).", ephemeral: true });
                }

                return interaction.reply({ content: "Unknown subcommand.", ephemeral: true });

            } catch (err) {
                console.error("ADDDOSSIER ERROR:", err);
                return interaction.reply("There was an error updating the Google Sheet.");
            }
        }

        // ────────────────
        // NEW COMMANDS
        // ────────────────

        // /getproperty (NEW)
        if (interaction.commandName === 'getproperty') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const property = await getPropertyInfo(name);

            if (property) {
                const embed = new EmbedBuilder()
                    .setTitle(`Property: ${property.Name}`)
                    .setColor(0x0099ff)
                    .addFields(
                        { name: 'Description', value: property.Description || 'N/A', inline: false },
                        { name: 'Location', value: property.Location || 'N/A', inline: true },
                        { name: 'Owner', value: property.Owner || 'N/A', inline: true },
                        { name: 'Last Updated', value: property.LastUpdated || 'N/A', inline: true }
                    );
                await interaction.editReply({ embeds: [embed] });
            } else {
                await interaction.editReply(`❌ Property "${name}" not found.`);
            }
        }

        // /addperson (NEW)
        else if (interaction.commandName === 'addperson') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const faction = interaction.options.getString('faction');
            const role = interaction.options.getString('role');
            const description = interaction.options.getString('description');

            await addPersonInfo(name, { faction, role, description });
            await interaction.editReply(`✅ Person "${name}" has been added.`);
        }

        // /getperson (NEW)
        else if (interaction.commandName === 'getperson') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const person = await getPersonInfo(name);

            if (person) {
                const embed = new EmbedBuilder()
                    .setTitle(`Person: ${person.Name}`)
                    .setColor(0x00ff99)
                    .addFields(
                        { name: 'Faction', value: person.Faction || 'N/A', inline: true },
                        { name: 'Role', value: person.Role || 'N/A', inline: true },
                        { name: 'Description', value: person.Description || 'N/A', inline: false },
                        { name: 'Last Updated', value: person.LastUpdated || 'N/A', inline: true }
                    );
                await interaction.editReply({ embeds: [embed] });
            } else {
                await interaction.editReply(`❌ Person "${name}" not found.`);
            }
        }

        // /addnote (NEW)
        else if (interaction.commandName === 'addnote') {
            await interaction.deferReply();
            const faction = interaction.options.getString('faction');
            const note = interaction.options.getString('note');
            const author = interaction.user.tag;

            await addFactionNote(faction, note, author);
            await interaction.editReply(`✅ Note added for faction "${faction}".`);
        }

        // /getnotes (NEW)
        else if (interaction.commandName === 'getnotes') {
            await interaction.deferReply();
            const faction = interaction.options.getString('faction');
            const days = interaction.options.getInteger('days') || 30;
            const getAll = interaction.options.getBoolean('all') || false;

            const notes = await getFactionNotes(faction, days, getAll);

            if (notes.length > 0) {
                const embed = new EmbedBuilder()
                    .setTitle(`Notes for Faction: ${faction}`)
                    .setColor(0xff9900)
                    .setDescription(getAll ? 'Showing all notes' : `Showing notes from the last ${days} days`);

                notes.slice(0, 10).forEach((note, index) => {
                    const date = new Date(note.Date).toLocaleDateString();
                    embed.addFields({
                        name: `${index + 1}. ${date} - ${note.Author}`,
                        value: note.Note || 'N/A',
                        inline: false
                    });
                });

                if (notes.length > 10) {
                    embed.setFooter({ text: `Showing 10 of ${notes.length} notes` });
                }

                await interaction.editReply({ embeds: [embed] });
            } else {
                await interaction.editReply(`❌ No notes found for faction "${faction}".`);
            }
        }

        // /addscene (NEW)
        else if (interaction.commandName === 'addscene') {
            await interaction.deferReply();
            const title = interaction.options.getString('title');
            const description = interaction.options.getString('description');
            const participants = interaction.options.getString('participants');
            const location = interaction.options.getString('location');
            const addedBy = interaction.user.tag;

            await addScene({ title, description, participants, location, addedBy });
            await interaction.editReply(`✅ Scene "${title}" has been added.`);
        }

        // /logscene (NEW)
        else if (interaction.commandName === 'logscene') {
            await interaction.deferReply();
            const sceneName = interaction.options.getString('scenename');
            const logEntry = interaction.options.getString('logentry');
            const loggedBy = interaction.user.tag;

            await logScene({ sceneName, logEntry, loggedBy });
            await interaction.editReply(`✅ Log entry added for scene "${sceneName}".`);
        }

        // /getscenecount (NEW)
        else if (interaction.commandName === 'getscenecount') {
            await interaction.deferReply();
            const count = await getSceneCount();
            await interaction.editReply(`📊 Total scenes: ${count}`);
        }

        // /setreminder (NEW)
        else if (interaction.commandName === 'setreminder') {
            await interaction.deferReply();
            const message = interaction.options.getString('message');
            const timeStr = interaction.options.getString('time');
            const time = parseTimeString(timeStr);

            if (!time || time < new Date()) {
                await interaction.editReply('❌ Invalid time format or time is in the past. Use formats like "2024-12-25 10:00" or "in 2 hours".');
                return;
            }

            const reminderId = await setReminder(interaction.user.id, {
                message,
                time,
                channelId: interaction.channelId,
            });

            await interaction.editReply(`✅ Reminder set for ${time.toLocaleString()}. Reminder ID: ${reminderId}`);
        }

        // /listreminders (NEW)
        else if (interaction.commandName === 'listreminders') {
            await interaction.deferReply();
            const userReminders = listReminders(interaction.user.id);

            if (userReminders.length > 0) {
                const embed = new EmbedBuilder()
                    .setTitle('Your Active Reminders')
                    .setColor(0x9900ff);

                userReminders.forEach((reminder, index) => {
                    const time = new Date(reminder.time).toLocaleString();
                    embed.addFields({
                        name: `${index + 1}. ${time}`,
                        value: `${reminder.message}\nID: ${reminder.id}`,
                        inline: false
                    });
                });

                await interaction.editReply({ embeds: [embed] });
            } else {
                await interaction.editReply('📭 You have no active reminders.');
            }
        }

        // /deletereminder (NEW)
        else if (interaction.commandName === 'deletereminder') {
            await interaction.deferReply();
            const reminderId = interaction.options.getString('reminderid');
            const deleted = deleteReminder(reminderId, interaction.user.id);

            if (deleted) {
                await interaction.editReply('✅ Reminder deleted successfully.');
            } else {
                await interaction.editReply('❌ Reminder not found or you do not have permission to delete it.');
            }
        }

    } catch (error) {
        console.error('Error handling command:', error);
        try {
            if (interaction.deferred) {
                await interaction.editReply('❌ An error occurred while processing your command.');
            } else {
                await interaction.reply({ content: '❌ An error occurred while processing your command.', ephemeral: true });
            }
        } catch (e) {
            console.error('Error sending error message:', e);
        }
    }
});

// ───────────────────────────────────────────────
// START BOT
// ───────────────────────────────────────────────

deployCommands();
client.login(DISCORD_TOKEN);
