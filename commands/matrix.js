import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- HELPER: Get Date as DD/MON/YYYY ---
function getTodayDate() {
    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleString('en-GB', { month: 'short' }).toUpperCase();
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// --- HELPER: Parse DD/MON/YYYY to Date Object ---
function parseLogDate(dateStr) {
    if (!dateStr) return null;
    
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null; // Must be DD/MON/YYYY

    const day = parseInt(parts[0], 10);
    const monthStr = parts[1].toUpperCase();
    const year = parseInt(parts[2], 10);

    const monthMap = {
        "JAN": 0, "FEB": 1, "MAR": 2, "APR": 3, "MAY": 4, "JUN": 5,
        "JUL": 6, "AUG": 7, "SEP": 8, "OCT": 9, "NOV": 10, "DEC": 11
    };

    const monthIndex = monthMap[monthStr];

    // If month is invalid or parse failed, return null
    if (monthIndex === undefined || isNaN(day) || isNaN(year)) return null;

    return new Date(year, monthIndex, day);
}

// --- HELPER: Get Faction Names ---
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

// --- HELPER: Find Row Number ---
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
                .addUserOption(o => o.setName("lead").setDescription("Team Lead").setRequired(false))
                .addIntegerOption(o => o.setName("tier").setDescription("Starting Tier").setMinValue(0).setMaxValue(9).setRequired(false))
                .addStringOption(o => o.setName("feedback_thread").setDescription("Discord Forum Thread ID").setRequired(false))
                .addStringOption(o => o.setName("forum_link").setDescription("Forum URL").setRequired(false))
                .addStringOption(o => o.setName("discord_link").setDescription("Discord Invite URL").setRequired(false))
        )
        // 2. VIEW FACTION
        .addSubcommand(sub =>
            sub.setName("view")
                .setDescription("View clean faction dashboard & stats.")
                .addStringOption(o => o.setName("name").setDescription("Faction Name").setRequired(true).setAutocomplete(true))
        )
        // 3. VIEW TEAM
        .addSubcommand(sub =>
            sub.setName("viewteam")
                .setDescription("View all factions assigned to a specific Team Lead.")
                .addUserOption(o => o.setName("lead").setDescription("The Team Lead").setRequired(true))
        )
        // SETTERS
        .addSubcommand(sub => sub.setName("settier").setDescription("Update Tier.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addIntegerOption(o => o.setName("tier").setDescription("Tier (1-9)").setMinValue(1).setMaxValue(9).setRequired(true)))
        .addSubcommand(sub => sub.setName("setlead").setDescription("Set Team Lead.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addUserOption(o => o.setName("user").setDescription("New Lead").setRequired(true)))
        .addSubcommand(sub => sub.setName("setthread").setDescription("Set Feedback Thread.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("thread_id").setDescription("ID").setRequired(true)))
        .addSubcommand(sub => sub.setName("setforum").setDescription("Set Forum Link.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("link").setDescription("URL").setRequired(true)))
        .addSubcommand(sub => sub.setName("setdiscord").setDescription("Set Discord Link.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("link").setDescription("URL").setRequired(true)))
        // ACTIONS
        .addSubcommand(sub => sub.setName("swaplead").setDescription("Bulk transfer factions.").addUserOption(o => o.setName("old_lead").setDescription("Old Lead").setRequired(true)).addUserOption(o => o.setName("new_lead").setDescription("New Lead").setRequired(true)))
        .addSubcommand(sub => sub.setName("roster").setDescription("Link Staff to Role.").addUserOption(o => o.setName("user").setDescription("Staff Member").setRequired(true)).addStringOption(o => o.setName("role_id").setDescription("Role ID").setRequired(true)).addStringOption(o => o.setName("team_name").setDescription("Team Name").setRequired(false)))
        .addSubcommand(sub => sub.setName("remove").setDescription("Remove faction.").addStringOption(o => o.setName("name").setDescription("Faction Name").setRequired(true).setAutocomplete(true))),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = await getFactionDataNames();
        const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
        await interaction.respond(filtered.map(c => ({ name: c, value: c })));
    },

    async execute(interaction) {
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

            // --- VIEW FACTION (FIXED DATE PARSING) ---
            if (sub === "view") {
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Faction **${factionName}** not found.`);

                // Fetch Matrix Info
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `FactionData!A${rowNum}:G${rowNum}` });
                const row = res.data.values?.[0] || [];
                // [Name, Lead, Tier, Date, FeedbackID, ForumLink, DiscordLink]

                const leadId = row[1];
                const leadDisplay = (leadId && leadId !== "None") ? `<@${leadId}>` : "_None_";
                
                let roleStatus = "_Not Assigned_";
                if (leadId && leadId !== "None") {
                    const rosterRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "StaffRoster!A:B" });
                    const rosterRow = (rosterRes.data.values || []).find(r => r[0] === leadId);
                    if (rosterRow?.[1]) roleStatus = `<@&${rosterRow[1]}>`;
                }

                // Fetch Stats
                const logsRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Scene Logs!A:C" });
                const logRows = logsRes.data.values || [];
                
                let allTime = 0;
                let monthCount = 0;
                let rewards = [];
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                const targetName = factionName.toLowerCase().trim();

                for (let i = 1; i < logRows.length; i++) {
                    const lFaction = logRows[i][1]?.toLowerCase().trim();
                    if (lFaction === targetName) {
                        allTime++;
                        const lDate = parseLogDate(logRows[i][0]);
                        // Only count if date is valid AND within 30 days
                        if (lDate && lDate >= thirtyDaysAgo) {
                            monthCount++;
                            if (logRows[i][2]) rewards.push(`• ${logRows[i][2]} (${logRows[i][0]})`);
                        }
                    }
                }

                // --- BUILD EXPLICIT LINKS ---
                const feedbackStatus = row[4] ? `Scene Feedback: <1099035227705573427> <#${row[4]}>` : "❌ **Feedback:** Not Set";
                const forumStatus = row[5] ? `[Forum Thread](${row[5]})` : "❌ **Forum:** Not Set";
                const discordStatus = row[6] ? `[Discord](${row[6]})` : "❌ **Discord:** Not Set";
                const linkBlock = `${feedbackStatus}\n${forumStatus}\n${discordStatus}`;

                // --- BUILD EMBED ---
                const embed = new EmbedBuilder()
                    .setTitle(`📂 ${row[0]} - Tier ${row[2] || 0}`)
                    .setColor(0x2b2d31)
                    .addFields(
                        { name: "Information", value: `**Lead:** ${leadDisplay}\n**Team:** ${roleStatus}\n**Promoted:** ${row[3] || "N/A"}`, inline: true },
                        { name: "Scenes Ran", value: `**30 Days:** ${monthCount}\n**All Time:** ${allTime}`, inline: false },
                        { name: "🔗 Quick Links", value: linkBlock, inline: false },
                        { name: "🎁 Recent Rewards", value: rewards.length ? rewards.slice(0, 5).join("\n") : "_No rewards in last 30 days._", inline: false }
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

                const embed = new EmbedBuilder()
                    .setTitle(`📋 Team View: ${leadUser.username}`)
                    .setColor(0xFFA500)
                    .setFooter({ text: `Overseeing ${teamFactions.length} Factions` });

                teamFactions.forEach(r => {
                    const name = r[0];
                    const tier = r[2] || "0";
                    const feed = r[4] ? `<#${r[4]}>` : "❌";
                    const forum = r[5] ? `[Forum](${r[5]})` : "❌";
                    const disc = r[6] ? `[Discord](${r[6]})` : "❌";
                    const line = `Feed: ${feed} • ${forum} • ${disc}`;
                    embed.addFields({ name: `${name} (Tier ${tier})`, value: line, inline: false });
                });

                return interaction.editReply({ embeds: [embed] });
            }

            // --- SETTERS & UTILS ---
            const map = { settier: "C", setlead: "B", setthread: "E", setforum: "F", setdiscord: "G" };
            if (map[sub]) {
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Faction **${factionName}** not found.`);
                
                let val = ""; 
                if (sub === "settier") { 
                    val = interaction.options.getInteger("tier"); 
                    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `FactionData!D${rowNum}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[getTodayDate()]] } }); 
                }
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
