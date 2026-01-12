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
            // Fetch first 200 rows to find user's reminders
            // (Assuming most recent are at the top or bottom depending on how you add them, 
            // but fetching a chunk is safer than fetching 9999)
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Reminders!A2:O200" 
            });

            const rows = res.data.values || [];
            const myReminders = [];

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!row) continue;

                const text = row[0] || "No text";
                const date = row[2] || "No date";
                const time = row[1] || "No time";
                const creatorId = row[8];   // Column I
                const status = row[12];     // Column M

                // Only show ACTIVE reminders owned by THIS USER
                if (creatorId === userId && status === "active") {
                    // We send the ROW INDEX (i + 2) as the value so we know exactly which line to delete
                    myReminders.push({
                        name: `${date} ${time} | ${text.substring(0, 50)}...`,
                        value: (i + 2).toString() 
                    });
                }
            }

            // Filter choices based on what the user types
            const filtered = myReminders
                .filter(r => r.name.toLowerCase().includes(focusedValue))
                .slice(0, 25); // Discord limit is 25 choices

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
            // 1. Verify ownership (Security Check)
            const checkRes = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Reminders!I${rowIndex}` // Check CreatorID column
            });
            
            const ownerId = checkRes.data.values?.[0]?.[0];

            if (ownerId !== userId) {
                return interaction.editReply("❌ Error: You can only delete reminders you created.");
            }

            // 2. Mark as Deleted
            // We set status to "deleted" instead of wiping the row. 
            // The Cron job ignores anything that isn't "active".
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Reminders!M${rowIndex}`, // Status Column
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [["deleted"]] }
            });

            return interaction.editReply(`✅ **Reminder Deleted.**`);

        } catch (err) {
            console.error("DELREMINDER ERROR:", err);
            return interaction.editReply("❌ Database Error: Could not delete reminder.");
        }
    }
};
