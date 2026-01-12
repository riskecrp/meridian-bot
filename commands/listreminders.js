import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

export default {
    data: new SlashCommandBuilder()
        .setName("listreminders")
        .setDescription("Show active reminders (Matched by Username or Role Name)."),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch the full range based on the setreminder schema (Cols A to O)
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Reminders!A2:O999" 
            });

            const rows = res.data.values || [];
            if (rows.length === 0) {
                return interaction.editReply("📭 No active reminders found in the system.");
            }

            const myUsername = interaction.user.username;
            // Get list of my Role Names (to match Target Value)
            const myRoleNames = interaction.member.roles.cache.map(r => r.name);

            const myReminders = [];

            // Schema Mapping from setreminder.js:
            // 0:Text, 1:Time, 2:Date, ... 7:Creator, 10:TargetType, 11:TargetValue, 12:Status
            rows.forEach((row, index) => {
                const text = row[0];
                const inputTime = row[1];
                const inputDate = row[2];
                const creator = row[7];       // Stored as Username
                const targetType = row[10];   // "user" or "role"
                const targetValue = row[11];  // Username or Role Name
                const status = row[12];

                // Only show active reminders
                if (status !== "active") return;

                // CHECK 1: Did I create it?
                const isCreator = (creator === myUsername);

                // CHECK 2: Is it for me? (User Name Match)
                const isDirectTarget = (targetType === "user" && targetValue === myUsername);

                // CHECK 3: Is it for my Role? (Role Name Match)
                const isRoleTarget = (targetType === "role" && myRoleNames.includes(targetValue));

                if (isCreator || isDirectTarget || isRoleTarget) {
                    let icon = "👤"; // Direct
                    if (isRoleTarget) icon = "📢"; // Role
                    if (isCreator && !isDirectTarget) icon = "📤"; // Outgoing

                    // Display Input Date/Time (Human Readable)
                    myReminders.push(`**${index + 2}.** ${icon} \`${inputDate} ${inputTime}\`: ${text}`);
                }
            });

            if (myReminders.length === 0) {
                return interaction.editReply("✅ You have no active reminders.");
            }

            const embed = new EmbedBuilder()
                .setTitle(`⏰ Active Reminders`)
                .setColor(0x0099FF)
                .setDescription(myReminders.slice(0, 15).join("\n"))
                .setFooter({ text: "Matches are based on Exact Username/Role Name." });

            return interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error("ListReminders Error:", err);
            return interaction.editReply("❌ Error fetching reminders.");
        }
    }
};
