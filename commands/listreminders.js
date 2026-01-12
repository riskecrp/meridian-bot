import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";
import { replyWithPaginatedEmbed } from "../utils/helpers.js";

export default {
    data: new SlashCommandBuilder()
        .setName("listreminders")
        .setDescription("Display active reminders that target you, your roles, or are public."),

    async execute(interaction) {
        const username = interaction.user.username;
        const userId = interaction.user.id;
        
        // Get all user's role names (lowercase for easier comparison)
        const userRoleNames = interaction.member.roles.cache.map(r => r.name.toLowerCase());

        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Reminders!A:O"
            });

            const rows = res.data.values || [];
            const reminders = [];

            // Skip header (i=1)
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length < 13) continue;

                // Parse Data
                const text = row[0];
                const time = row[1];
                const date = row[2];
                const recurrence = row[3] || "none";
                const creatorName = row[4];
                const timezone = row[6] || "UTC";
                const visibility = row[7] || "private";
                const rowCreatorID = row[8];
                const targetType = row[10];                 // "user" or "role"
                const targetValue = row[11]?.toLowerCase(); // "johndoe" or "management"
                const status = row[12];

                // Skip completed/deleted/warned
                if (status === "completed" || status === "deleted" || !text) continue;

                // --- FILTER LOGIC ---
                let isVisible = false;

                // 1. Did I create it?
                if (rowCreatorID === userId) isVisible = true;

                // 2. Is it Public?
                else if (visibility === "public") isVisible = true;

                // 3. Is it targeting ME? (User type)
                else if (targetType === "user" && (targetValue === username.toLowerCase() || targetValue === userId)) isVisible = true;

                // 4. Is it targeting MY ROLE? (Role type)
                else if (targetType === "role" && userRoleNames.includes(targetValue)) isVisible = true;

                if (isVisible) {
                    reminders.push({
                        date, time, timezone, text, recurrence, creatorName, visibility, targetValue
                    });
                }
            }

            if (reminders.length === 0) {
                 return interaction.reply({ content: "No active reminders found for you.", ephemeral: true });
            }

            // Sort by Date (Approximate)
            reminders.sort((a, b) => {
                const dateA = new Date(`${a.date}T${a.time}`);
                const dateB = new Date(`${b.date}T${b.time}`);
                return dateA - dateB;
            });

            const lines = reminders.map(r => {
                const recur = r.recurrence !== "none" ? ` 🔄 ${r.recurrence}` : "";
                const targetDisplay = r.visibility === "public" ? "Everyone" : r.targetValue;
                return `**${r.date} @ ${r.time}** (${r.timezone})${recur}\n🎯 Target: ${targetDisplay}\n📝 ${r.text}\n_By ${r.creatorName}_`;
            });

            await replyWithPaginatedEmbed(interaction, lines, "⏰ YOUR ACTIVE REMINDERS");

        } catch (err) {
            console.error("LISTREMINDERS ERROR:", err);
            return interaction.reply({ content: "There was an error accessing the Google Sheet.", ephemeral: true });
        }
    }
};
