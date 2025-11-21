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

// Slash command definition (with autocomplete)
const factionInfoCmd = new SlashCommandBuilder()
    .setName("factioninfo")
    .setDescription("Look up faction information from the dossier.")
    .addStringOption(option =>
        option.setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
            .setAutocomplete(true)
    );

// Deploy slash command
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

// Cache factions so we don't re-query constantly
let cachedFactions = [];

// Load faction list from Columns A and G
async function loadFactions(sheetId) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "Sheet1!A1:I999"
    });

    const rows = res.data.values || [];
    const data = rows.slice(1);

    const factionsSet = new Set();

    for (const row of data) {
        if (row[0]) factionsSet.add(row[0].trim());  // Person section
        if (row[6]) factionsSet.add(row[6].trim());  // Location section
    }

    cachedFactions = [...factionsSet].filter(f => f.length > 0);
    console.log("Loaded factions:", cachedFactions);
}

// Discord client
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Set bot status
    client.user.setPresence({
        activities: [
            {
                name: "Waiting for associate request...",
                type: 3 // WATCHING
            }
        ],
        status: "online"
    });
});

// AUTOCOMPLETE HANDLER
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

// MAIN COMMAND HANDLER
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "factioninfo") {
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
            // PEOPLE SECTION (A–E)
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
            // LOCATIONS SECTION (G–I)
            //
            const locationRows = data.filter(r =>
                r[6] && r[6].toLowerCase() === factionRequested
            );

            const hqAddresses = [];
            const otherLocations = [];

            for (const row of locationRows) {
                const address = row[7] ? row[7].trim() : null;
                const isHQ = row[8] === "TRUE";

                if (!address) continue;

                if (isHQ) {
                    hqAddresses.push(address);
                } else {
                    otherLocations.push(address);
                }
            }

            //
            // BUILD EMBED
            //
            const embed = new EmbedBuilder()
                .setTitle(`Faction Info: ${factionRequested}`)
                .setColor(0x5e81ac);

            //
            // MEMBERS
            //
            if (people.length > 0) {
                const memberText = people
                    .map(p =>
                        `**${p.character}**${p.leader ? " (Leader)" : ""}\n` +
                        `📞 ${p.phone}\n` +
                        `🏠 ${p.personAddress}\n`
                    )
                    .join("\n");

                embed.addFields({ name: "Members", value: memberText });
            }

            //
            // LOCATIONS (ALL ADDRESSES + MULTIPLE HQ)
            //
            let locationText = "";

            // HQs first
            for (const hq of hqAddresses) {
                locationText += `🏠 **HQ:** ${hq}\n`;
            }

            // Other locations
            for (const addr of otherLocations) {
                locationText += `📍 ${addr}\n`;
            }

            if (locationText.length > 0) {
                embed.addFields({ name: "Locations", value: locationText });
            }

            await interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error("Error handling command:", err);
            return interaction.reply("An error occurred while reading the Google Sheet.");
        }
    }
});

// Start bot
deployCommands();
client.login(DISCORD_TOKEN);
