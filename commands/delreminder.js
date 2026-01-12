import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

export default {
    data: new SlashCommandBuilder()
        .setName("delreminder")
        .setDescription("Delete one of your active reminders.")
        .addStringOption(o =>
            o.setName("reminder")
                .setDescription("Search for your reminder to delete")
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const userId = interaction.user.id;

        try {
            // Fetch all reminders
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Reminders!A2:O500" // Fetch reasonable range
            });

            const rows = res.data.values || [];
            const myReminders = [];

            // Filter for reminders created by THIS user that are ACTIVE
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                // Row[8] is CreatorID, Row[12] is Status
                if (row[8] === userId && row[12] !== "completed" && row[12] !== "deleted") {
                    const text = row[0] || "No text";
                    const date = row[2] || "No date";
                    const time = row[1] || "No time";
                    
                    // Value must be the SHEET ROW INDEX (i + 2 because we started at A2)
                    myReminders.push({
                        name: `${date} ${time} | ${text.substring(0, 50)}...`,
                        value: (i + 2).toString() 
                    });
                }
            }

            // Filter by search term
            const filtered = myReminders
                .filter(r => r.name.toLowerCase().includes(focusedValue))
                .slice(0, 25);

            await interaction.respond(filtered);

        } catch (err) {
            console.error("Autocomplete Error:", err);
            await interaction.respond([]);
        }
    },

    async execute(interaction) {
        const rowIndex = interaction.options.getString("reminder");
        const userId = interaction.user.id;

        await interaction.deferReply({ ephemeral: true });

        try {
            // 1. Verify ownership before deleting (Security check)
            const checkRes = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Reminders!I${rowIndex}` // Check CreatorID column
            });
            
            const ownerId = checkRes.data.values?.[0]?.[0];

            if (ownerId !== userId) {
                return interaction.editReply("❌ Error: You can only delete reminders you created, or this reminder no longer exists.");
            }

            // 2. Delete the row (Clear it)
            // We clear 15 columns (A to O) to effectively remove it
            await sheets.spreadsheets.values.clear({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Reminders!A${rowIndex}:O${rowIndex}`
            });

            return interaction.editReply(`✅ **Reminder Deleted.** (Row ${rowIndex} cleared)`);

        } catch (err) {
            console.error("DELREMINDER ERROR:", err);
            return interaction.editReply("❌ Database Error: Could not delete reminder.");
        }
    }
};
