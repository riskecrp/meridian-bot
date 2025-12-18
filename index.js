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

const addSceneCmd = new SlashCommandBuilder()
    .setName("addscene")
    .setDescription("Add a new one-off scene to the database.")
    .addStringOption(o =>
        o.setName("scene_name")
            .setDescription("Name of the scene")
            .setRequired(true)
    )
    .addStringOption(o =>
        o.setName("meridian_or_ped")
            .setDescription("Meridian or Ped")
            .setRequired(true)
            .addChoices(
                { name: "Meridian", value: "Meridian" },
                { name: "Ped", value: "Ped" }
            )
    )
    .addStringOption(o =>
        o.setName("scene_info")
            .setDescription("Scene information/description")
            .setRequired(true)
    )
    .addStringOption(o =>
        o.setName("rewards")
            .setDescription("Rewards for the scene")
            .setRequired(true)
    );

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
                    addSceneCmd.toJSON(),
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
    // /addscene (Team Leader OR Management)
    // ────────────────
    if (interaction.commandName === "addscene") {
        if (!hasRequiredRole(interaction, ["Team Leader", "Management"])) {
            return interaction.reply({ 
                content: "You do not have permission to run this command. (Requires Team Leader or Management role)", 
                ephemeral: true 
            });
        }

        const sceneName = interaction.options.getString("scene_name");
        const meridianOrPed = interaction.options.getString("meridian_or_ped");
        const sceneInfo = interaction.options.getString("scene_info");
        const rewards = interaction.options.getString("rewards");

        try {
            await interaction.deferReply({ ephemeral: true });

            // Ensure the tab exists with updated headers
            await ensureSheetTab("One Off Scenes", [
                "Scene Name", "Meridian or Ped", "Scene Info", "Rewards", "Times Run", "Participants", "Last Run Date"
            ]);

            // Check for duplicates
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "One Off Scenes!A:A"
            });

            const existingScenes = (res.data.values || []).slice(1).map(row => row[0]?.toLowerCase().trim());
            
            if (existingScenes.includes(sceneName.toLowerCase().trim())) {
                return interaction.editReply({ content: `❌ Scene "${sceneName}" already exists.` });
            }

            // Add the scene with new fields
            const nextRow = await findNextRowInTab("One Off Scenes", "A");
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `One Off Scenes!A${nextRow}:G${nextRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[sceneName, meridianOrPed, sceneInfo, rewards, 0, "", ""]]
                }
            });

            // Refresh scene cache
            await loadScenes();

            return interaction.editReply({ content: `✅ Scene "${sceneName}" added successfully.` });

        } catch (err) {
            console.error("ADDSCENE ERROR:", err);
            try {
                return interaction.editReply({ content: "There was an error updating the Google Sheet." });
            } catch (e) {
                return interaction.followUp({ content: "There was an error updating the Google Sheet.", ephemeral: true });
            }
        }
    }

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
                return interaction.editReply({ content: `❌ Scene "${sceneName}" not found. Use /addscene to create it first.` });
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
                    // Parse the date (YYYY-MM-DD format)
                    const noteDate = new Date(n.createdOn + 'T00:00:00');
                    if (isNaN(noteDate.getTime())) {
                        return false;
                    }
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
    // /setreminder (Team Leader, Management, OR Team Guide)
    // ────────────────
    if (interaction.commandName === "setreminder") {
        if (!hasRequiredRole(interaction, ["Team Leader", "Management", "Team Guide"])) {
            return interaction.reply({ 
                content: "You do not have permission to run this command. (Requires Team Leader, Management, or Team Guide role)", 
                ephemeral: true 
            });
        }

        const text = interaction.options.getString("text");
        const time = interaction.options.getString("time");
        const date = interaction.options.getString("date");
        const recurrence = interaction.options.getString("recurrence") || "none";
        const timezone = interaction.options.getString("timezone") || "UTC";
        const visibility = interaction.options.getString("visibility") || "private";
        const creator = interaction.user.username;
        const creatorRole = getUserHighestRole(interaction, ["Management", "Team Leader", "Team Guide"]) || "Unknown";

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

            // Ensure the tab exists
            await ensureSheetTab("Reminders", [
                "Reminder Text", "Time", "Date", "Recurrence", "Creator", "Creator Role", "Timezone", "Visibility"
            ]);

            // Add the reminder
            const nextRow = await findNextRowInTab("Reminders", "A");
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Reminders!A${nextRow}:H${nextRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[text, time, date, recurrence, creator, creatorRole, timezone, visibility]]
                }
            });

            return interaction.editReply({ 
                content: `✅ Reminder set for ${date} at ${time} (${timezone}).\nVisibility: ${visibility}` 
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
    // /listreminders (Public access with visibility rules)
    // ────────────────
    if (interaction.commandName === "listreminders") {
        const username = interaction.user.username;
        const userRole = getUserHighestRole(interaction, ["Management", "Team Leader", "Team Guide"]);

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

            // Get reminders
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Reminders!A:H"
            });

            const rows = res.data.values || [];
            
            // Filter reminders based on visibility rules
            let reminders = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const reminderText = row[0] || "N/A";
                const time = row[1] || "N/A";
                const date = row[2] || "N/A";
                const recurrence = row[3] || "none";
                const creator = row[4] || "Unknown";
                const creatorRole = row[5] || "Unknown";
                const timezone = row[6] || "UTC";
                const visibility = row[7] || "private";

                // Visibility rules
                const isCreator = creator === username;
                const isSameRole = userRole && creatorRole === userRole;
                const isPublic = visibility === "public";
                const isRoleVisible = visibility === "role" && isSameRole;
                const isPrivateVisible = visibility === "private" && isCreator;

                if (isPublic || isRoleVisible || isPrivateVisible) {
                    reminders.push({
                        text: reminderText,
                        time,
                        date,
                        recurrence,
                        creator,
                        timezone,
                        visibility
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

            // Build reminder lines
            const lines = reminders.map(r => {
                const recurrenceText = r.recurrence !== "none" ? ` (${r.recurrence})` : "";
                return `**${r.date}** at ${r.time} ${r.timezone}${recurrenceText}\n${r.text}\n_Created by: ${r.creator} | Visibility: ${r.visibility}_`;
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
                        `**\`/addscene\`** - Create a new scene\n` +
                        `• Roles: Team Leader, Management\n` +
                        `• Example: \`/addscene scene_name:Bank Heist meridian_or_ped:Meridian\`\n⠀\n` +
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
                        `• Roles: Team Leader, Management, Team Guide\n` +
                        `• Example: \`/setreminder text:Meeting time:14:00 date:2024-01-20\`\n` +
                        `• Supports one-time or recurring (daily/weekly/monthly)\n⠀\n` +
                        `**\`/listreminders\`** - View your reminders\n` +
                        `• Roles: Everyone\n` +
                        `• Shows reminders based on visibility (private/role/public)\n⠀`
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
// START BOT
// ───────────────────────────────────────────────

deployCommands();
client.login(DISCORD_TOKEN);
