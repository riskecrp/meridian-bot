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
    cron.schedule("* * * * *", async () => {
        try {
            // Read A-I (include Status col)
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A2:I200" });
            const rows = res.data.values || [];
            if (rows.length === 0) return;

            const now = Date.now();
            const rowsToDelete = [];
            const rowsToUpdate = [];
            const statusUpdates = []; // For marking "WARNED"

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!row[3]) continue;

                const triggerTime = parseInt(row[3]);
                const repeat = row[5] || "None";
                const uuid = row[7];
                const status = row[8] || ""; // Col I

                const diffMinutes = (triggerTime - now) / 1000 / 60;
                
                // 1. CHECK FOR 30m WARNING
                // Condition: Within 30 mins, Not Recurring, Not already warned
                if (repeat === "None" && diffMinutes <= 30 && diffMinutes > 0 && status !== "WARNED") {
                    const channelId = row[1];
                    const msg = row[2];
                    const targetPing = row[6];

                    try {
                        const channel = await client.channels.fetch(channelId).catch(() => null);
                        if (channel) {
                            const embed = new EmbedBuilder()
                                .setTitle("⚠️ 30 Minute Reminder")
                                .setDescription(`${msg}\n\n**Starting:** <t:${Math.floor(triggerTime/1000)}:R>`)
                                .setColor(0xFFA500); // Orange

                            await channel.send({ 
                                content: `${targetPing}`, 
                                embeds: [embed] 
                            });
                            
                            // Mark as WARNED so we don't spam
                            statusUpdates.push({ rowIndex: i + 2, val: "WARNED" });
                        }
                    } catch (e) { console.error(e); }
                }

                // 2. CHECK FOR FINAL TRIGGER
                if (now >= triggerTime) {
                    const channelId = row[1];
                    const msg = row[2];
                    const targetPing = row[6];

                    try {
                        const channel = await client.channels.fetch(channelId).catch(() => null);
                        if (channel) {
                            const embed = new EmbedBuilder()
                                .setTitle("Due Now")
                                .setDescription(msg)
                                .setColor(0x00FF00) // Green
                                .setFooter({ text: `ID: ${uuid}` });

                            const buttons = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`snooze_15m`).setLabel("💤 15m").setStyle(ButtonStyle.Secondary),
                                new ButtonBuilder().setCustomId(`snooze_1h`).setLabel("💤 1h").setStyle(ButtonStyle.Secondary),
                                new ButtonBuilder().setCustomId(`dismiss`).setLabel("✅ Acknowledge").setStyle(ButtonStyle.Success)
                            );

                            await channel.send({ 
                                content: `🚨 ${targetPing}`, 
                                embeds: [embed], 
                                components: [buttons] 
                            });
                        }
                    } catch (err) { console.error(err); }

                    // Handle Repeat vs Delete
                    const repeatMs = getRepeatMilliseconds(repeat);
                    if (repeatMs > 0) {
                        const nextTime = now + repeatMs;
                        rowsToUpdate.push({
                            rowIndex: i + 2,
                            vals: [nextTime, new Date(nextTime).toISOString()]
                        });
                        // Reset status to ACTIVE for next cycle
                        statusUpdates.push({ rowIndex: i + 2, val: "ACTIVE" });
                    } else {
                        rowsToDelete.push(i + 2);
                    }
                }
            }

            // EXECUTE SHEET WRITES
            // 1. Status Updates (Warnings)
            for (const up of statusUpdates) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `Reminders!I${up.rowIndex}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [[up.val]] }
                });
            }

            // 2. Time Updates (Recurring)
            for (const up of rowsToUpdate) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `Reminders!D${up.rowIndex}:E${up.rowIndex}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [up.vals] }
                });
            }

            // 3. Deletions
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
