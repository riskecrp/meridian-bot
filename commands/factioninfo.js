// commands/factioninfo.js
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// Cache for autocomplete
let cachedFactions = [];

async function loadFactions() {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "Sheet1!A1:H999"
        });
        const rows = res.data.values || [];
        const set = new Set();
        for (const r of rows.slice(1)) {
            if (r[0]) set.add(r[0].trim()); // Column A
            if (r[5]) set.add(r[5].trim()); // Column F
        }
        cachedFactions = [...set];
    } catch (err) {
        console.error("Error loading factions for cache:", err);
    }
}

export default {
    // 1. The Command Builder
    data: new SlashCommandBuilder()
        .setName("factioninfo")
        .setDescription("Look up faction information from the Meridian database.")
        .addStringOption(option =>
            option.setName("faction")
                .setDescription("Faction name")
                .setRequired(true)
                .setAutocomplete(true)
        ),

    // 2. The Autocomplete Logic
    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        
        // Refresh cache if empty
        if (cachedFactions.length === 0) await loadFactions();

        const filtered = cachedFactions.filter(choice => 
            choice.toLowerCase().includes(focusedValue.toLowerCase())
        ).slice(0, 25); // Discord max is 25 choices

        await interaction.respond(
            filtered.map(choice => ({ name: choice, value: choice }))
        );
    },

    // 3. The Execution Logic
    async execute(interaction) {
        const factionRequested = interaction.options.getString("faction").toLowerCase();

        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Sheet1!A1:H999"
            });

            const rows = res.data.values || [];
            const data = rows.slice(1);

            // Filter People
            const people = data
                .filter(r => r[0] && r[0].toLowerCase() === factionRequested)
                .map(r => ({
                    character: r[1] || "N/A",
                    phone: r[2] || "N/A",
                    personalAddress: r[3] || "N/A",
                    leader: r[4]?.toUpperCase() === "TRUE"
                }));

            // Filter Properties
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

            const uniqueHQs = [...new Set(hqs)];
            const uniqueAddrs = [...new Set(addresses.filter(a => !uniqueHQs.includes(a)))];

            // Build Embed
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
                        (people.length
                            ? people.map(p =>
                                `**${p.character}**${p.leader ? " (Leader)" : ""}\n` +
                                `• Phone: ${p.phone}\n` +
                                `• Residence: ${p.personalAddress}`
                            ).join("\n\n")
                            : "_No command members listed._") +
                        `\n\n⠀\n` +
                        `__**Known Organization Properties**__\n` +
                        (uniqueHQs.length || uniqueAddrs.length
                            ? [
                                ...uniqueHQs.map(a => `🏠 **HQ:** ${a}`),
                                ...uniqueAddrs.map(a => `📍 Property: ${a}`)
                            ].join("\n")
                            : "_No faction properties listed._")
                });

            return interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error("FACTIONINFO ERROR:", err);
            return interaction.reply("There was an error accessing the Google Sheet.");
        }
    }
};
