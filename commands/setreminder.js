import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";
import { ensureSheetTab, findNextRowInTab } from "../utils/sheetUtils.js";
import { DateTime } from "luxon";

// Helper: Convert user input to UTC immediately
function convertToUTC(date, time, timezone) {
    const paddedTime = time.includes(":") && time.length < 5 ? time.padStart(5, "0") : time;
    const dt = DateTime.fromFormat(`${date} ${paddedTime}`, "yyyy-MM-dd HH:mm", { zone: timezone });
    if (!dt.isValid) return null;
    const utcDt = dt.toUTC();
    return { utcDate: utcDt.toFormat("yyyy-MM-dd"), utcTime: utcDt.toFormat("HH:mm") };
}

const REMINDER_HEADERS = [
    "Reminder Text", "Input Time", "Input Date", "Input Timezone", 
    "UTC Time", "UTC Date", "Recurrence", "Creator", "Creator Role", 
    "Visibility", "Target Type", "Target Value", "Status", "Channel ID", "Channel Name"
];

export default {
    data: new SlashCommandBuilder()
        .setName("setreminder")
        .setDescription("Set a timezone-aware reminder with pings.")
        .addStringOption(o => o.setName("text").setDescription("Content").setRequired(true))
        .addStringOption(o => o.setName("time").setDescription("HH:MM (24h)").setRequired(true))
        .addStringOption(o => o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("Where to ping").addChannelTypes(0).setRequired(true))
        .addStringOption(o => o.setName("target_type").setDescription("User or Role").setRequired(true).addChoices({name:"User", value:"user"},{name:"Role", value:"role"}))
        .addStringOption(o => o.setName("target_value").setDescription("Username or Role Name").setRequired(true))
        .addStringOption(o => o.setName("recurrence").setDescription("Pattern").addChoices({name:"None", value:"none"},{name:"Daily", value:"daily"},{name:"Weekly", value:"weekly"},{name:"Monthly", value:"monthly"}))
        .addStringOption(o => o.setName("timezone").setDescription("Your Timezone (e.g. America/New_York) - Default: UTC")),

    async execute(interaction) {
        // Permission Check (Simplified for your specific roles)
        const memberRoles = interaction.member?.roles?.cache;
        const allowedRoles = ["Team Lead", "Management", "Team Guide", "[ECRP] FM Management"];
        const hasPerms = memberRoles ? memberRoles.some(r => allowedRoles.includes(r.name)) : false;

        if (!hasPerms) {
            return interaction.reply({ content: "❌ Unauthorized.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const text = interaction.options.getString("text");
        const time = interaction.options.getString("time");
        const date = interaction.options.getString("date");
        const channel = interaction.options.getChannel("channel");
        const targetType = interaction.options.getString("target_type");
        const targetValue = interaction.options.getString("target_value");
        const recurrence = interaction.options.getString("recurrence") || "none";
        const timezone = interaction.options.getString("timezone") || "UTC";

        // 1. Convert to UTC Logic
        const utcData = convertToUTC(date, time, timezone);
        if (!utcData) {
            return interaction.editReply(`❌ **Invalid Time/Date/Timezone combination.**`);
        }

        try {
            await ensureSheetTab("Reminders", REMINDER_HEADERS);
            const nextRow = await findNextRowInTab("Reminders", "A");

            // 2. Construct Row (15 Columns)
            const values = [
                text, time, date, timezone,                 // A-D
                utcData.utcTime, utcData.utcDate,           // E-F (The important ones)
                recurrence, interaction.user.username, "FM",// G-I
                "public", targetType, targetValue,          // J-L
                "active", channel.id, channel.name          // M-O
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Reminders!A${nextRow}:O${nextRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [values] }
            });

            return interaction.editReply(
                `✅ **Reminder Set!**\n` +
                `**Target:** ${targetValue} (${targetType})\n` +
                `**Time:** ${date} ${time} (${timezone})\n` +
                `*(Stored as UTC: ${utcData.utcDate} ${utcData.utcTime})*`
            );

        } catch (e) {
            console.error("SETREMINDER ERROR:", e);
            return interaction.editReply("❌ Database Error."); 
        }
    }
};
