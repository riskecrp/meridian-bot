import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- HELPER: Find Row Number by Faction Name ---
// Returns the 1-based row number (e.g., 5) or null if not found
async function findFactionRow(sheetName, factionName) {
    try {
        // Fetch Column A (Names)
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetName}!A:A`,
        });

        const rows = res.data.values || [];
        // Normalize search
        const target = factionName.toLowerCase().trim();

        // Loop through rows (Index 0 is Row 1)
        for (let i = 0; i < rows.length; i++) {
            const cell = rows[i][0];
            if (cell && cell.toLowerCase().trim() === target) {
                return i + 1; // Return 1-based row index
            }
        }
        return null;
    } catch (err) {
        console.error(`Error searching ${sheetName}:`, err);
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
                .addStringOption(o => o.setName("name").setDescription("Faction Name").setRequired(true))
        )
        // 3. SET TIER
        .addSubcommand(sub =>
            sub.setName("settier")
                .setDescription("Update Tier & Date.")
                .addStringOption(o => o.setName("name").setDescription("Faction Name").setRequired(true))
                .addIntegerOption(o => o.setName("tier").setDescription("New Tier (1-9)").setMinValue(1).setMaxValue(9).setRequired(true))
        )
        // 4. SET LEAD
        .addSubcommand(sub =>
            sub.setName("setlead")
                .setDescription("Assign a Team Lead.")
                .addStringOption(o => o.setName("name").setDescription("Faction Name").setRequired(true))
                .addUserOption(o => o.setName("user").setDescription("The Team Lead").setRequired(true))
        ),

    async execute(interaction) {
        // --- PERMISSIONS ---
        const requiredRole = "[ECRP] Faction Management";
        const hasRole = interaction.member.roles.cache.some(r => r.name === requiredRole);
        
        // Allow anyone to "view", but restrict others
        if (interaction.options.getSubcommand() !== "view" && !hasRole) {
            return interaction.reply({ content: `❌ Restricted to **${requiredRole}** only.`, ephemeral: true });
        }

        await interaction.deferReply();
        const sub = interaction.options.getSubcommand();
        const factionName = interaction.options.getString("name");

        try {
            // --- CREATE ---
            if (sub === "create") {
                // 1. Check/Add to Sheet1 (Master List)
                const masterRow = await findFactionRow("Sheet1", factionName);
                if (!masterRow) {
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        range: "Sheet1!A:A",
                        valueInputOption: "USER_ENTERED",
                        requestBody: { values: [[factionName]] }
                    });
                }

                // 2. Check/Add to FactionData (Matrix)
                const dataRow = await findFactionRow("FactionData", factionName);
                if (dataRow) {
                    return interaction.editReply(`❌ **${factionName}** already exists in FactionData.`);
                }

                const today = new Date().toLocaleDateString("en-GB");
                // Append: [Name, LeadID, Tier, Date]
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

                // Fetch that specific row (A to D)
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `FactionData!A${rowNum}:D${rowNum}`
                });

                const row = res.data.values ? res.data.values[0] : [];
                // row = [Name, LeadID, Tier, Date]

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

                // Update Columns C (Tier) and D (Date) -> Indices 2 and 3? No, Ranges are A1 notation.
                // Col A=1, B=2, C=3, D=4
                // We update Range C{row}:D{row}
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

                // Update Column B (Lead ID) -> Range B{row}
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `FactionData!B${rowNum}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [[user.id]] }
                });

                return interaction.editReply(`✅ **${factionName}** is now led by ${user}.`);
            }

        } catch (err) {
            console.error("Matrix Command Error:", err);
            return interaction.editReply("❌ API Error. Check console logs.");
        }
    }
};
