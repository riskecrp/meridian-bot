import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- HELPER: Find ACTIVE Reminders Created by Username ---
async function getMyActiveReminders(username) {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            // Need up to Col M (Index 12) for Status
            range: "Reminders!A2:M999" 
        });
        const rows = res.data.values || [];
        
        return rows.map((r, i) => ({
            index: i + 2, // Sheet Row Index
            text: r[0],
            time: r[1],
            date: r[2],
            creator: r[7],
            status: (r[12] || "").toLowerCase()
        })).filter(r => r.creator === username && r.status === "active");

    } catch (err) {
        console.error("Error fetching reminders:", err);
        return [];
    }
}

// --- HELPER: Get Sheet ID ---
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
        .setDescription("Delete an active reminder you created.")
        .addStringOption(option => 
            option.setName("reminder")
                .setDescription("Select the reminder to delete")
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        
        // Only fetch ACTIVE reminders
        const myReminders = await getMyActiveReminders(interaction.user.username);

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

        if (isNaN(rowNum)) return interaction.editReply("❌ Invalid selection.");

        try {
            // Verify ownership AND status
            const checkRes = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Reminders!H${rowNum}:M${rowNum}` // H=Creator, M=Status
            });
            
            const row = checkRes.data.values?.[0] || [];
            const realCreator = row[0]; // H
            // M is index 5 relative to H (H, I, J, K, L, M)
            const status = (row[5] || "").toLowerCase(); 

            if (realCreator !== interaction.user.username) {
                return interaction.editReply("❌ You cannot delete a reminder you didn't create.");
            }
            if (status !== "active") {
                return interaction.editReply("❌ This reminder is not active (or already deleted).");
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
                                startIndex: rowNum - 1, 
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
