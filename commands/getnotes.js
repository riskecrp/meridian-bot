import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";
import { replyWithPaginatedEmbed } from "../utils/helpers.js";

// Helper: Get unique factions (reused logic)
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
        .setName("getnotes")
        .setDescription("Retrieve notable interactions for a faction.")
        .addStringOption(o =>
            o.setName("faction")
                .setDescription("Faction name")
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addBooleanOption(o =>
            o.setName("all")
                .setDescription("Show all notes (default: last 30 days)")
                .setRequired(false)
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
        const showAll = interaction.options.getBoolean("all") || false;

        try {
            // Check if tab exists first
            const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
            const tabExists = sheetInfo.data.sheets.some(s => s.properties.title === "Notable Interactions");

            if (!tabExists) {
                return interaction.reply({ content: "No notes found (Table 'Notable Interactions' does not exist yet).", ephemeral: true });
            }

            // Fetch Notes
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Notable Interactions!A:D" // Faction, Note, Created By, Created On
            });

            const rows = res.data.values || [];
            const factionLower = faction.toLowerCase().trim();
            
            // Filter Logic
            let notes = [];
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            // Skip header (i=1)
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;

                const rowFaction = (row[0] || "").toLowerCase().trim();

                if (rowFaction === factionLower) {
                    const noteText = row[1] || "N/A";
                    const createdBy = row[2] || "Unknown";
                    const createdOn = row[3] || "Unknown";

                    // Date Filter
                    if (!showAll) {
                        const noteDate = new Date(createdOn);
                        if (isNaN(noteDate.getTime())) continue; // Skip invalid dates
                        noteDate.setHours(0, 0, 0, 0);
                        
                        if (noteDate < thirtyDaysAgo) continue; // Skip old notes
                    }

                    notes.push({
                        date: createdOn,
                        by: createdBy,
                        text: noteText
                    });
                }
            }

            // Sort by Date (Descending - newest first)
            notes.sort((a, b) => new Date(b.date) - new Date(a.date));

            // Format Lines for Display
            const lines = notes.map(n => 
                `**${n.date}** by ${n.by}\n${n.text}\n`
            );

            // Send Response
            const title = `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📝  **NOTABLE INTERACTIONS**\n**Faction: ${faction}**\n${showAll ? "(All Time)" : "(Last 30 Days)"}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`;
            
            await replyWithPaginatedEmbed(interaction, lines, title);

        } catch (err) {
            console.error("GETNOTES ERROR:", err);
            return interaction.reply({ content: "There was an error accessing the Google Sheet.", ephemeral: true });
        }
    }
};
