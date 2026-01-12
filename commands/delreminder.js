import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- HELPER: Find Reminders Created by Username ---
async function getMyReminders(username) {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "Reminders!A2:H999" // We need up to Col H (Creator)
        });
        const rows = res.data.values || [];
        
        // Map rows to objects
        // Schema: 0=Text, 1=Time, 2=Date, ... 7=Creator
        return rows.map((r, i) => ({
            index: i + 2, // Sheet Row Index (1-based, +1 for header)
            text: r[0],
            date: r[2],
            time: r[1],
            creator: r[7] // Column H
        })).filter(r => r.creator === username);

    } catch (err) {
        console.error("Error fetching reminders:", err);
        return [];
    }
}

// --- HELPER: Get Sheet ID (Needed for deletion) ---
async function getSheetId(title) {
    try {
        const res = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
        const sheet = res.data.sheets.find(s => s.properties.title === title);
        return sheet ? sheet.properties.sheetId : null;
    } catch (err) { return null; }
}

export default {
    data: new SlashCommandBuilder()
        .setName("delreminder")
        .setDescription("Delete a reminder you created.")
        .addStringOption(option => 
            option.setName("reminder")
                .setDescription("Select the reminder to delete")
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        
        // Filter by USERNAME, not ID
        const myReminders = await getMyReminders(interaction.user.username);

        const choices = myReminders.map(r => ({
            name: `${r.date} ${r.time}: ${r.text.slice(0, 30)}...`,
            value: r.index.toString()
        }));

        const filtered = choices.filter(c => c.name.toLowerCase().includes(focused)).slice(0, 25);
        await interaction.respond(filtered);
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const rowNum = parseInt(interaction.options.getString("reminder"));

        if (isNaN(rowNum)) {
            return interaction.editReply("❌ Invalid selection.");
        }

        try {
            // Verify ownership (Column H / Index 7)
            // We fetch the specific row to be safe
            const checkRes = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Reminders!H${rowNum}` // Column H is Creator
            });
            
            const realCreator = checkRes.data.values?.[0]?.[0];

            if (realCreator !== interaction.user.username) {
                return interaction.editReply("❌ You cannot delete a reminder you didn't create.");
            }

            // Perform Deletion
            const sheetId = await getSheetId("Reminders");
            if (!sheetId) return interaction.editReply("❌ Error: Reminders sheet not found.");

            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: GOOGLE_SHEET_ID,
                requestBody: {
                    requests: [{
                        deleteDimension: {
                            range: {
                                sheetId: sheetId,
                                dimension: "ROWS",
                                startIndex: rowNum - 1, // API is 0-based
                                endIndex: rowNum
                            }
                        }
                    }]
                }
            });

            return interaction.editReply("🗑️ Reminder deleted successfully.");

        } catch (err) {
            console.error("DelReminder Error:", err);
            return interaction.editReply("❌ Error deleting reminder.");
        }
    }
};
