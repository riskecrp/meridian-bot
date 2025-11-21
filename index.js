import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
} from "discord.js";

import { google } from "googleapis";

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Google Auth
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// ===============================================================
// Slash Commands
// ===============================================================

const factionInfoCmd = new SlashCommandBuilder()
    .setName("factioninfo")
    .setDescription("Look up faction information from the Meridian database.")
    .addStringOption(option =>
        option
            .setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
            .setAutocomplete(true)
    );

const addPropertyCmd = new SlashCommandBuilder()
    .setName("addproperty")
    .setDescription("Add a faction property (Management only).")
    .addStringOption(option =>
        option.setName("date")
            .setDescription("Date given (YYYY-MM-DD)")
            .setRequired(true)
    )
    .addStringOption(option =>
        option.setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
            .setAutocomplete(true)
    )
    .addStringOption(option =>
        option.setName("address")
            .setDescription("Property address")
            .setRequired(true)
    )
    .addStringOption(option =>
        option.setName("type")
            .setDescription("Property type")
            .setRequired(true)
            .addChoices(
                { name: "Property", value: "Property" },
                { name: "Warehouse", value: "Warehouse" },
                { name: "HQ", value: "HQ" }
            )
    )
    .addBooleanOption(option =>
        option.setName("fm_provided")
            .setDescription("Was the property FM provided?")
            .setRequired(true)
    );

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

async function deployCommands() {
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: [factionInfoCmd.toJSON(), addPropertyCmd.toJSON()] }
        );
        console.log("Commands registered.");
    } catch (err) {
        console.error("DEPLOY ERROR:", err);
    }
}

// ===============================================================
// Cached Factions
// ===============================================================

let cachedFactions = [];

async function loadFactions() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Sheet1!A1:H999"
    });

    const rows = res.data.values || [];
    const data = rows.slice(1);

    const set = new Set();

    for (const r of data) {
        if (r[0]) set.add(r[0].trim());
        if (r[5]) set.add(r[5].trim());
    }

    cachedFactions = [...set];
}

// ===============================================================
// Discord Client
// ===============================================================

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

client.once("clientReady", () => {
    console.log(`Logged in as ${client.user.tag}`);

    client.user.setPresence({
        activities: [{ name: "Waiting for associate request...", type: 3 }],
        status: "online"
    });
});

// ===============================================================
// Autocomplete
// ===============================================================

client.on("interactionCreate", async interaction => {
    if (!interaction.isAutocomplete()) return;

    if (cachedFactions.length === 0)
        await loadFactions();

    const focused = interaction.options.getFocused();

    const list = cachedFactions
        .filter(f => f.toLowerCase().includes(focused.toLowerCase()))
        .slice(0, 25)
        .map(f => ({ name: f, value: f }));

    await interaction.respond(list);
});

// ===============================================================
// Command Handler
// ===============================================================

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // ================= /factioninfo ====================
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
                .filter(r => r[0]?.toLowerCase() === factionRequested)
                .map(r => ({
                    character: r[1] || "N/A",
                    phone: r[2] || "N/A",
                    personalAddress: r[3] || "N/A",
                    leader: r[4]?.toUpperCase() === "TRUE"
                }));

            const locRows = data.filter(r =>
                r[5]?.toLowerCase() === factionRequested
            );

            const hqs = [];
            const addresses = [];

            for (const r of locRows) {
                const addr = r[6]?.trim();
                const isHQ = r[7]?.toUpperCase() === "TRUE";

                if (!addr) continue;
                if (isHQ) hqs.push(addr);
                else addresses.push(addr);
            }

            const embed = new EmbedBuilder()
                .setTitle(`Faction Info: ${factionRequested}`)
                .setColor(0x2b6cb0);

            embed.addFields({
                name: "Members",
                value:
                    people.length > 0
                        ? people.map(p =>
                              `**${p.character}**${p.leader ? " (Leader)" : ""}\n📞 ${p.phone}\n🏠 ${p.personalAddress}`
                          ).join("\n\n")
                        : "No members listed."
            });

            let locText = "";
            hqs.forEach(a => (locText += `🏠 **HQ:** ${a}\n`));
            addresses.forEach(a => (locText += `📍 ${a}\n`));

            embed.addFields({
                name: "Locations",
                value: locText || "No addresses listed."
            });

            await interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error("FactionInfo ERROR:", err);
            await interaction.reply("There was an error accessing the Google Sheet.");
        }
    }

    // ================= /addproperty ====================
    if (interaction.commandName === "addproperty") {

        const mgmtRole = interaction.guild.roles.cache.find(r => r.name === "Management");
        if (!interaction.member.roles.cache.has(mgmtRole?.id)) {
            return interaction.reply({
                content: "You do not have permission to use this command.",
                ephemeral: true
            });
        }

        const date = interaction.options.getString("date");
        const faction = interaction.options.getString("faction");
        const address = interaction.options.getString("address");
        const type = interaction.options.getString("type");
        const fmProvided = interaction.options.getBoolean("fm_provided");

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return interaction.reply({
                content: "Invalid date format. Use YYYY-MM-DD.",
                ephemeral: true
            });
        }

        try {
            // Prevent duplicates
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Sheet1!A1:H999"
            });

            const rows = res.data.values || [];
            const data = rows.slice(1);

            const exists = data.some(r =>
                r[5]?.toLowerCase() === faction.toLowerCase() &&
                r[6]?.trim().toLowerCase() === address.toLowerCase()
            );

            if (exists) {
                return interaction.reply({
                    content: "This address already exists for this faction.",
                    ephemeral: true
                });
            }

            // ====================
            // WRITE TO PropertyRewards (append)
            // ====================
            const prWrite = await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "PropertyRewards!A:E",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[
                        date,
                        faction,
                        address,
                        type,
                        fmProvided ? "TRUE" : ""
                    ]]
                }
            });

            // Detect appended row for PropertyRewards
            let prUpdatedRange = prWrite.data.updates.updatedRange; // e.g. "PropertyRewards!A22:E22"
            let prRow = parseInt(prUpdatedRange.match(/\d+/)[0]);

            // Convert Column E of that row to checkbox
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: GOOGLE_SHEET_ID,
                requestBody: {
                    requests: [
                        {
                            updateCells: {
                                range: {
                                    sheetId: prWrite.data.updates.updatedSpreadsheetId,
                                },
                                rows: [],
                                fields: "*"
                            }
                        },
                        {
                            repeatCell: {
                                range: {
                                    sheetId: 0,
                                    startRowIndex: prRow - 1,
                                    endRowIndex: prRow,
                                    startColumnIndex: 4,
                                    endColumnIndex: 5
                                },
                                cell: {
                                    dataValidation: {
                                        condition: {
                                            type: "BOOLEAN"
                                        },
                                        strict: true,
                                        showCustomUi: true
                                    }
                                },
                                fields: "dataValidation"
                            }
                        }
                    ]
                }
            });

            // ====================
            // WRITE TO Sheet1 (append into F–H)
            // ====================
            const s1Write = await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Sheet1!F:H",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[
                        faction,
                        address,
                        type === "HQ" ? "TRUE" : ""
                    ]]
                }
            });

            // Detect appended row for Sheet1
            let s1UpdatedRange = s1Write.data.updates.updatedRange; // e.g. "Sheet1!F55:H55"
            let s1Row = parseInt(s1UpdatedRange.match(/\d+/)[0]);

            // Convert Column H of that row to checkbox
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: GOOGLE_SHEET_ID,
                requestBody: {
                    requests: [
                        {
                            repeatCell: {
                                range: {
                                    sheetId: 0,
                                    startRowIndex: s1Row - 1,
                                    endRowIndex: s1Row,
                                    startColumnIndex: 7,
                                    endColumnIndex: 8
                                },
                                cell: {
                                    dataValidation: {
                                        condition: {
                                            type: "BOOLEAN"
                                        },
                                        strict: true,
                                        showCustomUi: true
                                    }
                                },
                                fields: "dataValidation"
                            }
                        }
                    ]
                }
            });

            await interaction.reply({
                content:
                    `Property added for **${faction}**:\n` +
                    `📍 ${address}\n` +
                    `🏷️ Type: ${type}\n` +
                    `FM Provided: ${fmProvided ? "Yes" : "No"}`,
                ephemeral: true
            });

        } catch (err) {
            console.error("AddProperty ERROR:", err);
            await interaction.reply("There was an error adding the property.");
        }
    }
});

deployCommands();
client.login(DISCORD_TOKEN);
