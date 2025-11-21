import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder
} from "discord.js";

import { google } from "googleapis";

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Google Sheets Authentication
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
);

const sheets = google.sheets({ version: "v4", auth });

// Slash command definition
const factionInfoCmd = new SlashCommandBuilder()
    .setName("factioninfo")
    .setDescription("Look up faction information from the Meridian database.")
    .addStringOption(option =>
        option.setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
            .setAutocomplete(true)
    );

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

// Deploy commands
async function deployCommands() {
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: [factionInfoCmd.toJSON()] }
        );
        console.log("Commands registered.");
    } catch (err) {
        console.error("DEPLOY ERROR:", err);
    }
}

// Cached faction list
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
        if (r[0]) set.add(r[0].trim()); // People table
        if (r[5]) set.add(r[5].trim()); // Location table
    }

    cachedFactions = [...set];
}

// Discord client
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

// AUTOCOMPLETE
client.on("interactionCreate", async interaction => {
    if (!interaction.isAutocomplete()) return;
    if (interaction.commandName !== "factioninfo") return;

    if (cachedFactions.length === 0)
        await loadFactions();

    const focused = interaction.options.getFocused();
    const list = cachedFactions
        .filter(f => f.toLowerCase().includes(focused.toLowerCase()))
        .slice(0, 25)
        .map(f => ({ name: f, value: f }));

    await interaction.respond(list);
});

// MAIN COMMAND
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "factioninfo") return;

    const factionRequested = interaction.options.getString("faction").toLowerCase();

    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "Sheet1!A1:H999"
        });

        const rows = res.data.values || [];
        const data = rows.slice(1);

        //
        // PEOPLE TABLE — Columns A–E (0–4)
        //
        const people = data
            .filter(r =>
                r[0] && r[0].toLowerCase().trim() === factionRequested
            )
            .map(r => ({
                character: r[1] || "N/A",
                phone: r[2] || "N/A",
                personalAddress: r[3] || "N/A",
                leader: r[4] && r[4].toUpperCase() === "TRUE"
            }));

        //
        // LOCATION TABLE — Columns F–H (5–7)
        //
        const locationRows = data.filter(r =>
            r[5] && r[5].toLowerCase().trim() === factionRequested
        );

        const hqs = [];
        const addresses = [];

        for (const r of locationRows) {
            const address = r[6] ? r[6].trim() : null; // Column G
            const isHQ = r[7] && r[7].toUpperCase() === "TRUE"; // Column H

            if (!address) continue;

            if (isHQ) hqs.push(address);
            else addresses.push(address);
        }

        //
        // BUILD EMBED
        //
        const embed = new EmbedBuilder()
            .setTitle(`Faction Info: ${factionRequested}`)
            .setColor(0x2b6cb0);

        // Members
        if (people.length > 0) {
            embed.addFields({
                name: "Members",
                value: people
                    .map(p =>
                        `**${p.character}**${p.leader ? " (Leader)" : ""}\n` +
                        `📞 ${p.phone}\n` +
                        `🏠 ${p.personalAddress}`
                    )
                    .join("\n\n")
            });
        } else {
            embed.addFields({
                name: "Members",
                value: "(This faction has no registered personnel.)"
            });
        }

        // Locations
        let locText = "";

        hqs.forEach(addr => locText += `🏠 **HQ:** ${addr}\n`);
        addresses.forEach(addr => locText += `📍 ${addr}\n`);

        embed.addFields({
            name: "Locations",
            value: locText || "No addresses listed."
        });

        await interaction.reply({ embeds: [embed] });

    } catch (err) {
        console.error("COMMAND ERROR:", err);
        return interaction.reply("There was an error accessing the Google Sheet.");
    }
});

deployCommands();
client.login(DISCORD_TOKEN);
