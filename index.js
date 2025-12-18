import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
} from "discord.js";

import { google } from "googleapis";

// ENVIRONMENT VARIABLES
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// GOOGLE AUTH SETUP
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// BOT COMMANDS
const getNotesCmd = new SlashCommandBuilder()
    .setName("getnotes")
    .setDescription("Retrieve notable interactions for a specific faction.")
    .addStringOption(option =>
        option.setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
    )
    .addBooleanOption(option =>
        option.setName("all")
            .setDescription("Set to true to retrieve all records instead of just the last 30 days.")
            .setRequired(false)
    );

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

// DEPLOY COMMANDS
async function deployCommands() {
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: [getNotesCmd.toJSON()] }
        );
        console.log("Commands registered.");
    } catch (err) {
        console.error("DEPLOY ERROR:", err);
    }
}

// HELPER FUNCTIONS
async function loadSheet(range) {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range,
        });
        return res.data.values || [];
    } catch (err) {
        console.error("Error loading sheet data:", err);
        return [];
    }
}

function isWithin30Days(dateString) {
    const today = new Date();
    const past30Days = new Date(today);
    past30Days.setDate(today.getDate() - 30);

    const inputDate = new Date(dateString);
    return inputDate >= past30Days && inputDate <= today;
}

// DISCORD CLIENT
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
    client.user.setPresence({
        activities: [{ name: "Monitoring your commands...", type: 3 }],
        status: "online",
    });
});

// COMMAND HANDLER
client.on("interactionCreate", async interaction => {
    if (!interaction.isCommand()) return;

    // GET NOTES COMMAND
    if (interaction.commandName === "getnotes") {
        const faction = interaction.options.getString("faction");
        const all = interaction.options.getBoolean("all") || false;

        const rows = await loadSheet("Notable Interactions!A1:D999");
        const header = rows[0] || [];
        const data = rows.slice(1);

        const factionNotes = data.filter(row => row[0]?.toLowerCase() === faction.toLowerCase());
        const filteredNotes = all
            ? factionNotes // Include all records
            : factionNotes.filter(row => isWithin30Days(row[3])); // Include last 30 days only

        if (filteredNotes.length === 0) {
            return interaction.reply(`No notable interactions found for "${faction}"${all ? "." : " (last 30 days)."} Try setting **all** to true to check the full history.`);
        }

        const lines = filteredNotes.map(row => `**${row[3]}** - ${row[1]} by ${row[2]}`);

        // Chunk lines to fit into Discord's embed field size limit
        const chunks = [];
        let currentChunk = "";
        lines.forEach(line => {
            if ((currentChunk + line).length > 1024) {
                chunks.push(currentChunk);
                currentChunk = line + "\n";
            } else {
                currentChunk += line + "\n";
            }
        });
        if (currentChunk) chunks.push(currentChunk);

        const embed = new EmbedBuilder()
            .setColor(0x2b6cb0)
            .setTitle(`Notable Interactions for "${faction}"`)
            .setDescription(all ? "Showing all records:" : "Showing records from the last 30 days:")
            .addFields(chunks.map((chunk, index) => ({ name: `Part ${index + 1}`, value: chunk })));

        await interaction.reply({ embeds: [embed] });
    }
});

deployCommands();
client.login(DISCORD_TOKEN);
