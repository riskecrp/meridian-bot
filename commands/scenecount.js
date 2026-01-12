import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";
import { chunkLinesToFieldValues } from "../utils/helpers.js";

// Helper to get unique factions from Sheet1 Column A (reused logic)
async function getUniqueFactions() {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "Sheet1!A2:A999"
        });
        const rows = res.data.values || [];
        const unique = [...new Set(rows.flat().map(f => f.trim()).filter(f => f))];
        return unique.sort();
    } catch (err) {
        console.error("Error fetching factions:", err);
        return [];
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName("scenecount")
        .setDescription("List all scenes a faction has done in the last 90 days.")
        .addStringOption(o =>
            o.setName("faction")
                .setDescription("Faction name")
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const factions = await getUniqueFactions();
        
        const filtered = factions
            .filter(choice => choice.toLowerCase().includes(focusedValue))
            .slice(0, 25);

        await interaction.respond(
            filtered.map(choice => ({ name: choice, value: choice }))
        );
    },

    async execute(interaction) {
        const faction = interaction.options.getString("faction");

        try {
            // Check if "Scene Logs" tab exists first
            const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
            const tabExists = sheetInfo.data.sheets.some(s => s.properties.title === "Scene Logs");

            if (!tabExists) {
                return interaction.reply({ 
                    content: "No scene logs found (Table 'Scene Logs' does not exist yet).", 
                    ephemeral: true 
                });
            }

            // Fetch logs
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Scene Logs!A:D" // Date, Faction, Rewards, Logged By
            });

            const rows = res.data.values || [];
            if (rows.length <= 1) {
                return interaction.reply({ 
                    content: `No scenes recorded yet for **${faction}**.`, 
                    ephemeral: true 
                });
            }

            // Calculate 90 days ago
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            const factionLower = faction.toLowerCase().trim();

            let count = 0;
            const recentScenes = [];

            // Skip header (i=1)
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const dateStr = row[0];
                const rowFaction = (row[1] || "").toLowerCase().trim();
                const rewards = row[2] || "N/A";
                // const loggedBy = row[3];

                if (rowFaction === factionLower) {
                    // Check Date
                    const logDate = new Date(dateStr);
                    if (!isNaN(logDate.getTime()) && logDate >= ninetyDaysAgo) {
                        count++;
                        recentScenes.push(`**${dateStr}**: ${rewards}`);
                    }
                }
            }

            if (count === 0) {
                const embedEmpty = new EmbedBuilder()
                    .setColor(0x2b6cb0)
                    .setTitle(`📊 SCENE COUNT: ${faction}`)
                    .setDescription("_No scenes found in the last 90 days._");
                return interaction.reply({ embeds: [embedEmpty] });
            }

            // Sort scenes by date (newest first)
            recentScenes.sort().reverse();

            // Build output
            // If list is huge, we just show the count and the last 10 scenes
            const previewLines = recentScenes.slice(0, 15); 
            const extraCount = count - previewLines.length;

            const description = previewLines.join("\n") + 
                (extraCount > 0 ? `\n\n_...and ${extraCount} more._` : "");

            const embed = new EmbedBuilder()
                .setColor(0x2b6cb0)
                .setTitle(`📊 SCENE COUNT: ${faction}`)
                .setDescription(`**Total in last 90 days:** ${count}\n\n${description}`)
                .setFooter({ text: "Showing recent scenes" });

            return interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error("SCENECOUNT ERROR:", err);
            return interaction.reply({ content: "There was an error accessing the Google Sheet.", ephemeral: true });
        }
    }
};
