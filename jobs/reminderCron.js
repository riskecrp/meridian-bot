import cron from "node-cron";
import { DateTime } from "luxon";
import { EmbedBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";
import { resolvePing } from "../utils/helpers.js";

export function startReminderCron(client) {
    // Run every minute
    cron.schedule("* * * * *", async () => {
        console.log(`[CRON] Tick. Checking...`); // LOG 1: Heartbeat
        
        try {
            const res = await sheets.spreadsheets.values.get({ 
                spreadsheetId: GOOGLE_SHEET_ID, 
                range: "Reminders!A2:O100" 
            });
            
            const rows = res.data.values || [];
            if (rows.length === 0) {
                console.log("[CRON] No reminders found in sheet.");
                return;
            }

            const now = DateTime.now().setZone("UTC");
            console.log(`[CRON] System Time (UTC): ${now.toFormat("HH:mm")}`);

            const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
            if (!guild) {
                console.error("[CRON] ERROR: Could not fetch Guild. Check GUILD_ID in variables.");
                return;
            }

            for (let i = 0; i < rows.length; i++) {
                try {
                    const r = rows[i];
                    let status = r[12]?.trim().toLowerCase(); 
                    
                    if (!r || status === "completed") continue;

                    // DEBUGGING DATA
                    let timeStr = r[4]?.trim(); // Column E (UTC Time)
                    let dateStr = r[5]?.trim(); // Column F (UTC Date)
                    
                    // Fix HH:MM padding if needed
                    if (timeStr && timeStr.indexOf(":") > -1 && timeStr.length < 5) timeStr = timeStr.padStart(5, "0");

                    // Try parsing
                    // We try ISO format first (YYYY-MM-DD), then slash format (MM/DD/YYYY) just in case Sheets messed it up
                    let rDt = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: "UTC" });
                    
                    if (!rDt.isValid) {
                        // Fallback: Try parsing M/d/yyyy format if Google Sheets auto-formatted it
                        rDt = DateTime.fromFormat(`${dateStr} ${timeStr}`, "M/d/yyyy HH:mm", { zone: "UTC" });
                    }

                    if (!rDt.isValid) {
                        console.log(`[CRON] Row ${i+2} Invalid Date: "${dateStr} ${timeStr}"`);
                        continue;
                    }

                    const diffMinutes = rDt.diff(now, 'minutes').minutes;
                    
                    // LOGGING THE MATH
                    // Only log active rows to keep logs cleanish
                    if (status === "active") {
                        console.log(`[CRON] Row ${i+2}: Target ${rDt.toFormat("HH:mm")} | Now ${now.toFormat("HH:mm")} | Diff: ${diffMinutes.toFixed(2)} mins`);
                    }

                    const chanId = r[13]; 
                    const channel = await guild.channels.fetch(chanId).catch(() => null);
                    
                    if (!channel) {
                        console.log(`[CRON] Row ${i+2}: Channel ${chanId} not found.`);
                        continue;
                    }

                    // ─── CHECK TRIGGER ───
                    
                    // 1. 30-MINUTE WARNING (20 to 30 mins)
                    if (status === "active" && diffMinutes <= 30 && diffMinutes > 20) {
                        console.log(`[CRON] Triggering WARNING for Row ${i+2}`);
                        const mention = await resolvePing(guild, r[10], r[11]);
                        
                        const embed = new EmbedBuilder()
                            .setColor(0xffa500)
                            .setTitle("⏰ 30 Minute Reminder")
                            .setDescription(`**Event:** ${r[0]}\n**Time:** <t:${Math.floor(rDt.toSeconds())}:R>`);

                        await channel.send({ 
                            content: `${mention}`, 
                            embeds: [embed],
                            allowedMentions: { parse: ['users', 'roles'] }
                        });

                        await sheets.spreadsheets.values.update({
                            spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                            valueInputOption: "USER_ENTERED", requestBody: { values: [["warned"]] }
                        });
                    }

                    // 2. FINAL ALERT (0 to -10 mins)
                    if (diffMinutes <= 0 && diffMinutes > -10) {
                        console.log(`[CRON] Triggering FINAL ALERT for Row ${i+2}`);
                        const mention = await resolvePing(guild, r[10], r[11]);

                        const embed = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle("🔔 Last Reminder")
                            .setDescription(`**Happening Now:** ${r[0]}`);

                        await channel.send({ 
                            content: `${mention}`, 
                            embeds: [embed],
                            allowedMentions: { parse: ['users', 'roles'] }
                        });

                        // MARK COMPLETE / RECUR
                        const recurrence = r[6]?.toLowerCase();
                        if (recurrence === "none" || !recurrence) {
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                                valueInputOption: "USER_ENTERED", requestBody: { values: [["completed"]] }
                            });
                        } else {
                            // Handle recurrence logic...
                            let nextDt = rDt;
                            if (recurrence === "daily") nextDt = rDt.plus({ days: 1 });
                            if (recurrence === "weekly") nextDt = rDt.plus({ weeks: 1 });
                            if (recurrence === "monthly") nextDt = rDt.plus({ months: 1 });

                            await sheets.spreadsheets.values.update({
                                spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!E${i + 2}:F${i + 2}`,
                                valueInputOption: "USER_ENTERED", 
                                requestBody: { values: [[nextDt.toFormat("HH:mm"), nextDt.toFormat("yyyy-MM-dd")]] }
                            });
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                                valueInputOption: "USER_ENTERED", requestBody: { values: [["active"]] }
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
