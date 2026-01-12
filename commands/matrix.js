import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- HELPER: Get Date as DD/MON/YYYY (For Matrix Updates) ---
function getTodayDate() {
    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleString('en-GB', { month: 'short' }).toUpperCase();
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// --- HELPER: Parse DD/MM/YYYY string to Date Object (For Log Calculations) ---
function parseLogDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    // Parts: [DD, MM, YYYY] -> Month is 0-indexed in JS
    return new Date(parts[2], parts[1] - 1, parts[0]);
}

// --- HELPER: Get List of Factions from FactionData ---
async function getFactionDataNames() {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "FactionData!A2:A999"
        });
        return (res.data.values || []).flat().map(f => f.trim()).filter(f => f);
    } catch (err) {
        console.error("Error fetching names:", err);
        return [];
    }
}

// --- HELPER: Find Row Number by Faction Name ---
async function findFactionRow(sheetName, factionName) {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A:A`,
        });
        const rows = res.data.values || [];
        const target = factionName.toLowerCase().trim();
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0]?.toLowerCase().trim() === target) return i + 1;
        }
        return null;
    } catch (err) {
        console.error(`Error searching ${sheetName}:`, err);
        return null;
    }
}

// --- HELPER: Get Sheet ID ---
async function getSheetId(title) {
    try {
        const res = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
        const sheet = res.data.sheets.find(s => s.properties.title === title);
        return sheet ? sheet.properties.sheetId : null;
    } catch (err) {
        console.error("Error getting sheet ID:", err);
        return null;
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName("matrix")
        .setDescription("Faction Management System")
        // 1. CREATE
        .addSubcommand(sub =>
            sub.setName("create")
                .setDescription("Initialize a new faction.")
                .addStringOption(o => o.setName("name").setDescription("Faction Name").setRequired(true))
                .addUserOption(o => o.setName("lead").setDescription("Team Lead (Optional)").setRequired(false))
                .addIntegerOption(o => o.setName("tier").setDescription("Starting Tier (Optional)").setMinValue(0).setMaxValue(9).setRequired(false))
                .addStringOption(o => o.setName("feedback_thread").setDescription("Discord Forum Thread ID").setRequired(false))
                .addStringOption(o => o.setName("forum_link").setDescription("Forum URL").setRequired(false))
                .addStringOption(o => o.setName("discord_link").setDescription("Discord Invite URL").setRequired(false))
        )
        // 2. VIEW FACTION (Updated with Stats)
        .addSubcommand(sub =>
            sub.setName("view")
                .setDescription("View full faction dashboard & stats.")
                .addStringOption(o => o.setName("name").setDescription("Faction Name").setRequired(true).setAutocomplete(true))
        )
        // 3. VIEW TEAM
        .addSubcommand(sub =>
            sub.setName("viewteam")
                .setDescription("View all factions assigned to a specific Team Lead.")
                .addUserOption(o => o.setName("lead").setDescription("The Team Lead").setRequired(true))
        )
        // 4. SETTERS...
        .addSubcommand(sub => sub.setName("settier").setDescription("Update Tier.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addIntegerOption(o => o.setName("tier").setDescription("Tier (1-9)").setMinValue(1).setMaxValue(9).setRequired(true)))
        .addSubcommand(sub => sub.setName("setlead").setDescription("Set Team Lead.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addUserOption(o => o.setName("user").setDescription("New Lead").setRequired(true)))
        .addSubcommand(sub => sub.setName("setthread").setDescription("Set Feedback Thread.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("thread_id").setDescription("ID").setRequired(true)))
        .addSubcommand(sub => sub.setName("setforum").setDescription("Set Forum Link.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("link").setDescription("URL").setRequired(true)))
        .addSubcommand(sub => sub.setName("setdiscord").setDescription("Set Discord Link.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("link").setDescription("URL").setRequired(true)))
        // 9. SWAP LEAD
        .addSubcommand(sub => sub.setName("swaplead").setDescription("Bulk transfer factions.").addUserOption(o => o.setName("old_lead").setDescription("Old Lead").setRequired(true)).addUserOption(o => o.setName("new_lead").setDescription("New Lead").setRequired(true)))
        // 10. ROSTER
        .addSubcommand(sub => sub.setName("roster").setDescription("Link Staff to Role.").addUserOption(o => o.setName("user").setDescription("Staff Member").setRequired(true)).addStringOption(o => o.setName("role_id").setDescription("Role ID").setRequired(true)).addStringOption(o => o.setName("team_name").setDescription("Team Name").setRequired(false)))
        // 11. REMOVE
        .addSubcommand(sub => sub.setName("remove").setDescription("Remove faction.").addStringOption(o => o.setName("name").setDescription("Faction Name").setRequired(true).setAutocomplete(true))),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = await getFactionDataNames();
        const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
        await interaction.respond(filtered.map(c => ({ name: c, value: c })));
    },

    async execute(interaction) {
        // --- PERMISSION CONFIG ---
        const ROLE_FM_ID = "1457229857749729363"; 
        const ROLE_LEADERSHIP_ID = "1457670376745074730";

        const hasFM = interaction.member.roles.cache.has(ROLE_FM_ID);
        const hasLeadership = interaction.member.roles.cache.has(ROLE_LEADERSHIP_ID);
        
        const sub = interaction.options.getSubcommand();
        const isView = (sub === 'view' || sub === 'viewteam');

        if (isView) {
            if (!hasFM && !hasLeadership) return interaction.reply({ content: "❌ Permission Denied: [ECRP] Faction Management required.", ephemeral: true });
        } else {
            if (!hasLeadership) return interaction.reply({ content: "❌ Permission Denied: [ECRP] FM Leadership required.", ephemeral: true });
        }

        await interaction.deferReply();
        const factionName = interaction.options.getString("name"); 

        try {
            // --- CREATE ---
            if (sub === "create") {
                if (await findFactionRow("FactionData", factionName)) return interaction.editReply(`❌ **${factionName}** already exists.`);
                
                const leadUser = interaction.options.getUser("lead");
                const tier = interaction.options.getInteger("tier") || 0;
                const feedbackId = interaction.options.getString("feedback_thread") || "";
                const forumLink = interaction.options.getString("forum_link") || "";
                const discordLink = interaction.options.getString("discord_link") || "";
                const today = getTodayDate();
                const leadId = leadUser ? leadUser.id : "None";

                if (!(await findFactionRow("Sheet1", factionName))) {
                    await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range: "Sheet1!A:A", valueInputOption: "USER_ENTERED", requestBody: { values: [[factionName]] } });
                }
                await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range: "FactionData!A:G", valueInputOption: "USER_ENTERED", requestBody: { values: [[factionName, leadId, tier, today, feedbackId, forumLink, discordLink]] } });
                return interaction.editReply(`✅ **${factionName}** created.`);
            }

            // --- VIEW FACTION (WITH SCENE STATS) ---
            if (sub === "view") {
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Faction **${factionName}** not found.`);

                // 1. Fetch Matrix Data
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `FactionData!A${rowNum}:G${rowNum}` });
                const row = res.data.values?.[0] || [];
                
                const leadId = row[1];
                const leadDisplay = (leadId && leadId !== "None") ? `<@${leadId}>` : "None Assigned";
                
                let roleStatus = "❌ Not Set";
                if (leadId && leadId !== "None") {
                    const rosterRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "StaffRoster!A:B" });
                    const rosterRow = (rosterRes.data.values || []).find(r => r[0] === leadId);
                    if (rosterRow?.[1]) roleStatus = `✅ <@&${rosterRow[1]}>`;
                }

                // 2. Fetch Scene Logs Data for Stats
                const logsRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Scene Logs!A:C" }); // Date, Faction, Rewards
                const logRows = logsRes.data.values || []; // Skip header usually at index 0
                
                let allTimeCount = 0;
                let monthCount = 0;
                let recentRewards = [];

                const today = new Date();
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(today.getDate() - 30);
                
                const targetName = factionName.toLowerCase().trim();

                // Loop through logs (Skip index 0 if it's a header "Date")
                for (let i = 1; i < logRows.length; i++) {
                    const logDateStr = logRows[i][0];
                    const logFaction = logRows[i][1]?.toLowerCase().trim();
                    const logReward = logRows[i][2] || "N/A";

                    if (logFaction === targetName) {
                        allTimeCount++;
                        
                        // Parse Date (DD/MM/YYYY)
                        const logDate = parseLogDate(logDateStr);
                        if (logDate && logDate >= thirtyDaysAgo) {
                            monthCount++;
                            recentRewards.push(`• ${logReward} (${logDateStr})`);
                        }
                    }
                }

                // Format Rewards Field (Limit text length)
                let rewardsText = recentRewards.length > 0 ? recentRewards.join("\n") : "_No rewards recorded recently._";
                if (rewardsText.length > 1000) rewardsText = rewardsText.substring(0, 950) + "\n... (truncated)";

                const embed = new EmbedBuilder()
                    .setTitle(`📂 Faction Matrix: ${row[0]}`)
                    .setColor(0x0099FF)
                    .addFields(
                        // Info Row
                        { name: "Faction Name", value: row[0] || "N/A", inline: true },
                        { name: "Team Lead", value: leadDisplay, inline: true },
                        { name: "Current Tier", value: String(row[2] || "0"), inline: true },
                        { name: "Last Promotion", value: row[3] || "N/A", inline: true },
                        { name: "Staff Team", value: roleStatus, inline: true },
                        { name: "\u200b", value: "\u200b", inline: true }, 

                        // Links Row
                        { name: "Feedback Thread", value: row[4] ? `<#${row[4]}>` : "❌ Not Set", inline: false },
                        { name: "Forum Link", value: row[5] ? `[Click Here](${row[5]})` : "❌ Not Set", inline: true },
                        { name: "Discord Link", value: row[6] ? `[Click Here](${row[6]})` : "❌ Not Set", inline: true },

                        // Stats Row (New)
                        { name: "📊 Scene Statistics", value: `**Last 30 Days:** ${monthCount}\n**All Time:** ${allTimeCount}`, inline: false },
                        { name: "🎁 Recent Rewards (30 Days)", value: rewardsText, inline: false }
                    )
                    .setFooter({ text: "[ECRP] Faction Management System" });

                return interaction.editReply({ embeds: [embed] });
            }

            // --- VIEW TEAM ---
            if (sub === "viewteam") {
                const leadUser = interaction.options.getUser("lead");
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "FactionData!A:G" });
                const teamFactions = (res.data.values || []).filter(r => r[1] === leadUser.id);

                if (teamFactions.length === 0) return interaction.editReply(`ℹ️ **${leadUser.tag}** does not lead any factions.`);

                const embed = new EmbedBuilder().setTitle(`📋 Team View: ${leadUser.username}`).setColor(0xFFA500);
                teamFactions.forEach(r => {
                    embed.addFields({ name: `${r[0]} (Tier ${r[2] || 0})`, value: `Links: ${[r[4]?"Feed":"", r[5]?"Forum":"", r[6]?"Disc":""].filter(x=>x).join(", ") || "None"}`, inline: false });
                });
                return interaction.editReply({ embeds: [embed] });
            }

            // --- SETTERS & ACTIONS ---
            // (Collapsed for brevity, logic identical to previous turn)
            const map = { settier: "C", setlead: "B", setthread: "E", setforum: "F", setdiscord: "G" };
            if (map[sub]) {
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Faction **${factionName}** not found.`);
                
                let val = ""; 
                if (sub === "settier") { val = interaction.options.getInteger("tier"); await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `FactionData!D${rowNum}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[getTodayDate()]] } }); }
                else if (sub === "setlead") val = interaction.options.getUser("user").id;
                else val = interaction.options.getString(sub === "setthread" ? "thread_id" : "link");

                await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `FactionData!${map[sub]}${rowNum}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[val]] } });
                return interaction.editReply(`✅ **${factionName}**: Updated ${sub.replace("set", "")}.`);
            }

            if (sub === "swaplead") {
                const oldId = interaction.options.getUser("old_lead").id;
                const newId = interaction.options.getUser("new_lead").id;
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "FactionData!A:G" });
                let rows = res.data.values || [];
                let count = 0;
                for (let i = 1; i < rows.length; i++) { if (rows[i][1] === oldId) { rows[i][1] = newId; count++; } }
                if (count === 0) return interaction.editReply("❌ No factions found.");
                await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: "FactionData!A:G", valueInputOption: "USER_ENTERED", requestBody: { values: rows } });
                return interaction.editReply(`✅ Transferred **${count}** factions.`);
            }

            if (sub === "roster") {
                const uid = interaction.options.getUser("user").id;
                const rid = interaction.options.getString("role_id");
                const tname = interaction.options.getString("team_name") || "Staff";
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "StaffRoster!A:A" });
                const rows = res.data.values || [];
                let idx = rows.findIndex(r => r[0] === uid);
                if (idx > -1) await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `StaffRoster!B${idx+1}:C${idx+1}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[rid, tname]] } });
                else await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range: "StaffRoster!A:C", valueInputOption: "USER_ENTERED", requestBody: { values: [[uid, rid, tname]] } });
                return interaction.editReply(`✅ Roster updated for <@${uid}>.`);
            }

            if (sub === "remove") {
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Not found.`);
                const sid = await getSheetId("FactionData");
                await sheets.spreadsheets.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { requests: [{ deleteDimension: { range: { sheetId: sid, dimension: "ROWS", startIndex: rowNum-1, endIndex: rowNum } } }] } });
                return interaction.editReply(`🗑️ Deleted **${factionName}**.`);
            }

        } catch (err) {
            console.error(err);
            if (!interaction.replied) interaction.editReply("❌ System Error.");
        }
    }
};
