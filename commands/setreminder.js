import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- HELPER: Timezone Map ---
const TIMEZONES = {
    "EST": -5, "EDT": -4, "CST": -6, "CDT": -5, "PST": -8, "PDT": -7,
    "MST": -7, "MDT": -6, "GMT": 0, "UTC": 0, "BST": 1, "CET": 1, 
    "CEST": 2, "EET": 2, "EEST": 3, "AEST": 10, "AEDT": 11
};

// --- HELPER: Parse Time String ---
function parseTime(input) {
    const now = Date.now();
    const text = input.trim().toUpperCase();

    // 1. Relative (10m, 2h)
    const relRegex = /^(\d+)(M|H|D)$/;
    const relMatch = text.match(relRegex);
    if (relMatch) {
        const val = parseInt(relMatch[1]);
        const unit = relMatch[2];
        const multipliers = { 'M': 60000, 'H': 3600000, 'D': 86400000 };
        return now + (val * multipliers[unit]);
    }

    // 2. Absolute (Date/Time + Zone)
    let offset = 0;
    let cleanText = text;
    const words = text.split(/[\s,]+/);
    for (const word of words) {
        if (TIMEZONES[word] !== undefined) {
            offset = TIMEZONES[word];
            cleanText = cleanText.replace(word, "").trim();
            break; 
        }
    }

    let dateToParse = cleanText;
    if (dateToParse.match(/^\d{1,2}:\d{2}$/) || dateToParse.match(/^\d{1,2}(AM|PM)$/)) {
        const d = new Date();
        const dateStr = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
        dateToParse = `${dateStr} ${dateToParse}`;
    }

    const timestamp = Date.parse(dateToParse + " UTC");
    if (isNaN(timestamp)) return null;

    return timestamp - (offset * 60 * 60 * 1000);
}

export default {
    data: new SlashCommandBuilder()
        .setName("setreminder")
        .setDescription("Manage advanced reminders.")
        // SET
        .addSubcommand(sub => sub.setName("set").setDescription("Create a reminder.")
            .addStringOption(o => o.setName("time").setDescription("Ex: '10m', '5h', '18:00 EST'").setRequired(true))
            .addStringOption(o => o.setName("message").setDescription("The reminder message").setRequired(true))
            .addStringOption(o => o.setName("repeat").setDescription("Optional: '24h', '7d' for recurring").setRequired(false))
            .addMentionableOption(o => o.setName("target").setDescription("Who to ping? (User or Role)").setRequired(false))
        )
        // LIST
        .addSubcommand(sub => sub.setName("list").setDescription("View active reminders."))
        // REMOVE
        .addSubcommand(sub => sub.setName("remove").setDescription("Delete a reminder.")
            .addIntegerOption(o => o.setName("id").setDescription("The ID from /setreminder list").setRequired(true))
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const channelId = interaction.channelId;

        try {
            // --- SET ---
            if (sub === "set") {
                const timeInput = interaction.options.getString("time");
                const message = interaction.options.getString("message");
                const repeat = interaction.options.getString("repeat") || "None";
                const target = interaction.options.getMentionable("target");
                const targetString = target ? target.toString() : `<@${userId}>`;

                const targetTimestamp = parseTime(timeInput);
                if (!targetTimestamp || targetTimestamp <= Date.now()) {
                    return interaction.editReply("❌ Invalid or past time.");
                }

                const uuid = Math.random().toString(36).substring(2, 8);
                const humanTime = new Date(targetTimestamp).toISOString();

                await sheets.spreadsheets.values.append({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: "Reminders!A:I", // UPDATED RANGE
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: [[
                            userId, channelId, message, targetTimestamp, humanTime, repeat, targetString, uuid, "ACTIVE"
                        ]]
                    }
                });

                const unix = Math.floor(targetTimestamp / 1000);
                let response = `✅ **Reminder Set!**\n📅 <t:${unix}:F>\n📝 "${message}"`;
                if (repeat !== "None") response += `\n🔁 Repeats: ${repeat}`;
                if (repeat === "None") response += `\n⚠️ Includes 30m warning.`;

                return interaction.editReply(response);
            }

            // --- LIST ---
            if (sub === "list") {
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A:F" });
                const rows = res.data.values || [];
                const myReminders = rows.map((r, i) => ({ r, id: i + 1 })).filter(x => x.r[0] === userId);

                if (myReminders.length === 0) return interaction.editReply("📭 No active reminders.");

                const list = myReminders.map(item => {
                    const ts = Math.floor(parseInt(item.r[3]) / 1000);
                    const repeat = item.r[5] && item.r[5] !== "None" ? ` (🔁 ${item.r[5]})` : "";
                    return `**ID ${item.id}:** <t:${ts}:R> — *${item.r[2]}*${repeat}`;
                }).join("\n");

                return interaction.editReply(`**Your Reminders:**\n${list}`);
            }

            // --- REMOVE ---
            if (sub === "remove") {
                const id = interaction.options.getInteger("id");
                const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
                const sheetId = meta.data.sheets.find(s => s.properties.title === "Reminders").properties.sheetId;
                
                await sheets.spreadsheets.batchUpdate({ 
                    spreadsheetId: GOOGLE_SHEET_ID, 
                    requestBody: { requests: [{ deleteDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: id-1, endIndex: id } } }] } 
                });
                return interaction.editReply(`🗑️ Deleted reminder **ID ${id}**.`);
            }

        } catch (err) {
            console.error(err);
            return interaction.editReply("❌ System Error.");
        }
    }
};
