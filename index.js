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

// ENV VARS
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// AUTH
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// SLASH COMMANDS
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
        o.setName("date")
            .setDescription("Date Given")
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
    .addStringOption(o =>
        o.setName("fmprovided")
            .setDescription("Provided by FM?")
            .setRequired(true)
            .addChoices(
                { name: "Yes", value: "TRUE" },
                { name: "No", value: "FALSE" }
            )
    );

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

// DEPLOY COMMANDS
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

// LOAD FACTIONS FOR AUTOCOMPLETE
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

// DISCORD CLIENT
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once("clientReady", () => {
    console.log(`Logged in as ${client.user.tag}`);

    client.user.setPresence({
        activities: [{ name: "Waiting for associate request...", type: 3 }],
        status: "online"
    });
});

// AUTOCOMPLETE
client.on("interactionCreate", async interaction => {
    if (!interaction.isAutocomplete()) return;

    const focused = interaction.options.getFocused();

    if (cachedFactions.length === 0) await loadFactions();

    const suggestions = cachedFactions
        .filter(f => f.toLowerCase().includes(focused.toLowerCase()))
        .slice(0, 25)
        .map(f => ({ name: f, value: f }));

    return interaction.respond(suggestions);
});

// FIND NEXT EMPTY ROW (Sheet1 F column)
async function findNextRowSheet1() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Sheet1!F:F"
    });

    const rows = res.data.values || [];
    return rows.length + 1;
}

// FIND NEXT EMPTY ROW (PropertyRewards)
async function findNextRowRewards() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "PropertyRewards!A:A"
    });

    const rows = res.data.values || [];
    return rows.length + 1;
}

// COMMAND HANDLER
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // /factioninfo
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
                    leader: r[4] && r[4].toUpperCase() === "TRUE"
                }));

            const locationRows = data.filter(r =>
                r[5] && r[5].toLowerCase() === factionRequested
            );

            let hqs = [];
            let addresses = [];

            for (const r of locationRows) {
                const address = r[6] || null;
                const isHQ = r[7] && r[7].toUpperCase() === "TRUE";

                if (!address) continue;

                if (isHQ) hqs.push(address);
                else addresses.push(address);
            }

            const embed = new EmbedBuilder()
                .setColor(0x2b6cb0)
                .setTitle(`Faction Info: ${factionRequested}`);

            embed.addFields({
                name: "Members",
                value: people.length
                    ? people
                          .map(p =>
                              `**${p.character}**${p.leader ? " (Leader)" : ""}\n📞 ${p.phone}\n🏠 ${p.personalAddress}`
                          )
                          .join("\n\n")
                    : "No members listed."
            });

            let locText = "";
            hqs.forEach(addr => (locText += `🏠 **HQ:** ${addr}\n`));
            addresses.forEach(addr => (locText += `📍 ${addr}\n`));

            embed.addFields({
                name: "Locations",
                value: locText || "No addresses listed."
            });

            return interaction.reply({ embeds: [embed] });
        } catch (err) {
            console.error("FACTIONINFO ERROR:", err);
            return interaction.reply("There was an error accessing the Google Sheet.");
        }
    }

   // /addproperty
if (interaction.commandName === "addproperty") {
    const date = interaction.options.getString("date");
    const faction = interaction.options.getString("faction");
    const address = interaction.options.getString("address");
    const type = interaction.options.getString("type");

    // Convert to BOOLEAN for Google Sheets checkbox
    const fmProvided = interaction.options.getString("fmprovided") === "TRUE";

    try {
        // Write to PropertyRewards!A:E
        const rewardsRow = await findNextRowRewards();
        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `PropertyRewards!A${rewardsRow}:E${rewardsRow}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [[date, faction, address, type, fmProvided]]
            }
        });

        // Write to Sheet1 F:H
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

        return interaction.reply({
            content: "✅ Property recorded and added to faction database.",
            ephemeral: true
        });
        } catch (err) {
            console.error("ADDPROPERTY ERROR:", err);
            return interaction.reply("There was an error updating the Google Sheet.");
        }
    }
});

// RUN BOT
deployCommands();
client.login(DISCORD_TOKEN);



