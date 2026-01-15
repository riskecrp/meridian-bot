import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- HELPER: Get Date ---
function getTodayDate() {
    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleString('en-GB', { month: 'short' }).toUpperCase();
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// --- HELPER: Parse Date ---
function parseLogDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const monthMap = { "JAN": 0, "FEB": 1, "MAR": 2, "APR": 3, "MAY": 4, "JUN": 5, "JUL": 6, "AUG": 7, "SEP": 8, "OCT": 9, "NOV": 10, "DEC": 11 };
    return new Date(parseInt(parts[2], 10), monthMap[parts[1].toUpperCase()], parseInt(parts[0], 10));
}

// --- HELPER: Get Faction Names ---
async function getFactionDataNames() {
    try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "FactionData!A2:A999" });
        return (res.data.values || []).flat().map(f => f.trim()).filter(f => f);
    } catch (err) { return []; }
}

// --- HELPER: Find Row ---
async function findFactionRow(sheetName, factionName) {
    try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${sheetName}!A:A` });
        const rows = res.data.values || [];
        const target = factionName.toLowerCase().trim();
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0]?.toLowerCase().trim() === target) return i + 1;
        }
        return null;
    } catch (err) { return null; }
}

// --- HELPER: Get Sheet ID ---
async function getSheetId(title) {
    try {
        const res = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
        return res.data.sheets.find(s => s.properties.title === title)?.properties.sheetId;
    } catch (err) { return null; }
}

export default {
    data: new SlashCommandBuilder()
        .setName("matrix")
        .setDescription("Faction Management System")
        .addSubcommand(sub => sub.setName("overview").setDescription("View the full Staff Roster & Team hierarchy."))
        .addSubcommand(sub => sub.setName("create").setDescription("Initialize a new faction.")
            .addStringOption(o => o.setName("name").setDescription("Faction Name").setRequired(true))
            .addUserOption(o => o.setName("lead").setDescription("Team Lead").setRequired(false))
            .addIntegerOption(o => o.setName("tier").setDescription("Starting Tier").setMinValue(0).setMaxValue(9).setRequired(false))
            .addStringOption(o => o.setName("feedback_thread").setDescription("Discord Forum Thread ID").setRequired(false))
            .addStringOption(o => o.setName("forum_link").setDescription("Forum URL").setRequired(false))
            .addStringOption(o => o.setName("discord_link").setDescription("Discord Invite URL").setRequired(false))
        )
        .addSubcommand(sub => sub.setName("view").setDescription("View clean faction dashboard & stats.")
            .addStringOption(o => o.setName("name").setDescription("Faction Name").setRequired(true).setAutocomplete(true))
        )
        .addSubcommand(sub => sub.setName("viewteam").setDescription("View detailed Report for a specific Staff Member.")
            .addUserOption(o => o.setName("user").setDescription("The Staff Member").setRequired(true))
        )
        // SETTERS
        .addSubcommand(sub => sub.setName("settier").setDescription("Update Tier.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addIntegerOption(o => o.setName("tier").setDescription("Tier (1-9)").setMinValue(1).setMaxValue(9).setRequired(true)))
        .addSubcommand(sub => sub.setName("setlead").setDescription("Set Team Lead.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addUserOption(o => o.setName("user").setDescription("New Lead").setRequired(true)))
        .addSubcommand(sub => sub.setName("setthread").setDescription("Set Feedback Thread.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("thread_id").setDescription("ID").setRequired(true)))
        .addSubcommand(sub => sub.setName("setforum").setDescription("Set Forum Link.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("link").setDescription("URL").setRequired(true)))
        .addSubcommand(sub => sub.setName("setdiscord").setDescription("Set Discord Link.").addStringOption(o => o.setName("name").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("link").setDescription("URL").setRequired(true)))
        // ACTIONS
        .addSubcommand(sub => sub.setName("swaplead").setDescription("Bulk transfer factions.").addUserOption(o => o.setName("old_lead").setDescription("Old Lead").setRequired(true)).addUserOption(o => o.setName("new_lead").setDescription("New Lead").setRequired(true)))
        .addSubcommand(sub => sub.setName("roster").setDescription("Add/Update Staff Member in Matrix.")
            .addUserOption(o => o.setName("user").setDescription("Staff Member").setRequired(true))
            .addRoleOption(o => o.setName("role").setDescription("The Team/Ping Role").setRequired(true))
            .addStringOption(o => o.setName("rank").setDescription("Staff Rank").setRequired(true)
                .addChoices({ name: "Team Lead", value: "Lead" }, { name: "Team Guide", value: "Guide" }))
        )
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
        const isView = (sub === 'view' || sub === 'viewteam' || sub === 'overview');

        if (isView) {
            if (!hasFM && !hasLeadership) return interaction.reply({ content: "❌ Permission Denied: [ECRP] Faction Management required.", ephemeral: true });
        } else {
            if (!hasLeadership) return interaction.reply({ content: "❌ Permission Denied: [ECRP] FM Leadership required.", ephemeral: true });
        }

        await interaction.deferReply();
        const factionName = interaction.options.getString("name"); 

        try {
            // --- OVERVIEW ---
            if (sub === "overview") {
                const rosterRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "StaffRoster!A:C" });
                const factionRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "FactionData!A:G" });

                const rawRoster = rosterRes.data.values || [];
                const roster = rawRoster.filter(r => r[0] && r[1] && r[0].toLowerCase() !== "user id");
                const allFactions = factionRes.data.values || [];

                if (roster.length === 0) return interaction.editReply("❌ Staff Roster is empty.");

                const teams = {};
                roster.forEach(row => {
                    const userId = row[0];
                    const roleId = row[1];
                    const rank = row[2]?.toLowerCase() || "";
                    if (!teams[roleId]) teams[roleId] = { leads: [], guides: [], teamIds: [] };
                    teams[roleId].teamIds.push(userId);
                    if (rank.includes("lead")) teams[roleId].leads.push(userId);
                    else teams[roleId].guides.push(userId);
                });

                const embed = new EmbedBuilder()
                    .setTitle("🛡️ FM Team Overview")
                    .setColor(0x0099FF)
                    .setTimestamp();

                for (const [roleId, data] of Object.entries(teams)) {
                    const roleObj = interaction.guild.roles.cache.get(roleId);
                    const teamName = roleObj ? roleObj.name : "Unknown Team";

                    const leadText = data.leads.length > 0 ? data.leads.map(id => `<@${id}>`).join(", ") : "_Vacant_";
                    const guideText = data.guides.length > 0 ? data.guides.map(id => `<@${id}>`).join(" | ") : "_None_";
                    const teamFactions = allFactions.filter(f => data.teamIds.includes(f[1]));

                    const staffBlock = `**Team Lead:**\n${leadText}\n\n**Team Members:**\n${guideText}`;

                    // PREPARE ATOMIC BLOCKS
                    const factionBlocks = teamFactions.map(f => {
                        const name = f[0];
                        const tier = f[2] || "0";
                        const feed = f[4] ? `[Feedback](https://discord.com/channels/${interaction.guildId}/${f[4]})` : "❌";
                        const forum = f[5] ? `[Forum](${f[5]})` : "❌";
                        const disc = f[6] ? `[Discord](${f[6]})` : "❌";
                        return `> • **${name}** (T${tier})\n> └ ${disc} • ${feed} • ${forum}`;
                    });

                    // CHUNKING LOGIC (ATOMIC)
                    let currentChunk = "";
                    const chunks = [];
                    for (const block of factionBlocks) {
                        const separator = currentChunk.length > 0 ? "\n> \n" : "";
                        if ((currentChunk + separator + block).length > 1000) {
                            chunks.push(currentChunk);
                            currentChunk = block;
                        } else {
                            currentChunk += separator + block;
                        }
                    }
                    if (currentChunk) chunks.push(currentChunk);

                    // DISPLAY LOGIC
                    if (chunks.length === 0) {
                        embed.addFields({ name: `🛡️ ${teamName}`, value: `${staffBlock}\n\n**Team Factions:**\n> _No assigned factions._`, inline: false });
                    } else {
                        // Try combining staff + first chunk
                        const combinedStart = `${staffBlock}\n\n**Team Factions:**\n${chunks[0]}`;
                        if (combinedStart.length <= 1024 && chunks.length === 1) {
                             embed.addFields({ name: `🛡️ ${teamName}`, value: combinedStart, inline: false });
                        } else {
                            embed.addFields({ name: `🛡️ ${teamName}`, value: staffBlock, inline: false });
                            chunks.forEach((chunk, i) => {
                                embed.addFields({ name: i === 0 ? `> ${teamName} Factions` : `> ...continued`, value: chunk, inline: false });
                            });
                        }
                    }
                }

                return interaction.editReply({ embeds: [embed] });
            }

            // --- VIEW TEAM (ATOMIC FIX) ---
            if (sub === "viewteam") {
                const targetUser = interaction.options.getUser("user");
                const rosterRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "StaffRoster!A:C" });
                const rosterRows = rosterRes.data.values || [];
                
                const staffEntry = rosterRows.find(r => r[0] === targetUser.id);
                if (!staffEntry) return interaction.editReply(`❌ **${targetUser.username}** is not in the Staff Roster.`);

                const myRoleId = staffEntry[1];
                const roleObj = interaction.guild.roles.cache.get(myRoleId);
                const teamName = roleObj ? roleObj.name : "Unknown Team";

                const teamMembers = rosterRows.filter(r => r[1] === myRoleId);
                const teamIds = teamMembers.map(r => r[0]); 
                const leads = teamMembers.filter(r => r[2]?.toLowerCase().includes("lead")).map(r => r[0]);
                const guides = teamMembers.filter(r => !r[2]?.toLowerCase().includes("lead")).map(r => r[0]);

                const factionRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "FactionData!A:G" });
                const allFactions = factionRes.data.values || [];
                const teamFactions = allFactions.filter(r => teamIds.includes(r[1]));

                const embed = new EmbedBuilder()
                    .setTitle(`🛡️ Team Report`)
                    .setColor(0xFFA500);

                const leadText = leads.length > 0 ? leads.map(id => `<@${id}>`).join(", ") : "_Vacant_";
                const guideText = guides.length > 0 ? guides.map(id => `<@${id}>`).join(" | ") : "_None_";
                const staffBlock = `**Team Lead:**\n${leadText}\n\n**Team Members:**\n${guideText}`;

                // ATOMIC BLOCK & CHUNKING
                const factionBlocks = teamFactions.map(f => {
                    const name = f[0];
                    const tier = f[2] || "0";
                    const feed = f[4] ? `[Feedback](https://discord.com/channels/${interaction.guildId}/${f[4]})` : "❌";
                    const forum = f[5] ? `[Forum](${f[5]})` : "❌";
                    const disc = f[6] ? `[Discord](${f[6]})` : "❌";
                    return `> • **${name}** (T${tier})\n> └ ${disc} • ${feed} • ${forum}`;
                });

                let currentChunk = "";
                const chunks = [];
                for (const block of factionBlocks) {
                    const separator = currentChunk.length > 0 ? "\n> \n" : "";
                    if ((currentChunk + separator + block).length > 1000) {
                        chunks.push(currentChunk);
                        currentChunk = block;
                    } else {
                        currentChunk += separator + block;
                    }
                }
                if (currentChunk) chunks.push(currentChunk);

                // DISPLAY LOGIC
                if (chunks.length === 0) {
                     embed.addFields({ name: `🛡️ ${teamName}`, value: staffBlock, inline: false });
                } else {
                    const combinedStart = `${staffBlock}\n\n**Team Factions:**\n${chunks[0]}`;
                    if (combinedStart.length <= 1024 && chunks.length === 1) {
                        embed.addFields({ name: `🛡️ ${teamName}`, value: combinedStart, inline: false });
                    } else {
                        embed.addFields({ name: `🛡️ ${teamName}`, value: staffBlock, inline: false });
                        chunks.forEach((chunk, i) => {
                            embed.addFields({ name: i === 0 ? `> ${teamName} Factions` : `> ...continued`, value: chunk, inline: false });
                        });
                    }
                }

                return interaction.editReply({ embeds: [embed] });
            }

            // --- VIEW FACTION ---
            if (sub === "view") {
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Faction **${factionName}** not found.`);
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `FactionData!A${rowNum}:G${rowNum}` });
                const row = res.data.values?.[0] || [];
                const leadId = row[1];
                const leadDisplay = (leadId && leadId !== "None") ? `<@${leadId}>` : "_None_";
                
                let teamRoleDisplay = "_Not Assigned_";
                if (leadId && leadId !== "None") {
                    const rosterRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "StaffRoster!A:C" });
                    const rosterRow = (rosterRes.data.values || []).find(r => r[0] === leadId);
                    if (rosterRow) {
                        teamRoleDisplay = `<@&${rosterRow[1]}>`; 
                    }
                }

                const logsRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Scene Logs!A:C" });
                const logRows = logsRes.data.values || [];
                let allTime = 0; let monthCount = 0; let rewards = [];
                const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                const targetName = factionName.toLowerCase().trim();
                for (let i = 1; i < logRows.length; i++) {
                    const lFaction = logRows[i][1]?.toLowerCase().trim();
                    if (lFaction === targetName) {
                        allTime++;
                        const lDate = parseLogDate(logRows[i][0]);
                        if (lDate && lDate >= thirtyDaysAgo) {
                            monthCount++;
                            if (logRows[i][2]) rewards.push(`• ${logRows[i][2]} (${logRows[i][0]})`);
                        }
                    }
                }

                const feedbackLink = row[4] ? `💬 <#${row[4]}>` : "💬 ❌";
                const forumLink = row[5] ? `📄 [Forum](${row[5]})` : "📄 ❌";
                const discordLink = row[6] ? `🔊 [Discord](${row[6]})` : "🔊 ❌";
                const linkBlock = `${discordLink} • ${feedbackLink} • ${forumLink}`;
                const infoBlock = `**Last Promoted:** ${row[3] || "N/A"}\n**Lead:** ${leadDisplay}\n**Team:** ${teamRoleDisplay}`;

                const embed = new EmbedBuilder().setTitle(`📂 ${row[0]} - Tier ${row[2] || 0}`).setColor(0x2b2d31).addFields(
                        { name: "➡️ Information", value: infoBlock, inline: true },
                        { name: "➡️ Scenes Ran", value: `**30 Days:** ${monthCount}\n**All Time:** ${allTime}`, inline: false },
                        { name: "🔗 Quick Links", value: linkBlock, inline: false },
                        { name: "🎁 Recent Rewards", value: rewards.length ? rewards.slice(0, 5).join("\n") : "_No rewards in last 30 days._", inline: false }
                    ).setFooter({ text: "[ECRP] Faction Management System" });
                return interaction.editReply({ embeds: [embed] });
            }

            // --- ROSTER ---
            if (sub === "roster") {
                const user = interaction.options.getUser("user");
                const role = interaction.options.getRole("role");
                const rank = interaction.options.getString("rank");
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "StaffRoster!A:A" });
                const rows = (res.data.values || []).flat();
                const rowIndex = rows.indexOf(user.id);
                const rowData = [user.id, role.id, rank];
                if (rowIndex > -1) {
                    const sheetRow = rowIndex + 1;
                    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `StaffRoster!A${sheetRow}:C${sheetRow}`, valueInputOption: "USER_ENTERED", requestBody: { values: [rowData] } });
                    return interaction.editReply(`✅ **Updated:** ${user} is now **${rank}** of ${role}.`);
                } else {
                    await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range: "StaffRoster!A:C", valueInputOption: "USER_ENTERED", requestBody: { values: [rowData] } });
                    return interaction.editReply(`✅ **Added:** ${user} as **${rank}** of ${role}.`);
                }
            }

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

            // --- SETTERS & ACTIONS ---
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
