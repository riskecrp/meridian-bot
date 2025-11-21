import { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder 
} from "discord.js";

import { google } from "googleapis";

// Environment variables from Railway
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

// Google Sheets auth
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
);

const sheets = google.sheets({ version: "v4", auth });

// Slash command
const factionInfoCmd = new SlashCommandBuilder()
    .setName("factioninfo")
    .setDescription("Look up faction information from the dossier.")
    .addStringOption(option =>
        option.setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
            .setAutocomplete(true)
    );

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

async function deployCommands() {
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: [factionInfoCmd.toJSON()] }
        );
        console.log("Slash commands registered.");
    } catch (err) {
        console.error("Error deploying commands:", err);
    }
}

let cachedFactions = [];

// Load factions from Columns A and G
async function loadFactions(sheetId) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "Sheet1!A1:I999"
    });

    const rows = res.data.values || [];
    const data = rows.slice(1);

    const set = new Set();

    for (const row of data) {
        if (row[0]) set.add(row[0].trim()); // Person faction
        if (row[6]) set.add(row[6].trim()); // Location faction
    }

    cachedFactions = [...set];
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);

    client.user.setPresence({
        activities: [
            {
                name: "Waiting for associate request...",
                type: 3
            }
        ],
        status: "online"
    });
});

// AUTOCOMPLETE
client.on("interactionCreate", async interaction => {
    if (!interaction.isAutocomplete()) return;
    if (interaction.commandName !== "factioninfo") return;

    const focused = interaction.options.getFocused();
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (cachedFactions.length === 0) {
        await loadFactions(sheetId);
    }

    const filtered = cachedFactions
        .filter(f => f.toLowerCase().includes(focused.toLowerCase()))
        .slice(0, 25)
        .map(f => ({ name: f, value: f }));

    await interaction.respond(filtered);
});

// MAIN COMMAND
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "factioninfo") return;

    const factionRequested = interaction.options.getString("faction").toLowerCase();
    const sheetId = process.env.GOOGLE_SHEET_ID;

    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: "Sheet1!A1:I999"
        });

        const rows = res.data.values || [];
        const data = rows.slice(1);

        //
        // PEOPLE — Columns A–E
        //
        const people = data
            .filter(r => r[0] && r[0].toLowerCase() === factionRequested)
            .map(r => ({
                character: r[1] || "N/A",
                phone: r[2] || "N/A",
                personAddress: r[3] || "N/A",
                leader: r[4] === "TRUE"
            }));

        //
        // LOCATIONS — Columns G–I (indexes 6,7,8)
        //
        const locationRows = data.filter(r =>
            r[6] && r[6].toLowerCase() === factionRequested
        );

        const hqs = [];
        const addresses = [];

        for (const row of locationRows) {
            const address = row[7] ? row[7].trim() : null; // Column H
            const isHQ = row[8] === "TRUE";                // Column I

            if (!address) continue;

            if (isHQ) hqs.push(address);
            else addresses.push(address);
        }

        //
        // BUILD EMBED
        //
        const embed = new EmbedBuilder()
            .setTitle(`Faction Info: ${factionRequested}`)
            .setColor(0x5e81ac);

        // Members
        if (people.length > 0) {
            embed.addFields({
                name: "Members",
                value: people.map(p =>
                    `**${p.character}**${p.leader ? " (Leader)" : ""}\n` +
                    `📞 ${p.phone}\n` +
                    `🏠 ${p.personAddress}\n`
                ).join("\n")
            });
        }

        // Locations
        let locText = "";

        for (const hq of hqs) {
            locText += `🏠 **HQ:** ${hq}\n`;
        }

        for (const addr of addresses) {
            locText += `📍 ${addr}\n`;
        }

        if (locText.length > 0) {
            embed.addFields({
                name: "Locations",
                value: locText
            });
        }

        await interaction.reply({ embeds: [embed] });

    } catch (err) {
        console.error(err);
        return interaction.reply("Error reading the Google Sheet.");
    }
});

deployCommands();
client.login(DISCORD_TOKEN);
