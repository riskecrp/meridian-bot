import { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder 
} from "discord.js";

import { google } from "googleapis";

// Load environment variables from Railway
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const GOOGLE_PROJECT_ID = process.env.GOOGLE_PROJECT_ID;
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

// Define the slash command
const factionInfoCmd = new SlashCommandBuilder()
    .setName("factioninfo")
    .setDescription("Look up faction information from the dossier.")
    .addStringOption(option =>
        option.setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
    );

// Deploy commands to Discord
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

// Create Discord client
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Command handler
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "factioninfo") {
        const factionRequested = interaction.options.getString("faction").toLowerCase();

        try {
            const sheetId = process.env.GOOGLE_SHEET_ID;

            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: "Sheet1!A1:H999"
            });

            const rows = res.data.values;
            if (!rows || rows.length < 2) {
                return interaction.reply("No data found in the sheet.");
            }

            const headers = rows[0];
            const data = rows.slice(1);

            // Match faction
            const match = data.filter(r => r[0] && r[0].toLowerCase() === factionRequested);

            if (match.length === 0) {
                return interaction.reply("Faction not found in the dossier.");
            }

            // Collect info
            const people = [];
            const locations = new Set();

            for (const row of match) {
                const faction = row[0];
                const character = row[1];
                const phone = row[2];
                const address = row[3];
                const isLeader = row[4] === "TRUE";
                const locationFaction = row[6];
                const locationAddress = row[7];

                if (character) {
                    people.push({
                        character,
                        phone: phone || "N/A",
                        address: address || "N/A",
                        leader: isLeader
                    });
                }

                if (locationFaction && locationFaction.toLowerCase() === factionRequested) {
                    if (locationAddress) {
                        locations.add(locationAddress);
                    }
                }
            }

            // Build embed
            const embed = new EmbedBuilder()
                .setTitle(`Faction Info: ${factionRequested}`)
                .setColor(0x5e81ac);

            // People section
            if (people.length > 0) {
                let peopleText = people.map(p =>
                    `**${p.character}**${p.leader ? " (Leader)" : ""}\n` +
                    `📞 ${p.phone}\n` +
                    `🏠 ${p.address}\n`
                ).join("\n");

                embed.addFields({
                    name: "Members",
                    value: peopleText
                });
            }

            // Locations section
            if (locations.size > 0) {
                embed.addFields({
                    name: "Known Locations",
                    value: [...locations].join("\n")
                });
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
