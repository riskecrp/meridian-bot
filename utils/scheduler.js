import cron from "node-cron";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

function getRepeatMilliseconds(str) {
    if (!str || str.toLowerCase() === "none") return 0;
    const match = str.match(/^(\d+)(M|H|D)$/i);
    if (!match) return 0;
    const val = parseInt(match[1]);
    const type = match[2].toUpperCase();
    const mult = { M: 60000, H: 3600000, D: 86400000 };
    return val * mult[type];
}

export function startScheduler(client) {
    // Check every minute
    cron.schedule("* * * * *", async () => {
        try {
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A2:H200" });
            const rows = res.data.values || [];
            if (rows.length === 0) return;

            const now = Date.now();
            const rowsToDelete = [];
            const rowsToUpdate = [];

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!row[3]) continue;

                const triggerTime = parseInt(row[3]);
                const uuid = row[7];

                if (now >= triggerTime) {
                    const channelId = row[1];
                    const msg = row[2];
                    const targetPing = row[6]; // <@User> or <@&Role>

                    try {
                        const channel = await client.channels.fetch(channelId).catch(() => null);
                        if (channel) {
                            const embed = new EmbedBuilder()
                                .setTitle("⏰ Reminder")
                                .setDescription(msg)
                                .setColor(0x00FF00)
                                .setFooter({ text: `ID: ${uuid}` });

                            const buttons = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`snooze_15m`).setLabel("💤 15m").setStyle(ButtonStyle.Secondary),
                                new ButtonBuilder().setCustomId(`snooze_1h`).setLabel("💤 1h").setStyle(ButtonStyle.Secondary),
                                new ButtonBuilder().setCustomId(`dismiss`).setLabel("✅ Acknowledge").setStyle(ButtonStyle.Success)
                            );

                            await channel.send({ 
                                content: `🔔 ${targetPing}`, 
                                embeds: [embed], 
                                components: [buttons] 
                            });
                            console.log(`[CRON] Fired ${uuid}`);
                        }
                    } catch (err) {
                        console.error(`[CRON] Failed ${uuid}:`, err.message);
                    }

                    // Handle Repeat
                    const repeatMs = getRepeatMilliseconds(row[5]);
                    if (repeatMs > 0) {
                        const nextTime = now + repeatMs;
                        rowsToUpdate.push({
                            rowIndex: i + 2,
                            vals: [nextTime, new Date(nextTime).toISOString()]
                        });
                    } else {
                        rowsToDelete.push(i + 2);
                    }
                }
            }

            // Execute Updates
            for (const update of rowsToUpdate) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `Reminders!D${update.rowIndex}:E${update.rowIndex}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [update.vals] }
                });
            }

            // Execute Deletes
            if (rowsToDelete.length > 0) {
                rowsToDelete.sort((a, b) => b - a);
                const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
                const sid = meta.data.sheets.find(s => s.properties.title === "Reminders").properties.sheetId;
                const requests = rowsToDelete.map(idx => ({
                    deleteDimension: { range: { sheetId: sid, dimension: "ROWS", startIndex: idx - 1, endIndex: idx } }
                }));
                await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests } });
            }

        } catch (e) {
            console.error("[CRON] Error:", e);
        }
    });
}
