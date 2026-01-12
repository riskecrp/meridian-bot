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

// --- HELPER: Get List of Factions from FactionData ---
async function getFactionDataNames() {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "FactionData!A2:A999" // Skipping Header Row 1
        });
        const rows = res.data.values || [];
        return rows.flat().map(f => f.trim()).filter(f => f);
    } catch (err) {
        console.error("Error fetching FactionData names:", err);
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
            const cell = rows[i][0];
            if (cell && cell.toLowerCase().trim() === target) {
                return i + 1; // 1-based row index
            }
        }
        return null;
    } catch (err) {
        console.error(`Error searching ${sheetName}:`, err);
        return null;
    }
}

// --- HELPER: Get Sheet ID by Title (Required for deletion) ---
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
        )
        // 2. VIEW
        .addSubcommand(sub =>
            sub.setName("view")
                .setDescription("View faction status.")
                .addStringOption(o => 
                    o.setName("name")
                     .setDescription("Faction Name")
                     .setRequired(true)
                     .setAutocomplete(true)
                )
        )
        // 3. SET TIER
        .addSubcommand(sub =>
            sub.setName("settier")
                .setDescription("Update Tier & Date.")
                .addStringOption(o => 
                    o.setName("name")
                     .setDescription("Faction Name")
                     .setRequired(true)
                     .setAutocomplete(true)
                )
                .addIntegerOption(o => o.setName("tier").setDescription("New Tier (1-9)").setMinValue(1).setMaxValue(9).setRequired(true))
        )
        // 4. SET LEAD (Single Faction)
        .addSubcommand(sub =>
            sub.setName("setlead")
                .setDescription("Assign/Replace Team Lead for ONE faction.")
                .addStringOption(o => 
                    o.setName("name")
                     .setDescription("Faction Name")
                     .setRequired(true)
                     .setAutocomplete(true)
                )
                .addUserOption(o => o.setName("user").setDescription("The New Team Lead").setRequired(true))
        )
        // 5. SET THREAD (Link Forum Thread)
        .addSubcommand(sub =>
            sub.setName("setthread")
                .setDescription("Link a Discord Forum Thread ID to this faction.")
                .addStringOption(o => 
                    o.setName("name")
                     .setDescription("Faction Name")
                     .setRequired(true)
                     .setAutocomplete(true)
                )
                .addStringOption(o => o.setName("thread_id").setDescription("The Forum Thread ID").setRequired(true))
        )
        // 6. SWAP LEAD (Bulk Replace)
        .addSubcommand(sub =>
            sub.setName("swaplead")
                .setDescription("Transfer ALL factions from Old Lead to New Lead.")
                .addUserOption(o => o.setName("old_lead").setDescription("Current Team Lead").setRequired(true))
                .addUserOption(o => o.setName("new_lead").setDescription("New Team Lead").setRequired(true))
        )
        // 7. UPDATE ROSTER
        .addSubcommand(sub =>
            sub.setName("roster")
                .setDescription("Link a Staff Member to a Team Role (for Feedback pings).")
                .addUserOption(o => o.setName("user").setDescription("The Staff Member").setRequired(true))
                .addStringOption(o => o.setName("role_id").setDescription("The Role ID to ping").setRequired(true))
                .addStringOption(o => o.setName("team_name").setDescription("Team Name (Optional reference)").setRequired(false))
        )
        // 8. REMOVE
        .addSubcommand(sub =>
            sub.setName("remove")
                .setDescription("Remove a faction from the Matrix.")
                .addStringOption(o => 
                    o.setName("name")
                     .setDescription("Faction Name")
                     .setRequired(true)
                     .setAutocomplete(true)
                )
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const choices = await getFactionDataNames();
        const filtered = choices
            .filter(choice => choice.toLowerCase().includes(focusedValue))
            .slice(0, 25);
        await interaction.respond(filtered.map(choice => ({ name: choice, value: choice })));
    },

    async execute(interaction) {
        // --- PERMISSION CONFIG ---
        const ROLE_FM_ID = "1457229857749729363";       // [ECRP] Faction Management
        const ROLE_LEADERSHIP_ID = "1457670376745074730"; // [ECRP] FM Leadership

        const hasFM = interaction.member.roles.cache.has(ROLE_FM_ID);
        const hasLeadership = interaction.member.roles.cache.has(ROLE_LEADERSHIP_ID);
        
        const sub = interaction.options.getSubcommand();

        // 1. Permission Check for VIEW
        if (sub === 'view') {
            if (!hasFM && !hasLeadership) {
                return interaction.reply({ content: "❌ You need the **[ECRP] Faction Management** role to view this.", ephemeral: true });
            }
        } 
        // 2. Permission Check for ALL OTHER COMMANDS
        else {
            if (!hasLeadership) {
                return interaction.reply({ content: "❌ Restricted to **[ECRP] FM Leadership**.", ephemeral: true });
            }
        }

        await interaction.deferReply();
        const factionName = interaction.options.getString("name"); // Will be null for 'swaplead' or 'roster'

        try {
            // --- CREATE ---
            if (sub === "create") {
                const masterRow = await findFactionRow("Sheet1", factionName);
                if (!masterRow) {
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        range: "Sheet1!A:A",
                        valueInputOption: "USER_ENTERED",
                        requestBody: { values: [[factionName]] }
                    });
                }

                const dataRow = await findFactionRow("FactionData", factionName);
                if (dataRow) {
                    return interaction.editReply(`❌ **${factionName}** already exists in FactionData.`);
                }

                const today = getTodayDate();
                await sheets.spreadsheets.values.append({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: "FactionData!A:E",
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [[factionName, "None", "0", today, ""]] }
                });

                return interaction.editReply(`✅ **${factionName}** initialized in the Matrix.`);
            }

            // --- VIEW ---
            if (sub === "view") {
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Could not find **${factionName}** in FactionData.`);

                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `FactionData!A${rowNum}:E${rowNum}`
                });

                const row = res.data.values ? res.data.values[0] : [];
                // row = [Name, LeadID, Tier, Date, ThreadID]

                const leadId = row[1];
                const leadDisplay = (leadId && leadId !== "None") ? `<@${leadId}>` : "None Assigned";
                
                const threadStatus = row[4] ? `✅ Linked (<#${row[4]}>)` : "❌ Not Set";

                // Resolve Team Role via StaffRoster
                let roleStatus = "❌ Not Set";
                if (leadId && leadId !== "None") {
                     const rosterRes = await sheets.spreadsheets.values.get({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        range: "StaffRoster!A:B" 
                    });
                    const rosterRow = (rosterRes.data.values || []).find(r => r[0] === leadId);
                    if (rosterRow && rosterRow[1]) {
                        roleStatus = `✅ <@&${rosterRow[1]}>`;
                    } else {
                        roleStatus = "⚠️ Lead has no Roster entry";
                    }
                }

                const embed = new EmbedBuilder()
                    .setTitle(`📂 Faction Matrix: ${row[0] || factionName}`)
                    .setColor(0x0099FF)
                    .addFields(
                        { name: "Faction Name", value: row[0] || factionName, inline: false },
                        { name: "Faction Team Lead", value: leadDisplay, inline: false },
                        { name: "Current Tier", value: row[2] || "0", inline: true },
                        { name: "Last Promotion", value: row[3] || "N/A", inline: true },
                        { name: "Feedback Thread", value: threadStatus, inline: false },
                        { name: "Staff Team", value: roleStatus, inline: false }
                    )
                    .setFooter({ text: "[ECRP] Faction Management System" });

                return interaction.editReply({ embeds: [embed] });
            }

            // --- SET TIER ---
            if (sub === "settier") {
                const tier = interaction.options.getInteger("tier");
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Could not find **${factionName}** in FactionData.`);

                const today = getTodayDate();
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `FactionData!C${rowNum}:D${rowNum}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [[tier, today]] }
                });

                return interaction.editReply(`✅ **${factionName}** promoted to **Tier ${tier}** on ${today}.`);
            }

            // --- SET LEAD (Single) ---
            if (sub === "setlead") {
                const user = interaction.options.getUser("user");
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Could not find **${factionName}** in FactionData.`);

                const checkRes = await sheets.spreadsheets.values.get({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `FactionData!B${rowNum}`
                });
                const oldLeadId = checkRes.data.values?.[0]?.[0];
                const oldLeadText = (oldLeadId && oldLeadId !== "None") ? `<@${oldLeadId}>` : "Nobody";

                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `FactionData!B${rowNum}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [[user.id]] }
                });

                return interaction.editReply(`✅ **${factionName}**: Replaced ${oldLeadText} with ${user}.`);
            }

            // --- SET THREAD (New) ---
            if (sub === "setthread") {
                const threadId = interaction.options.getString("thread_id");
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Could not find **${factionName}** in FactionData.`);

                // Update Column E (Index 4 is E if 0=A. Sheet columns are A=1, E=5)
                // Range `FactionData!E${rowNum}`
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `FactionData!E${rowNum}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [[threadId]] }
                });

                return interaction.editReply(`✅ **${factionName}** thread linked to <#${threadId}>.`);
            }

            // --- SWAP LEAD (Bulk) ---
            if (sub === "swaplead") {
                const oldUser = interaction.options.getUser("old_lead");
                const newUser = interaction.options.getUser("new_lead");

                const res = await sheets.spreadsheets.values.get({
                     spreadsheetId: GOOGLE_SHEET_ID,
                     range: "FactionData!A:D"
                });
                
                let rows = res.data.values || [];
                let updatesCount = 0;

                for (let i = 1; i < rows.length; i++) {
                    if (rows[i][1] === oldUser.id) {
                        rows[i][1] = newUser.id;
                        updatesCount++;
                    }
                }

                if (updatesCount === 0) {
                     return interaction.editReply(`❌ No factions found led by ${oldUser}.`);
                }

                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: "FactionData!A:D",
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: rows }
                });

                return interaction.editReply(`✅ **Transfer Complete:** Replaced ${oldUser} with ${newUser} on **${updatesCount}** factions.`);
            }

            // --- UPDATE ROSTER ---
            if (sub === "roster") {
                const user = interaction.options.getUser("user");
                const roleId = interaction.options.getString("role_id");
                const teamName = interaction.options.getString("team_name") || "Staff Team";

                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: "StaffRoster!A:A"
                });
                
                const rows = res.data.values || [];
                let existingRowIndex = -1;

                for (let i = 0; i < rows.length; i++) {
                    if (rows[i][0] === user.id) {
                        existingRowIndex = i + 1;
                        break;
                    }
                }

                if (existingRowIndex > -1) {
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        range: `StaffRoster!B${existingRowIndex}:C${existingRowIndex}`,
                        valueInputOption: "USER_ENTERED",
                        requestBody: { values: [[roleId, teamName]] }
                    });
                    return interaction.editReply(`✅ **Roster Updated:** ${user} is now linked to Role ID \`${roleId}\` (${teamName}).`);
                } else {
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        range: "StaffRoster!A:C",
                        valueInputOption: "USER_ENTERED",
                        requestBody: { values: [[user.id, roleId, teamName]] }
                    });
                    return interaction.editReply(`✅ **Roster Added:** ${user} linked to Role ID \`${roleId}\` (${teamName}).`);
                }
            }

            // --- REMOVE ---
            if (sub === "remove") {
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Could not find **${factionName}** in FactionData.`);

                const sheetId = await getSheetId("FactionData");
                if (sheetId === null) return interaction.editReply("❌ System Error: Could not find FactionData tab ID.");

                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    requestBody: {
                        requests: [{
                            deleteDimension: {
                                range: {
                                    sheetId: sheetId,
                                    dimension: "ROWS",
                                    startIndex: rowNum - 1,
                                    endIndex: rowNum
                                }
                            }
                        }]
                    }
                });

                return interaction.editReply(`🗑️ **${factionName}** has been removed from the Matrix.`);
            }

        } catch (err) {
            console.error("Matrix Command Error:", err);
            return interaction.editReply("❌ API Error. Check console logs.");
        }
    }
};
