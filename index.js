import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
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
    // Removed default ManageGuild permission to enforce the Management role at runtime.
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
        o.setName("fm_provided")
            .setDescription("Was this provided by FM?")
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

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

// ───────────────────────────────────────────────
// DEPLOY COMMANDS
// ───────────────────────────────────────────────

async function deployCommands() {
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: [factionInfoCmd.toJSON(), addPropertyCmd.toJSON(), listPropertiesCmd.toJSON(), addDossierCmd.toJSON()] }
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
        const fmProvided = interaction.options.getBoolean("fm_provided");

        try {
            // PropertyRewards
            const rewardsRow = await findNextRowRewards();
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `PropertyRewards!A${rewardsRow}:E${rewardsRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[date, faction, address, type, fmProvided]]
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

            let bodyValue;

            if (data.length === 0) {
                bodyValue = "_No properties listed._";
            } else {
                const lines = data.map(r => {
                    const faction = r[1] || "Unknown Faction";
                    const address = r[2] || "N/A";
                    const type = r[3] || "Property";
                    const icon = type === "HQ" ? "🏠" : type === "Warehouse" ? "📦" : "📍";
                    return `**${faction}** - ${icon} ${type}: ${address}`;
                });
                bodyValue = lines.join("\n");
            }

            const embed = new EmbedBuilder()
                .setColor(0x2b6cb0)
                .setTitle(
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🗂️  **MERIDIAN DATABASE ENTRY**\n` +
                    `**Organization: Property Rewards**\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━`
                )
                .addFields({
                    name: "⠀",
                    value: bodyValue
                });

            return interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error("LISTPROPERTIES ERROR:", err);
            return interaction.reply("There was an error accessing the Google Sheet.");
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
});

// ───────────────────────────────────────────────
// START BOT
// ───────────────────────────────────────────────

deployCommands();
client.login(DISCORD_TOKEN);
