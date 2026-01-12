import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

export default {
    data: new SlashCommandBuilder()
        .setName("listreminders")
        .setDescription("Show active reminders (Matched by Username or Role Name)."),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch Cols A to O
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Reminders!A2:O999" 
            });

            const rows = res.data.values || [];
            if (rows.length === 0) {
                return interaction.editReply("📭 No active reminders found in the system.");
            }

            const myUsername = interaction.user.username;
            const myRoleNames = interaction.member.roles.cache.map(r => r.name);
            const myReminders = [];

            // Schema: 0=Text, 1=Time, 2=Date ... 7=Creator, 10=TargetType, 11=TargetValue, 12=Status
            rows.forEach((row, index) => {
                const text = row[0];
                const inputTime = row[1];
                const inputDate = row[2];
                const creator = row[7];       
                const targetType = row[10];   
                const targetValue = row[11];  
                const status = (row[12] || "").toLowerCase(); // Normalize to lowercase

                // FILTER: MUST BE ACTIVE
                if (status !== "active") return;

                // Match Logic
                const isCreator = (creator === myUsername);
                const isDirectTarget = (targetType === "user" && targetValue === myUsername);
                const isRoleTarget = (targetType === "role" && myRoleNames.includes(targetValue));

                if (isCreator || isDirectTarget || isRoleTarget) {
                    let icon = "👤"; 
                    if (isRoleTarget) icon = "📢"; 
                    if (isCreator && !isDirectTarget) icon = "📤";

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
                .setFooter({ text: "Matches are based on Username/Role Name." });

            return interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error("ListReminders Error:", err);
            return interaction.editReply("❌ Error fetching reminders.");
        }
    }
};
