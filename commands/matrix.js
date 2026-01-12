import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

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
        // 4. SET LEAD
        .addSubcommand(sub =>
            sub.setName("setlead")
                .setDescription("Assign a Team Lead.")
                .addStringOption(o => 
                    o.setName("name")
                     .setDescription("Faction Name")
                     .setRequired(true)
                     .setAutocomplete(true)
                )
                .addUserOption(o => o.setName("user").setDescription("The Team Lead").setRequired(true))
        )
        // 5. REMOVE
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
        // --- PERMISSIONS ---
        const requiredRole = "[ECRP] Faction Management";
        const hasRole = interaction.member.roles.cache.some(r => r.name === requiredRole);
        
        if (interaction.options.getSubcommand() !== "view" && !hasRole) {
            return interaction.reply({ content: `❌ Restricted to **${requiredRole}** only.`, ephemeral: true });
        }

        await interaction.deferReply();
        const sub = interaction.options.getSubcommand();
        const factionName = interaction.options.getString("name");

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

                const today = new Date().toLocaleDateString("en-GB");
                await sheets.spreadsheets.values.append({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: "FactionData!A:D",
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [[factionName, "None", "0", today]] }
                });

                return interaction.editReply(`✅ **${factionName}** initialized in the Matrix.`);
            }

            // --- VIEW ---
            if (sub === "view") {
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Could not find **${factionName}** in FactionData.`);

                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `FactionData!A${rowNum}:D${rowNum}`
                });

                const row = res.data.values ? res.data.values[0] : [];
                const leadId = row[1];
                const leadDisplay = (leadId && leadId !== "None") ? `<@${leadId}>` : "None Assigned";

                const embed = new EmbedBuilder()
                    .setTitle(`📂 Faction Matrix: ${row[0] || factionName}`)
                    .setColor(0x0099FF)
                    .addFields(
                        { name: "Faction Name", value: row[0] || factionName, inline: false },
                        { name: "Faction Team Lead", value: leadDisplay, inline: false },
                        { name: "Current Tier", value: row[2] || "0", inline: false },
                        { name: "Last Promotion Date", value: row[3] || "N/A", inline: false }
                    )
                    .setFooter({ text: "[ECRP] Faction Management System" });

                return interaction.editReply({ embeds: [embed] });
            }

            // --- SET TIER ---
            if (sub === "settier") {
                const tier = interaction.options.getInteger("tier");
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Could not find **${factionName}** in FactionData.`);

                const today = new Date().toLocaleDateString("en-GB");
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `FactionData!C${rowNum}:D${rowNum}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [[tier, today]] }
                });

                return interaction.editReply(`✅ **${factionName}** promoted to **Tier ${tier}** on ${today}.`);
            }

            // --- SET LEAD ---
            if (sub === "setlead") {
                const user = interaction.options.getUser("user");
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Could not find **${factionName}** in FactionData.`);

                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `FactionData!B${rowNum}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [[user.id]] }
                });

                return interaction.editReply(`✅ **${factionName}** is now led by ${user}.`);
            }

            // --- REMOVE ---
            if (sub === "remove") {
                const rowNum = await findFactionRow("FactionData", factionName);
                if (!rowNum) return interaction.editReply(`❌ Could not find **${factionName}** in FactionData.`);

                const sheetId = await getSheetId("FactionData");
                if (sheetId === null) return interaction.editReply("❌ System Error: Could not find FactionData tab ID.");

                // To delete a row, we must use batchUpdate with deleteDimension
                // The API uses 0-based indexes. rowNum is 1-based.
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
