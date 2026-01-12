import cron from "node-cron";
import { DateTime } from "luxon";
import { EmbedBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";
import { resolvePing } from "../utils/helpers.js";

export function startReminderCron(client) {
    // Run every minute
    cron.schedule("* * * * *", async () => {
        console.log(`[CRON] Tick.`);
        
        try {
            const res = await sheets.spreadsheets.values.get({ 
                spreadsheetId: GOOGLE_SHEET_ID, 
                range: "Reminders!A2:O100" 
            });
            
            const rows = res.data.values || [];
            if (rows.length === 0) return;

            const now = DateTime.now().setZone("UTC");
            
            // Fetch Guild (Assuming single guild from ENV)
            const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
            if (!guild) return console.error("[CRON] Could not fetch guild.");

            for (let i = 0; i < rows.length; i++) {
                try {
                    const r = rows[i];
                    let status = r[12]?.trim().toLowerCase(); // Column M
                    
                    // SKIP completed rows
                    if (!r || !status || status === "completed") continue;

                    // Parse UTC Time from Columns E (Time) and F (Date)
                    let timeStr = r[4]?.trim();
                    let dateStr = r[5]?.trim();
                    if (timeStr && timeStr.indexOf(":") > -1 && timeStr.length < 5) timeStr = timeStr.padStart(5, "0");

                    const rDt = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: "UTC" });
                    if (!rDt.isValid) continue;

                    const diffMinutes = rDt.diff(now, 'minutes').minutes;
                    const chanId = r[13]; // Column N
                    
                    const channel = await guild.channels.fetch(chanId).catch(() => null);
                    if (!channel) continue;

                    // ─── 1. 30-MINUTE WARNING ───
                    // Condition: Between 20 and 30 mins remaining AND status is 'active'
                    if (status === "active" && diffMinutes <= 30 && diffMinutes > 20) {
                        const mention = await resolvePing(guild, r[10], r[11]); // Type (K), Value (L)
                        
                        const embed = new EmbedBuilder()
                            .setColor(0xffa500) // Orange
                            .setTitle("⏰ 30 Minute Reminder")
                            .setDescription(`**Event:** ${r[0]}\n**Time:** <t:${Math.floor(rDt.toSeconds())}:R>`);

                        await channel.send({ 
                            content: `${mention}`, 
                            embeds: [embed],
                            allowedMentions: { parse: ['users', 'roles'] }
                        });

                        // Update Status to "warned" (Column M)
                        // Note: i + 2 because rows are 0-indexed and we skipped header (Row 1)
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                            valueInputOption: "USER_ENTERED", requestBody: { values: [["warned"]] }
                        });
                    }

                    // ─── 2. FINAL ALERT ───
                    // Condition: Between 0 and -10 mins (passed recently)
                    if (diffMinutes <= 0 && diffMinutes > -10) {
                        const mention = await resolvePing(guild, r[10], r[11]);

                        const embed = new EmbedBuilder()
                            .setColor(0xff0000) // Red
                            .setTitle("🔔 Last Reminder")
                            .setDescription(`**Happening Now:** ${r[0]}`);

                        await channel.send({ 
                            content: `${mention}`, 
                            embeds: [embed],
                            allowedMentions: { parse: ['users', 'roles'] }
                        });

                        // ─── HANDLE COMPLETION / RECURRENCE ───
                        const recurrence = r[6]?.toLowerCase(); // Column G
                        
                        if (recurrence === "none" || !recurrence) {
                            // Mark Completed
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                                valueInputOption: "USER_ENTERED", 
                                requestBody: { values: [["completed"]] }
                            });
                        } else {
                            // Calculate Next Occurrence
                            let nextDt = rDt;
                            if (recurrence === "daily") nextDt = rDt.plus({ days: 1 });
                            if (recurrence === "weekly") nextDt = rDt.plus({ weeks: 1 });
                            if (recurrence === "monthly") nextDt = rDt.plus({ months: 1 });

                            // Update UTC Time/Date (Cols E & F) AND Reset Status (Col M)
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!E${i + 2}:F${i + 2}`,
                                valueInputOption: "USER_ENTERED", 
                                requestBody: { values: [[nextDt.toFormat("HH:mm"), nextDt.toFormat("yyyy-MM-dd")]] }
                            });
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                                valueInputOption: "USER_ENTERED", 
                                requestBody: { values: [["active"]] }
                            });
                        }
                    }

                } catch (err) {
                    console.error(`[ROW ERROR] Index ${i}:`, err.message);
                }
            }
        } catch (e) { console.error("[CRON FATAL]", e.message); }
    });
}
