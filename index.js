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
import { DateTime } from "luxon";
import cron from "node-cron";

// ENV VARS (MUST MATCH RAILWAY)
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ROLE IDS
const FACTION_MANAGEMENT_ROLE_ID = "1457229857749729363";

// REMINDER SHEET HEADERS
const REMINDER_SHEET_HEADERS = [
    "Reminder Text",
    "Input Time",
    "Input Date",
    "Input Timezone",
    "UTC Time",
    "UTC Date",
    "Recurrence",
    "Creator",
    "Creator Role",
    "Visibility",
    "Target Type",
    "Target Value",
    "Status",
    "Channel ID",
    "Channel Name",
    "Notification Role ID",
    "Notification Role Name"
];

// GOOGLE AUTH
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// ───────────────────────────────────────────────
// TIMEZONE UTILITIES
// ───────────────────────────────────────────────

// Validate if a timezone string is valid
function isValidTimezone(tz) {
    try {
        DateTime.now().setZone(tz);
        return DateTime.local().setZone(tz).isValid;
    } catch {
        return false;
    }
}

// Convert a date-time string from a specific timezone to UTC
// Returns an object with { utcDate: "YYYY-MM-DD", utcTime: "HH:MM", utcTimestamp: number }
function convertToUTC(date, time, timezone) {
    try {
        // Parse the input date and time in the specified timezone
        const dt = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", { zone: timezone });
        
        if (!dt.isValid) {
            return null;
        }
        
        // Convert to UTC
        const utcDt = dt.toUTC();
        
        return {
            utcDate: utcDt.toFormat("yyyy-MM-dd"),
            utcTime: utcDt.toFormat("HH:mm"),
            utcTimestamp: utcDt.toMillis(),
            originalTimezone: timezone
        };
    } catch (err) {
        console.error("Error converting to UTC:", err);
        return null;
    }
}

// Convert UTC date-time to a specific timezone for display
// Returns a formatted string
function convertFromUTC(utcDate, utcTime, targetTimezone) {
    try {
        const dt = DateTime.fromFormat(`${utcDate} ${utcTime}`, "yyyy-MM-dd HH:mm", { zone: "UTC" });
        
        if (!dt.isValid) {
            return null;
        }
        
        const localDt = dt.setZone(targetTimezone);
        
        return {
            date: localDt.toFormat("yyyy-MM-dd"),
            time: localDt.toFormat("HH:mm"),
            displayString: localDt.toFormat("yyyy-MM-dd HH:mm ZZZZ")
        };
    } catch (err) {
        console.error("Error converting from UTC:", err);
        return null;
    }
}

// ───────────────────────────────────────────────
// SLASH COMMANDS
// ───────────────────────────────────────────────

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

// ───────────────────────────────────────────────
// NEW COMMANDS: One-Off Scenes
// ───────────────────────────────────────────────

const logSceneCmd = new SlashCommandBuilder()
    .setName("logscene")
    .setDescription("Log execution of a scene with updated metadata.")
    .addStringOption(o =>
        o.setName("scene_name")
            .setDescription("Name of the scene")
            .setRequired(true)
            .setAutocomplete(true)
    )
    .addStringOption(o =>
        o.setName("participants")
            .setDescription("Participant names (comma-separated)")
            .setRequired(true)
    );

const sceneCountCmd = new SlashCommandBuilder()
    .setName("scenecount")
    .setDescription("List all scenes a faction has done in the last 90 days with counts.")
    .addStringOption(o =>
        o.setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
            .setAutocomplete(true)
    );

// ───────────────────────────────────────────────
// NEW COMMANDS: Notable Interactions
// ───────────────────────────────────────────────

const addNoteCmd = new SlashCommandBuilder()
    .setName("addnote")
    .setDescription("Log a notable interaction for a faction.")
    .addStringOption(o =>
        o.setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
            .setAutocomplete(true)
    )
    .addStringOption(o =>
        o.setName("note")
            .setDescription("The notable interaction to record")
            .setRequired(true)
    );

const getNotesCmd = new SlashCommandBuilder()
    .setName("getnotes")
    .setDescription("Retrieve notable interactions for a faction.")
    .addStringOption(o =>
        o.setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
            .setAutocomplete(true)
    )
    .addBooleanOption(o =>
        o.setName("all")
            .setDescription("Show all notes (default: last 30 days)")
            .setRequired(false)
    );

// ───────────────────────────────────────────────
// NEW COMMANDS: Reminders
// ───────────────────────────────────────────────

const setReminderCmd = new SlashCommandBuilder()
    .setName("setreminder")
    .setDescription("Create a one-time or recurring reminder.")
    .addStringOption(o =>
        o.setName("text")
            .setDescription("Reminder text")
            .setRequired(true)
    )
    .addStringOption(o =>
        o.setName("time")
            .setDescription("Time (HH:MM format, 24-hour)")
            .setRequired(true)
    )
    .addStringOption(o =>
        o.setName("date")
            .setDescription("Date (YYYY-MM-DD)")
            .setRequired(true)
    )
    .addChannelOption(o =>
        o.setName("channel")
            .setDescription("Channel where reminder will be posted")
            .setRequired(true)
    )
    .addRoleOption(o =>
        o.setName("notification_role")
            .setDescription("Role to notify (optional - in addition to target)")
            .setRequired(false)
    )
    .addStringOption(o =>
        o.setName("target_type")
            .setDescription("Who should receive the reminder ping")
            .setRequired(true)
            .addChoices(
                { name: "User", value: "user" },
                { name: "Role", value: "role" }
            )
    )
    .addStringOption(o =>
        o.setName("target_value")
            .setDescription("Username (for user) or Role name (for role)")
            .setRequired(true)
    )
    .addStringOption(o =>
        o.setName("recurrence")
            .setDescription("Recurrence pattern")
            .setRequired(false)
            .addChoices(
                { name: "None (One-time)", value: "none" },
                { name: "Daily", value: "daily" },
                { name: "Weekly", value: "weekly" },
                { name: "Monthly", value: "monthly" }
            )
    )
    .addStringOption(o =>
        o.setName("timezone")
            .setDescription("Timezone (e.g., America/New_York, UTC)")
            .setRequired(false)
    )
    .addStringOption(o =>
        o.setName("visibility")
            .setDescription("Who can see this reminder")
            .setRequired(false)
            .addChoices(
                { name: "Private (only you)", value: "private" },
                { name: "Role (your role)", value: "role" },
                { name: "Public (everyone)", value: "public" }
            )
    );

const listRemindersCmd = new SlashCommandBuilder()
    .setName("listreminders")
    .setDescription("Display your reminders and those shared with you.");

// ───────────────────────────────────────────────
// HELP COMMAND
// ───────────────────────────────────────────────

const helpCmd = new SlashCommandBuilder()
    .setName("help")
    .setDescription("Display help information about all available commands.");

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

// ───────────────────────────────────────────────
// DEPLOY COMMANDS
// ───────────────────────────────────────────────

async function deployCommands() {
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { 
                body: [
                    factionInfoCmd.toJSON(), 
                    addPropertyCmd.toJSON(), 
                    listPropertiesCmd.toJSON(), 
                    addDossierCmd.toJSON(), 
                    confiscatePropertyCmd.toJSON(),
                    logSceneCmd.toJSON(),
                    sceneCountCmd.toJSON(),
                    addNoteCmd.toJSON(),
                    getNotesCmd.toJSON(),
                    setReminderCmd.toJSON(),
                    listRemindersCmd.toJSON(),
                    helpCmd.toJSON()
                ] 
            }
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
let cachedScenes = [];

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

async function loadScenes() {
    try {
        // Check if tab exists
        const sheetInfo = await sheets.spreadsheets.get({
            spreadsheetId: GOOGLE_SHEET_ID
        });
        
        const tabExists = sheetInfo.data.sheets.some(s => s.properties.title === "One Off Scenes");
        
        if (!tabExists) {
            cachedScenes = [];
            return;
        }

        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "One Off Scenes!A:A"
        });

        const rows = res.data.values || [];
        cachedScenes = rows.slice(1).map(row => row[0]).filter(name => name && name.trim());
    } catch (err) {
        console.error("Error loading scenes:", err);
        cachedScenes = [];
    }
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
    
    // Start reminder checking system after bot is ready
    console.log("Starting reminder notification system...");
    cron.schedule('* * * * *', () => {
        checkReminders();
    });
});

// ───────────────────────────────────────────────
// AUTOCOMPLETE HANDLER
// ───────────────────────────────────────────────

client.on("interactionCreate", async interaction => {
    if (!interaction.isAutocomplete()) return;

    const focusedOption = interaction.options.getFocused(true);
    const focused = focusedOption.value;

    // Handle scene_name autocomplete for logscene command
    if (focusedOption.name === "scene_name") {
        if (cachedScenes.length === 0) await loadScenes();

        const suggestions = cachedScenes
            .filter(s => s.toLowerCase().includes(focused.toLowerCase()))
            .slice(0, 25)
            .map(s => ({ name: s, value: s }));

        return interaction.respond(suggestions);
    }

    // Handle faction autocomplete (default)
    if (cachedFactions.length === 0) await loadFactions();

    const suggestions = cachedFactions
        .filter(f => f.toLowerCase().includes(focused.toLowerCase()))
        .slice(0, 25)
        .map(f => ({ name: f, value: f }));

    interaction.respond(suggestions);
});

// ───────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────

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

// New helper to find next row for Table1 (A:E)
async function findNextRowTable1() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Sheet1!A:A"
    });
    return (res.data.values || []).length + 1;
}

// Helper to chunk lines into <=1024-char field values
function chunkLinesToFieldValues(lines, maxLen = 1024) {
    const chunks = [];
    let current = "";

    for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > maxLen) {
            if (current) {
                chunks.push(current);
                current = line;
                // If single line longer than maxLen, force-split the line
                if (current.length > maxLen) {
                    // split the line into pieces
                    let start = 0;
                    while (start < current.length) {
                        const piece = current.slice(start, start + maxLen);
                        chunks.push(piece);
                        start += maxLen;
                    }
                    current = "";
                }
            } else {
                // current empty but line itself > maxLen
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

// Get the last column letter for the Reminders sheet based on header count
function getReminderSheetLastColumn() {
    return numberToColumnLetter(REMINDER_SHEET_HEADERS.length);
}

// ───────────────────────────────────────────────
// NEW HELPERS: Sheet Initialization & Utilities
// ───────────────────────────────────────────────

// Convert column number to Excel-style column letter (A, B, ..., Z, AA, AB, ...)
function numberToColumnLetter(num) {
    let letter = '';
    while (num > 0) {
        const remainder = (num - 1) % 26;
        letter = String.fromCharCode(65 + remainder) + letter;
        num = Math.floor((num - 1) / 26);
    }
    return letter;
}

// Ensure a sheet tab exists with specified headers
async function ensureSheetTab(tabName, headers) {
    try {
        // Get all sheets
        const sheetInfo = await sheets.spreadsheets.get({
            spreadsheetId: GOOGLE_SHEET_ID
        });
        
        const existingSheet = sheetInfo.data.sheets.find(s => s.properties.title === tabName);
        
        if (!existingSheet) {
            // Create the sheet
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: GOOGLE_SHEET_ID,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: { title: tabName }
                        }
                    }]
                }
            });
        }
        
        // Check if headers exist
        const lastCol = numberToColumnLetter(headers.length);
        const headerRes = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${tabName}!A1:${lastCol}1`
        });
        
        const existingHeaders = headerRes.data.values?.[0] || [];
        
        // Only write headers if they don't exist or are incomplete
        if (existingHeaders.length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `${tabName}!A1:${lastCol}1`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [headers]
                }
            });
        }
    } catch (err) {
        console.error(`Error ensuring sheet tab ${tabName}:`, err);
        throw err;
    }
}

// Find next available row in a tab
async function findNextRowInTab(tabName, column = "A") {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${tabName}!${column}:${column}`
    });
    return (res.data.values || []).length + 1;
}

// Helper to check if user has required roles
function hasRequiredRole(interaction, roleNames) {
    const memberRoles = interaction.member?.roles?.cache;
    if (!memberRoles) return false;
    return roleNames.some(roleName => memberRoles.some(r => r.name === roleName));
}

// Get user's highest role from a list of role names
function getUserHighestRole(interaction, roleNames) {
    const memberRoles = interaction.member?.roles?.cache;
    if (!memberRoles) return null;
    
    for (const roleName of roleNames) {
        if (memberRoles.some(r => r.name === roleName)) {
            return roleName;
        }
    }
    return null;
}

// Check if user has specific role by ID
function hasRoleById(interaction, roleId) {
    const memberRoles = interaction.member?.roles?.cache;
    if (!memberRoles) return false;
    return memberRoles.some(r => r.id === roleId);
}

// ───────────────────────────────────────────────
// COMMAND HANDLER
// ───────────────────────────────────────────────

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // ────────────────
    // /factioninfo
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

            // People (Command Members)
            const people = data
                .filter(r => r[0] && r[0].toLowerCase() === factionRequested)
                .map(r => ({
                    character: r[1] || "N/A",
                    phone: r[2] || "N/A",
                    personalAddress: r[3] || "N/A",
                    leader: r[4]?.toUpperCase() === "TRUE"
                }));

            // Properties
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

            // Remove duplicates
            const uniqueHQs = [...new Set(hqs)];
            const uniqueAddrs = [...new Set(addresses.filter(a => !uniqueHQs.includes(a)))];

            // ────────────────
            // STYLE C EMBED
            // ────────────────

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
                                    .join("\n\n") // ← Adds spacing between characters
                                : "_No command members listed._"
                        )
                        +
                        `\n\n⠀\n` + // ← CLEAN SEPARATION BETWEEN MEMBERS + PROPERTIES
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
    // /addproperty (Management-only, defer reply to avoid timeouts)
    // ────────────────

    if (interaction.commandName === "addproperty") {
        // Role check: only those with role named "Management"
        const memberRoles = interaction.member?.roles?.cache;
        const hasManagement = memberRoles ? memberRoles.some(r => r.name === "Management") : false;

        if (!hasManagement) {
            return interaction.reply({ content: "You do not have permission to run this command. (Requires Management role)", ephemeral: true });
        }

        // Defer reply so long-running sheet writes don't cause a Discord timeout
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (err) {
            // If deferring fails for whatever reason, continue but be aware the command may timeout.
            console.warn("Failed to defer reply:", err);
        }

        const date = interaction.options.getString("date");
        const faction = interaction.options.getString("faction");
        const address = interaction.options.getString("address");
        const type = interaction.options.getString("type");
        const confiscated = interaction.options.getBoolean("confiscated");

        try {
            // PropertyRewards
            const rewardsRow = await findNextRowRewards();
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `PropertyRewards!A${rewardsRow}:E${rewardsRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[date, faction, address, type, confiscated]]
                }
            });

            // Sheet1
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
            // Ensure we respond even on error (edit the deferred reply)
            try {
                return interaction.editReply("There was an error updating the Google Sheet.");
            } catch (e) {
                // Fallback if editReply fails
                return interaction.followUp({ content: "There was an error updating the Google Sheet.", ephemeral: true });
            }
        }
    }

    // ────────────────
    // /listproperties (Management-only)
    // ────────────────

    if (interaction.commandName === "listproperties") {
        // Role check: only those with role named "Management"
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

            // Build lines array
            const lines = data.map(r => {
                const faction = r[1] || "Unknown Faction";
                const address = r[2] || "N/A";
                const type = r[3] || "Property";
                const icon = type === "HQ" ? "🏠" : type === "Warehouse" ? "📦" : "📍";
                return `**${faction}** - ${icon} ${type}: ${address}`;
            });

            // Chunk lines into field-sized chunks
            const fieldValues = chunkLinesToFieldValues(lines, 1024);

            // Create fields objects (use zero-width name so they appear as body)
            const fields = fieldValues.map((v) => ({ name: "⠀", value: v }));

            // Discord limits: max 25 fields per embed, max 10 embeds per message (practical total 250 fields)
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

            // If multiple embeds needed
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

            // Fallback: if we have more than embeds can hold, send as a text attachment instead
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
    // /confiscateproperty (Management-only)
    // ────────────────

    if (interaction.commandName === "confiscateproperty") {
        // Role check: only those with role named "Management"
        const memberRoles = interaction.member?.roles?.cache;
        const hasManagement = memberRoles ? memberRoles.some(r => r.name === "Management") : false;

        if (!hasManagement) {
            return interaction.reply({ content: "You do not have permission to run this command. (Requires Management role)", ephemeral: true });
        }

        // Defer reply to avoid timeouts
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (err) {
            console.warn("Failed to defer reply:", err);
        }

        const dateGivenInput = interaction.options.getString("date"); // kept for context but not used for matching
        const factionInput = interaction.options.getString("faction");
        const addressInput = interaction.options.getString("address");
        const typeInput = interaction.options.getString("type"); // kept for context but not used for matching
        const confiscatedFlag = interaction.options.getBoolean("confiscated");

        // Only proceed if they expressly set confiscated to true
        if (!confiscatedFlag) {
            return interaction.editReply({ content: "No action taken — 'confiscated' was not set to true.", ephemeral: true });
        }

        try {
            // Read PropertyRewards including Date Confiscated (assumed to be column F)
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "PropertyRewards!A1:F999"
            });

            const rows = res.data.values || [];

            // Find matching rows by Faction (col B) and Address (col C), case-insensitive
            const factionNorm = (factionInput || "").trim().toLowerCase();
            const addressNorm = (addressInput || "").trim().toLowerCase();

            const candidates = []; // { index, dateTimestamp, row }
            for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                const rFaction = (r[1] || "").toString().trim().toLowerCase();
                const rAddress = (r[2] || "").toString().trim().toLowerCase();
                if (rFaction === factionNorm && rAddress === addressNorm) {
                    // try to parse date from column A
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

            // Choose candidate with the most recent dateTimestamp; if all zero, choose the last matching row
            candidates.sort((a, b) => {
                if (a.dateTimestamp === b.dateTimestamp) return a.index - b.index;
                return b.dateTimestamp - a.dateTimestamp; // descending
            });

            const chosen = candidates[0];
            const sheetRow = chosen.index + 1; // because rows array is 0-based and header is at index 0

            // Prepare updated row values: A-F (Date Given, Faction, Address, Type, Confiscated, Date Confiscated)
            const existingRow = chosen.row;
            const updatedA = existingRow[0] || dateGivenInput;
            const updatedB = existingRow[1] || factionInput;
            const updatedC = existingRow[2] || addressInput;
            const updatedD = existingRow[3] || typeInput;
            const updatedE = true; // Confiscated = TRUE
            const dateConfiscated = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
            const updatedF = dateConfiscated; // Date Confiscated

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
    // /adddossier (Team Lead OR Management roles required)
    // ────────────────

    if (interaction.commandName === "adddossier") {
        // Role check: must have EITHER "Team Lead" or "Management" roles
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

    // ────────────────────────────────────────────────────────────
    // NEW COMMAND HANDLERS: One-Off Scenes
    // ────────────────────────────────────────────────────────────

    // ────────────────
    // /logscene (Team Leader, Management, OR Team Guide)
    // ────────────────
    if (interaction.commandName === "logscene") {
        if (!hasRequiredRole(interaction, ["Team Leader", "Management", "Team Guide"])) {
            return interaction.reply({ 
                content: "You do not have permission to run this command. (Requires Team Leader, Management, or Team Guide role)", 
                ephemeral: true 
            });
        }

        const sceneName = interaction.options.getString("scene_name");
        const participants = interaction.options.getString("participants");

        try {
            await interaction.deferReply({ ephemeral: true });

            // Ensure the tab exists with updated headers
            await ensureSheetTab("One Off Scenes", [
                "Scene Name", "Meridian or Ped", "Scene Info", "Rewards", "Times Run", "Participants", "Last Run Date"
            ]);

            // Find the scene (now need to fetch all columns A:G)
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "One Off Scenes!A:G"
            });

            const rows = res.data.values || [];
            let sceneRow = -1;

            for (let i = 1; i < rows.length; i++) {
                if (rows[i][0]?.toLowerCase().trim() === sceneName.toLowerCase().trim()) {
                    sceneRow = i + 1; // Sheet rows are 1-indexed
                    break;
                }
            }

            if (sceneRow === -1) {
                return interaction.editReply({ content: `❌ Scene "${sceneName}" not found in the database. Please contact a Team Leader or Management member to add new scenes.` });
            }

            const currentData = rows[sceneRow - 1];
            // Columns: A=Scene Name, B=Meridian/Ped, C=Scene Info, D=Rewards, E=Times Run, F=Participants, G=Last Run Date
            const timesRun = parseInt(currentData[4] || "0") + 1;
            const existingParticipants = currentData[5] || "";
            const newParticipants = existingParticipants 
                ? `${existingParticipants}, ${participants}` 
                : participants;
            
            // Check for cell size limit (Google Sheets limit is ~50,000 chars)
            if (newParticipants.length > 45000) {
                return interaction.editReply({ 
                    content: `❌ Cannot log scene: participant list is too long. Consider archiving old participants.` 
                });
            }
            
            const lastRunDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

            // Update the row (preserve existing values for columns A-D)
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `One Off Scenes!A${sceneRow}:G${sceneRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[
                        currentData[0] || sceneName,  // Scene Name
                        currentData[1] || "",          // Meridian or Ped
                        currentData[2] || "",          // Scene Info
                        currentData[3] || "",          // Rewards
                        timesRun,                      // Times Run
                        newParticipants,               // Participants
                        lastRunDate                    // Last Run Date
                    ]]
                }
            });

            return interaction.editReply({ 
                content: `✅ Scene "${sceneName}" logged successfully.\n• Times Run: ${timesRun}\n• Last Run: ${lastRunDate}` 
            });

        } catch (err) {
            console.error("LOGSCENE ERROR:", err);
            try {
                return interaction.editReply({ content: "There was an error updating the Google Sheet." });
            } catch (e) {
                return interaction.followUp({ content: "There was an error updating the Google Sheet.", ephemeral: true });
            }
        }
    }

    // ────────────────
    // /scenecount (Public access)
    // ────────────────
    if (interaction.commandName === "scenecount") {
        const faction = interaction.options.getString("faction");

        try {
            // Check if tab exists
            const sheetInfo = await sheets.spreadsheets.get({
                spreadsheetId: GOOGLE_SHEET_ID
            });
            
            const tabExists = sheetInfo.data.sheets.some(s => s.properties.title === "One Off Scenes");
            
            if (!tabExists) {
                const embedEmpty = new EmbedBuilder()
                    .setColor(0x2b6cb0)
                    .setTitle(
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `📊  **SCENE COUNT**\n` +
                        `**Faction: ${faction}**\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                    )
                    .addFields({ name: "⠀", value: "_No scenes found._" });

                return interaction.reply({ embeds: [embedEmpty] });
            }

            // Get all scene data
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "One Off Scenes!A:G"
            });

            const rows = res.data.values || [];
            const factionLower = faction.toLowerCase().trim();
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            
            // Map to store scene counts
            const sceneCounts = new Map();

            // Process all scenes
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const sceneName = row[0] || "Unknown Scene";
                const participants = row[5] || ""; // Column F
                const lastRunDate = row[6] || ""; // Column G
                
                // Check if scene was run in last 90 days (skip if older than 90 days)
                if (lastRunDate) {
                    const runDate = new Date(lastRunDate);
                    if (!isNaN(runDate.getTime()) && runDate < ninetyDaysAgo) {
                        // Scene was last run more than 90 days ago, skip it
                        continue;
                    }
                } else {
                    // No last run date recorded, skip this scene
                    continue;
                }
                
                // Parse participants and count faction occurrences
                const participantList = participants.split(',').map(p => p.trim().toLowerCase());
                const factionCount = participantList.filter(p => p === factionLower).length;
                
                if (factionCount > 0) {
                    // Get total times run for this scene (column E)
                    const totalTimesRun = parseInt(row[4] || "0");
                    sceneCounts.set(sceneName, {
                        factionRuns: factionCount,
                        totalRuns: totalTimesRun
                    });
                }
            }

            if (sceneCounts.size === 0) {
                const embedEmpty = new EmbedBuilder()
                    .setColor(0x2b6cb0)
                    .setTitle(
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `📊  **SCENE COUNT**\n` +
                        `**Faction: ${faction}**\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                    )
                    .addFields({ name: "⠀", value: "_No scenes found for this faction in the last 90 days._" });

                return interaction.reply({ embeds: [embedEmpty] });
            }

            // Build scene list
            const lines = [];
            for (const [sceneName, counts] of sceneCounts.entries()) {
                lines.push(`**${sceneName}**\n• Faction Runs: ${counts.factionRuns}\n• Total Runs: ${counts.totalRuns}`);
            }

            // Chunk into fields
            const fieldValues = chunkLinesToFieldValues(lines, 1024);
            const fields = fieldValues.map(v => ({ name: "⠀", value: v }));

            const embed = new EmbedBuilder()
                .setColor(0x2b6cb0)
                .setTitle(
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📊  **SCENE COUNT**\n` +
                    `**Faction: ${faction}**\n` +
                    `**Last 90 Days**\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                )
                .addFields(fields);

            return interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error("SCENECOUNT ERROR:", err);
            return interaction.reply({ 
                content: "There was an error accessing the Google Sheet.", 
                ephemeral: true 
            });
        }
    }

    // ────────────────────────────────────────────────────────────
    // NEW COMMAND HANDLERS: Notable Interactions
    // ────────────────────────────────────────────────────────────

    // ────────────────
    // /addnote (Team Leader, Management, OR Team Guide)
    // ────────────────
    if (interaction.commandName === "addnote") {
        if (!hasRequiredRole(interaction, ["Team Leader", "Management", "Team Guide"])) {
            return interaction.reply({ 
                content: "You do not have permission to run this command. (Requires Team Leader, Management, or Team Guide role)", 
                ephemeral: true 
            });
        }

        const faction = interaction.options.getString("faction");
        const note = interaction.options.getString("note");
        const createdBy = interaction.user.username;
        const createdOn = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        try {
            await interaction.deferReply({ ephemeral: true });

            // Ensure the tab exists
            await ensureSheetTab("Notable Interactions", ["Faction", "Note", "Created By", "Created On"]);

            // Add the note
            const nextRow = await findNextRowInTab("Notable Interactions", "A");
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Notable Interactions!A${nextRow}:D${nextRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[faction, note, createdBy, createdOn]]
                }
            });

            return interaction.editReply({ content: `✅ Note added for faction "${faction}".` });

        } catch (err) {
            console.error("ADDNOTE ERROR:", err);
            try {
                return interaction.editReply({ content: "There was an error updating the Google Sheet." });
            } catch (e) {
                return interaction.followUp({ content: "There was an error updating the Google Sheet.", ephemeral: true });
            }
        }
    }

    // ────────────────
    // /getnotes (Public access)
    // ────────────────
    if (interaction.commandName === "getnotes") {
        const faction = interaction.options.getString("faction");
        const showAll = interaction.options.getBoolean("all") || false;

        try {
            // Check if tab exists
            const sheetInfo = await sheets.spreadsheets.get({
                spreadsheetId: GOOGLE_SHEET_ID
            });
            
            const tabExists = sheetInfo.data.sheets.some(s => s.properties.title === "Notable Interactions");
            
            if (!tabExists) {
                const embedEmpty = new EmbedBuilder()
                    .setColor(0x2b6cb0)
                    .setTitle(
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `📝  **NOTABLE INTERACTIONS**\n` +
                        `**Faction: ${faction}**\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                    )
                    .addFields({ name: "⠀", value: "_No notes found._" });

                return interaction.reply({ embeds: [embedEmpty] });
            }

            // Get notes
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Notable Interactions!A:D"
            });

            const rows = res.data.values || [];
            const factionLower = faction.toLowerCase().trim();
            
            // Filter notes for the faction
            let notes = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                // Check if row has data and faction matches
                if (row && row.length > 0 && row[0]?.toLowerCase().trim() === factionLower) {
                    notes.push({
                        note: row[1] || "N/A",
                        createdBy: row[2] || "Unknown",
                        createdOn: row[3] || "Unknown"
                    });
                }
            }

            // Filter by date if not showing all
            if (!showAll) {
                const today = new Date();
                today.setHours(0, 0, 0, 0); // Start of today
                const thirtyDaysAgo = new Date(today);
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                
                notes = notes.filter(n => {
                    // Skip notes with no valid date
                    if (!n.createdOn || n.createdOn === "Unknown") {
                        return false;
                    }
                    // Parse the date and normalize to midnight
                    const noteDate = new Date(n.createdOn);
                    if (isNaN(noteDate.getTime())) {
                        return false;
                    }
                    noteDate.setHours(0, 0, 0, 0);
                    // Compare dates (both are now at midnight)
                    return noteDate >= thirtyDaysAgo;
                });
            }

            if (notes.length === 0) {
                const embedEmpty = new EmbedBuilder()
                    .setColor(0x2b6cb0)
                    .setTitle(
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `📝  **NOTABLE INTERACTIONS**\n` +
                        `**Faction: ${faction}**\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                    )
                    .addFields({ name: "⠀", value: showAll ? "_No notes found._" : "_No notes found in the last 30 days._" });

                return interaction.reply({ embeds: [embedEmpty] });
            }

            // Build note lines with clear separation (⠀ = zero-width space for visual spacing)
            const lines = notes.map(n => 
                `**${n.createdOn}** by ${n.createdBy}\n${n.note}\n⠀`
            );

            // Chunk into fields
            const fieldValues = chunkLinesToFieldValues(lines, 1024);
            const fields = fieldValues.map(v => ({ name: "⠀", value: v }));

            const embed = new EmbedBuilder()
                .setColor(0x2b6cb0)
                .setTitle(
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📝  **NOTABLE INTERACTIONS**\n` +
                    `**Faction: ${faction}**\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                )
                .addFields(fields);

            return interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error("GETNOTES ERROR:", err);
            return interaction.reply({ content: "There was an error accessing the Google Sheet." });
        }
    }

    // ────────────────────────────────────────────────────────────
    // NEW COMMAND HANDLERS: Reminders
    // ────────────────────────────────────────────────────────────

    // ────────────────
    // /setreminder ([ECRP] Faction Management only)
    // ────────────────
    if (interaction.commandName === "setreminder") {
        if (!hasRoleById(interaction, FACTION_MANAGEMENT_ROLE_ID)) {
            return interaction.reply({ 
                content: "You do not have permission to run this command. (Requires [ECRP] Faction Management role)", 
                ephemeral: true 
            });
        }

        const text = interaction.options.getString("text");
        const time = interaction.options.getString("time");
        const date = interaction.options.getString("date");
        const channel = interaction.options.getChannel("channel");
        const notificationRole = interaction.options.getRole("notification_role");
        const targetType = interaction.options.getString("target_type");
        const targetValue = interaction.options.getString("target_value");
        const recurrence = interaction.options.getString("recurrence") || "none";
        const timezone = interaction.options.getString("timezone") || "UTC";
        const visibility = interaction.options.getString("visibility") || "private";
        const creator = interaction.user.username;
        // Get the [ECRP] Faction Management role name if user has it
        const memberRoles = interaction.member?.roles?.cache;
        const factionMgmtRole = memberRoles?.find(r => r.id === FACTION_MANAGEMENT_ROLE_ID);
        const creatorRole = factionMgmtRole ? factionMgmtRole.name : "Unknown";
        
        // Store channel ID and name
        const channelId = channel.id;
        const channelName = channel.name;
        
        // Store notification role ID and name (if provided)
        const notificationRoleId = notificationRole ? notificationRole.id : "";
        const notificationRoleName = notificationRole ? notificationRole.name : "";

        try {
            await interaction.deferReply({ ephemeral: true });

            // Validate time format (HH:MM)
            const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
            if (!timeRegex.test(time)) {
                return interaction.editReply({ content: "❌ Invalid time format. Use HH:MM (24-hour format)." });
            }

            // Validate date format (YYYY-MM-DD) and check if it's a valid date
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(date)) {
                return interaction.editReply({ content: "❌ Invalid date format. Use YYYY-MM-DD." });
            }
            
            const parsedDate = new Date(date);
            if (isNaN(parsedDate.getTime())) {
                return interaction.editReply({ content: "❌ Invalid date. Please provide a valid date." });
            }

            // Validate timezone
            if (!isValidTimezone(timezone)) {
                return interaction.editReply({ content: "❌ Invalid timezone. Please use a valid IANA timezone (e.g., America/New_York, Europe/London, UTC)." });
            }

            // Convert to UTC for storage
            const utcConversion = convertToUTC(date, time, timezone);
            if (!utcConversion) {
                return interaction.editReply({ content: "❌ Error converting time to UTC. Please check your date/time values." });
            }

            // Ensure the tab exists with updated headers including UTC columns, channel, and notification role
            await ensureSheetTab("Reminders", REMINDER_SHEET_HEADERS);

            // Add the reminder with UTC conversion, target information, channel, and notification role
            // Status: "active" for new reminders
            const nextRow = await findNextRowInTab("Reminders", "A");
            const lastCol = getReminderSheetLastColumn();
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Reminders!A${nextRow}:${lastCol}${nextRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[text, time, date, timezone, utcConversion.utcTime, utcConversion.utcDate, recurrence, creator, creatorRole, visibility, targetType, targetValue, "active", channelId, channelName, notificationRoleId, notificationRoleName]]
                }
            });

            const notificationRoleText = notificationRoleName ? `\n**Notification Role:** ${notificationRoleName}` : "";

            return interaction.editReply({ 
                content: `✅ Reminder set!\n\n` +
                         `**Your Time:** ${date} at ${time} (${timezone})\n` +
                         `**UTC Time:** ${utcConversion.utcDate} at ${utcConversion.utcTime}\n` +
                         `**Channel:** #${channelName}\n` +
                         `**Target:** ${targetType} - ${targetValue}${notificationRoleText}\n` +
                         `**Visibility:** ${visibility}\n` +
                         `**Recurrence:** ${recurrence}\n\n` +
                         `⏰ Pings will be sent 30 minutes before and at the event time.` 
            });

        } catch (err) {
            console.error("SETREMINDER ERROR:", err);
            try {
                return interaction.editReply({ content: "There was an error updating the Google Sheet." });
            } catch (e) {
                return interaction.followUp({ content: "There was an error updating the Google Sheet.", ephemeral: true });
            }
        }
    }

    // ────────────────
    // /listreminders ([ECRP] Faction Management only)
    // ────────────────
    if (interaction.commandName === "listreminders") {
        if (!hasRoleById(interaction, FACTION_MANAGEMENT_ROLE_ID)) {
            return interaction.reply({ 
                content: "You do not have permission to run this command. (Requires [ECRP] Faction Management role)", 
                ephemeral: true 
            });
        }

        const username = interaction.user.username;
        const memberRoles = interaction.member?.roles?.cache;
        const factionMgmtRole = memberRoles?.find(r => r.id === FACTION_MANAGEMENT_ROLE_ID);
        const userRole = factionMgmtRole ? factionMgmtRole.name : null;
        
        // Get all user's roles
        const userRoleNames = memberRoles ? Array.from(memberRoles.values()).map(r => r.name) : [];

        try {
            // Check if tab exists
            const sheetInfo = await sheets.spreadsheets.get({
                spreadsheetId: GOOGLE_SHEET_ID
            });
            
            const tabExists = sheetInfo.data.sheets.some(s => s.properties.title === "Reminders");
            
            if (!tabExists) {
                const embedEmpty = new EmbedBuilder()
                    .setColor(0x2b6cb0)
                    .setTitle(
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `⏰  **REMINDERS**\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                    )
                    .addFields({ name: "⠀", value: "_No reminders found._" });

                return interaction.reply({ embeds: [embedEmpty], ephemeral: true });
            }

            // Get reminders - now includes UTC columns, status, channel, and notification role
            const lastCol = getReminderSheetLastColumn();
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Reminders!A:${lastCol}`
            });

            const rows = res.data.values || [];
            
            // Filter reminders based on visibility rules AND target
            let reminders = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const reminderText = row[0] || "N/A";
                const inputTime = row[1] || "N/A";
                const inputDate = row[2] || "N/A";
                const inputTimezone = row[3] || "UTC";
                const utcTime = row[4] || inputTime; // Fallback for backwards compatibility
                const utcDate = row[5] || inputDate; // Fallback for backwards compatibility
                const recurrence = row[6] || "none";
                const creator = row[7] || "Unknown";
                const creatorRole = row[8] || "Unknown";
                const visibility = row[9] || "private";
                const targetType = row[10] || "user"; // Default to user for backwards compatibility
                const targetValue = row[11] || "";
                const status = row[12] || "active"; // Default to active
                const channelId = row[13] || "";
                const channelName = row[14] || "";
                const notificationRoleId = row[15] || "";
                const notificationRoleName = row[16] || "";

                // Skip completed reminders (unless they're recurring)
                if (status === "completed" && recurrence === "none") {
                    continue;
                }

                // Check if user matches target
                const isTargeted = (targetType === "user" && targetValue.toLowerCase() === username.toLowerCase()) ||
                                   (targetType === "role" && userRoleNames.some(r => r.toLowerCase() === targetValue.toLowerCase()));

                // Visibility rules (original logic)
                const isCreator = creator === username;
                const isSameRole = userRole && creatorRole === userRole;
                const isPublic = visibility === "public";
                const isRoleVisible = visibility === "role" && isSameRole;
                const isPrivateVisible = visibility === "private" && isCreator;

                // Show reminder if user is targeted OR visibility rules allow
                if (isTargeted || isPublic || isRoleVisible || isPrivateVisible) {
                    // Convert UTC time to user's local timezone (use input timezone as preference)
                    const displayTime = convertFromUTC(utcDate, utcTime, inputTimezone);
                    
                    reminders.push({
                        text: reminderText,
                        displayDate: displayTime ? displayTime.date : inputDate,
                        displayTime: displayTime ? displayTime.time : inputTime,
                        timezone: inputTimezone,
                        utcDate,
                        utcTime,
                        recurrence,
                        creator,
                        visibility,
                        targetType,
                        targetValue,
                        status,
                        channelName,
                        notificationRoleName
                    });
                }
            }

            if (reminders.length === 0) {
                const embedEmpty = new EmbedBuilder()
                    .setColor(0x2b6cb0)
                    .setTitle(
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `⏰  **REMINDERS**\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                    )
                    .addFields({ name: "⠀", value: "_No reminders found._" });

                return interaction.reply({ embeds: [embedEmpty], ephemeral: true });
            }

            // Build reminder lines with target, channel, and notification role information
            const lines = reminders.map(r => {
                const recurrenceText = r.recurrence !== "none" ? ` (${r.recurrence})` : "";
                const statusText = r.status === "completed" ? " [COMPLETED]" : "";
                const targetInfo = r.targetType && r.targetValue ? `\n🎯 Target: ${r.targetType} - ${r.targetValue}` : "";
                const channelInfo = r.channelName ? `\n📢 Channel: #${r.channelName}` : "";
                const roleInfo = r.notificationRoleName ? `\n👥 Notification Role: ${r.notificationRoleName}` : "";
                return `**${r.displayDate}** at ${r.displayTime} (${r.timezone})${recurrenceText}${statusText}\n${r.text}${targetInfo}${channelInfo}${roleInfo}\n_UTC: ${r.utcDate} ${r.utcTime} | Created by: ${r.creator} | Visibility: ${r.visibility}_`;
            });

            // Chunk into fields
            const fieldValues = chunkLinesToFieldValues(lines, 1024);
            const fields = fieldValues.map(v => ({ name: "⠀", value: v }));

            const embed = new EmbedBuilder()
                .setColor(0x2b6cb0)
                .setTitle(
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `⏰  **REMINDERS**\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                )
                .addFields(fields);

            return interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (err) {
            console.error("LISTREMINDERS ERROR:", err);
            return interaction.reply({ 
                content: "There was an error accessing the Google Sheet.", 
                ephemeral: true 
            });
        }
    }

    // ────────────────────────────────────────────────────────────
    // HELP COMMAND
    // ────────────────────────────────────────────────────────────

    if (interaction.commandName === "help") {
        const embed = new EmbedBuilder()
            .setColor(0x2b6cb0)
            .setTitle(
                `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `📚  **MERIDIAN BOT COMMANDS**\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`
            )
            .addFields(
                {
                    name: "📋 **Faction Information**",
                    value: 
                        `**\`/factioninfo\`** - Look up faction details\n` +
                        `• Roles: Everyone\n` +
                        `• Example: \`/factioninfo faction:Los Santos Police\`\n` +
                        `• Shows command members, properties, and HQ locations\n⠀`
                },
                {
                    name: "🏠 **Property Management**",
                    value: 
                        `**\`/addproperty\`** - Add a property reward\n` +
                        `• Roles: Management\n` +
                        `• Example: \`/addproperty date:2024-01-15 faction:LSPD address:123 Main St type:HQ\`\n⠀\n` +
                        `**\`/listproperties\`** - List all recorded properties\n` +
                        `• Roles: Management\n⠀\n` +
                        `**\`/confiscateproperty\`** - Mark property as confiscated\n` +
                        `• Roles: Management\n` +
                        `• Example: \`/confiscateproperty faction:LSPD address:123 Main St\`\n⠀`
                },
                {
                    name: "📝 **Dossiers**",
                    value: 
                        `**\`/adddossier person\`** - Add a person to database\n` +
                        `• Roles: Team Lead, Management\n` +
                        `• Example: \`/adddossier person faction:LSPD character:John Doe\`\n⠀\n` +
                        `**\`/adddossier location\`** - Add a location to database\n` +
                        `• Roles: Team Lead, Management\n` +
                        `• Example: \`/adddossier location faction:LSPD address:HQ Building\`\n⠀`
                },
                {
                    name: "🎭 **One-Off Scenes**",
                    value: 
                        `**\`/logscene\`** - Log a scene execution\n` +
                        `• Roles: Team Leader, Management, Team Guide\n` +
                        `• Example: \`/logscene scene_name:Bank Heist participants:LSPD, EMS\`\n⠀\n` +
                        `**\`/scenecount\`** - View faction's scene history\n` +
                        `• Roles: Everyone\n` +
                        `• Example: \`/scenecount faction:LSPD\`\n` +
                        `• Shows all scenes from last 90 days with run counts\n⠀`
                },
                {
                    name: "💬 **Notable Interactions**",
                    value: 
                        `**\`/addnote\`** - Log a notable interaction\n` +
                        `• Roles: Team Leader, Management, Team Guide\n` +
                        `• Example: \`/addnote faction:LSPD note:Major drug bust\`\n⠀\n` +
                        `**\`/getnotes\`** - View faction notes\n` +
                        `• Roles: Everyone\n` +
                        `• Example: \`/getnotes faction:LSPD all:true\`\n` +
                        `• Default shows last 30 days, use \`all:true\` for full history\n⠀`
                },
                {
                    name: "⏰ **Reminders**",
                    value: 
                        `**\`/setreminder\`** - Create a reminder\n` +
                        `• Roles: [ECRP] Faction Management\n` +
                        `• Example: \`/setreminder text:Meeting time:14:00 date:2024-01-20 channel:#general target_type:user target_value:JohnDoe\`\n` +
                        `• Select channel where reminder will be posted (dropdown of all accessible channels)\n` +
                        `• Optionally select a notification role to mention (in addition to target)\n` +
                        `• Select target (user or role) to specify who receives pings\n` +
                        `• Pings sent 30 minutes before and at event time\n` +
                        `• Supports one-time or recurring (daily/weekly/monthly)\n⠀\n` +
                        `**\`/listreminders\`** - View your reminders\n` +
                        `• Roles: [ECRP] Faction Management\n` +
                        `• Shows reminders targeting you or your roles\n` +
                        `• Also shows reminders based on visibility (private/role/public)\n` +
                        `• Displays channel and notification role for each reminder\n⠀`
                },
                {
                    name: "ℹ️ **Help**",
                    value: 
                        `**\`/help\`** - Display this help message\n` +
                        `• Roles: Everyone\n⠀`
                }
            )
            .setFooter({ text: "Need assistance? Contact a Team Leader or Management member." });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// ───────────────────────────────────────────────
// REMINDER NOTIFICATION SYSTEM
// ───────────────────────────────────────────────

// Constants for reminder notifications
const NOTIFICATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes window to catch notifications
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const NOTIFICATION_CLEANUP_SIZE = 1000;

// Track which reminders have been notified (to prevent duplicate pings)
const notifiedReminders = new Map(); // Map of reminderKey -> timestamp

// Helper to resolve target mentions
async function resolveTargetMention(guild, targetType, targetValue) {
    try {
        if (targetType === "user") {
            // Try to find user by username
            const members = await guild.members.fetch();
            const member = members.find(m => m.user.username.toLowerCase() === targetValue.toLowerCase());
            return member ? `<@${member.id}>` : `@${targetValue}`;
        } else if (targetType === "role") {
            // Try to find role by name
            const role = guild.roles.cache.find(r => r.name.toLowerCase() === targetValue.toLowerCase());
            return role ? `<@&${role.id}>` : `@${targetValue}`;
        }
    } catch (err) {
        console.error("Error resolving target mention:", err);
    }
    return `@${targetValue}`;
}

// Helper to get the reminder notification channel (uses first available text channel)
async function getNotificationChannel(client) {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channels = await guild.channels.fetch();
        
        // Fetch the bot's member object
        await guild.members.fetch(client.user.id);
        
        // Find first text channel the bot can send messages to
        const textChannel = channels.find(ch => {
            if (!ch.isTextBased() || ch.isVoiceBased()) return false;
            
            const botMember = guild.members.me;
            if (!botMember) return false;
            
            return ch.permissionsFor(botMember).has(PermissionFlagsBits.SendMessages);
        });
        
        return textChannel;
    } catch (err) {
        console.error("Error getting notification channel:", err);
        return null;
    }
}

// Check reminders and send notifications
async function checkReminders() {
    try {
        // Get all active reminders - including new channel and notification role columns
        const lastCol = getReminderSheetLastColumn();
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `Reminders!A:${lastCol}`
        });

        const rows = res.data.values || [];
        if (rows.length <= 1) return; // No reminders (only header)

        const now = DateTime.now().setZone("UTC");
        const nowTimestamp = now.toMillis();
        
        // Fetch guild once for all reminders
        const guild = await client.guilds.fetch(GUILD_ID);

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const reminderText = row[0] || "";
            const utcTime = row[4];
            const utcDate = row[5];
            const recurrence = row[6] || "none";
            const targetType = row[10] || "user";
            const targetValue = row[11] || "";
            const status = row[12] || "active";
            const channelId = row[13] || "";
            const channelName = row[14] || "";
            const notificationRoleId = row[15] || "";
            const notificationRoleName = row[16] || "";

            // Skip inactive or completed non-recurring reminders
            if (status !== "active") continue;
            if (!utcDate || !utcTime) continue;

            // Parse the UTC datetime
            const reminderDt = DateTime.fromFormat(`${utcDate} ${utcTime}`, "yyyy-MM-dd HH:mm", { zone: "UTC" });
            if (!reminderDt.isValid) continue;

            const reminderTimestamp = reminderDt.toMillis();
            const thirtyMinsBefore = reminderTimestamp - THIRTY_MINUTES_MS;

            // Create unique key for this reminder instance
            const reminderKey = `${i}_${utcDate}_${utcTime}`;
            const thirtyMinsKey = `${reminderKey}_30mins`;

            // Check if it's time to send notification
            const shouldNotifyNow = nowTimestamp >= reminderTimestamp && nowTimestamp < reminderTimestamp + NOTIFICATION_WINDOW_MS;
            const shouldNotify30Mins = nowTimestamp >= thirtyMinsBefore && nowTimestamp < thirtyMinsBefore + NOTIFICATION_WINDOW_MS;

            // Get the specified channel or fallback to default
            let channel = null;
            
            if (channelId) {
                try {
                    channel = await guild.channels.fetch(channelId);
                    // Verify bot can send messages in this channel
                    const botMember = guild.members.me;
                    if (channel && botMember && !channel.permissionsFor(botMember).has(PermissionFlagsBits.SendMessages)) {
                        console.warn(`Bot lacks permission to send in channel ${channelName}, using fallback`);
                        channel = null;
                    }
                } catch (err) {
                    console.warn(`Failed to fetch channel ${channelId} (${channelName}), using fallback:`, err.message);
                    channel = null;
                }
            }
            
            // Fallback to default channel if specified channel not available
            if (!channel) {
                channel = await getNotificationChannel(client);
            }
            
            if (!channel) {
                console.error("No notification channel available");
                continue;
            }

            const mention = await resolveTargetMention(guild, targetType, targetValue);
            
            // Build notification role mention if provided
            let notificationRoleMention = "";
            if (notificationRoleId) {
                try {
                    const role = await guild.roles.fetch(notificationRoleId);
                    if (role) {
                        // Include leading space to separate this mention from the target mention
                        notificationRoleMention = ` <@&${notificationRoleId}>`;
                    } else {
                        // Role no longer exists, log warning and skip mention
                        console.warn(`Notification role ${notificationRoleId} (${notificationRoleName}) no longer exists`);
                    }
                } catch (err) {
                    console.warn(`Failed to fetch notification role ${notificationRoleId} (${notificationRoleName}):`, err.message);
                }
            }

            // Send 30-minute warning
            if (shouldNotify30Mins && !notifiedReminders.has(thirtyMinsKey)) {
                const embed = new EmbedBuilder()
                    .setColor(0xffa500)
                    .setTitle("⏰ Reminder - 30 Minutes")
                    .setDescription(`${mention}${notificationRoleMention}\n\n${reminderText}`)
                    .setFooter({ text: `Scheduled for ${reminderDt.toFormat("yyyy-MM-dd HH:mm")} UTC` });

                await channel.send({ embeds: [embed] });
                notifiedReminders.set(thirtyMinsKey, nowTimestamp);
                console.log(`Sent 30-min warning for reminder: ${reminderText}`);
            }

            // Send main notification
            if (shouldNotifyNow && !notifiedReminders.has(reminderKey)) {
                const embed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle("🔔 Reminder - NOW")
                    .setDescription(`${mention}${notificationRoleMention}\n\n${reminderText}`)
                    .setFooter({ text: `Scheduled for ${reminderDt.toFormat("yyyy-MM-dd HH:mm")} UTC` });

                await channel.send({ embeds: [embed] });
                notifiedReminders.set(reminderKey, nowTimestamp);
                console.log(`Sent notification for reminder: ${reminderText}`);

                // Handle recurrence or mark as completed
                if (recurrence === "none") {
                    // Mark as completed
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        range: `Reminders!M${i + 1}`,
                        valueInputOption: "USER_ENTERED",
                        requestBody: {
                            values: [["completed"]]
                        }
                    });
                } else {
                    // Calculate next occurrence
                    let nextDt = reminderDt;
                    if (recurrence === "daily") {
                        nextDt = reminderDt.plus({ days: 1 });
                    } else if (recurrence === "weekly") {
                        nextDt = reminderDt.plus({ weeks: 1 });
                    } else if (recurrence === "monthly") {
                        nextDt = reminderDt.plus({ months: 1 });
                    }

                    // Update the UTC date for next occurrence
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        range: `Reminders!F${i + 1}`,
                        valueInputOption: "USER_ENTERED",
                        requestBody: {
                            values: [[nextDt.toFormat("yyyy-MM-dd")]]
                        }
                    });

                    console.log(`Updated recurring reminder to next occurrence: ${nextDt.toFormat("yyyy-MM-dd")}`);
                }
            }
        }

        // Clean up old notification keys (older than 24 hours)
        const oneDayAgo = nowTimestamp - (24 * 60 * 60 * 1000);
        
        // Remove entries older than 24 hours
        for (const [key, timestamp] of notifiedReminders.entries()) {
            if (timestamp < oneDayAgo) {
                notifiedReminders.delete(key);
            }
        }
        
        // If map still too large, clear oldest entries
        if (notifiedReminders.size > NOTIFICATION_CLEANUP_SIZE) {
            const entries = Array.from(notifiedReminders.entries())
                .sort((a, b) => a[1] - b[1]); // Sort by timestamp
            
            // Keep only the most recent half
            const toKeep = entries.slice(entries.length / 2);
            notifiedReminders.clear();
            toKeep.forEach(([key, timestamp]) => notifiedReminders.set(key, timestamp));
            
            console.log(`Cleaned up notification cache: kept ${notifiedReminders.size} recent entries`);
        }

    } catch (err) {
        console.error("Error checking reminders:", err);
    }
}

// ───────────────────────────────────────────────
// START BOT
// ───────────────────────────────────────────────

deployCommands();
client.login(DISCORD_TOKEN);
