import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- HELPER: Fetch Faction Names ---
async function getFactionNames() {
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

export default {
    data: new SlashCommandBuilder()
        .setName("confiscateproperty")
        .setDescription("Mark a property as confiscated and log the action.")
        .addStringOption(o => o.setName("date").setDescription("Original Date Given (YYYY-MM-DD)").setRequired(true))
        .addStringOption(o => o.setName("faction").setDescription("Faction Name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("address").setDescription("Property Address").setRequired(true))
        .addStringOption(o => o.setName("type").setDescription("Property Type").setRequired(true)
            .addChoices(
                { name: "Property", value: "Property" },
                { name: "Warehouse", value: "Warehouse" },
                { name: "HQ", value: "HQ" }
            )
        )
        .addBooleanOption(o => o.setName("confiscated").setDescription("Confirm Confiscation").setRequired(true)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = await getFactionNames();
        const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
        await interaction.respond(filtered.map(c => ({ name: c, value: c })));
    },

    async execute(interaction) {
        // Role Check
        const memberRoles = interaction.member?.roles?.cache;
        const hasManagement = memberRoles ? memberRoles.some(r => r.name === "[ECRP] FM Management") : false;

        if (!hasManagement) {
            return interaction.reply({ content: "❌ Permission Denied: Management role required.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const dateGivenInput = interaction.options.getString("date");
        const factionInput = interaction.options.getString("faction");
        const addressInput = interaction.options.getString("address");
        const typeInput = interaction.options.getString("type");
        const confiscatedFlag = interaction.options.getBoolean("confiscated");

        if (!confiscatedFlag) return interaction.editReply("❌ Action cancelled. 'Confiscated' must be set to True.");

        try {
            // 1. Search PropertyRewards (Expanded range to be safe)
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "PropertyRewards!A1:G5000" // A-G to include "Confiscated By" column
            });
            const rows = res.data.values || [];
            
            // 2. Filter Matches
            const factionNorm = factionInput.trim().toLowerCase();
            const addressNorm = addressInput.trim().toLowerCase();
            
            const candidates = []; 
            for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                if (!r[1] || !r[2]) continue; // Skip empty rows

                if (r[1].trim().toLowerCase() === factionNorm && r[2].trim().toLowerCase() === addressNorm) {
                    let ts = 0;
                    if (r[0]) {
                        const parsed = Date.parse(r[0]);
                        if (!isNaN(parsed)) ts = parsed;
                    }
                    candidates.push({ index: i, dateTimestamp: ts, row: r });
                }
            }

            if (candidates.length === 0) {
                return interaction.editReply(`❌ No record found for **${factionInput}** at **${addressInput}**.`);
            }

            // 3. Pick Most Recent
            candidates.sort((a, b) => b.dateTimestamp - a.dateTimestamp);
            const match = candidates[0];
            const sheetRow = match.index + 1; // 1-based index

            // 4. IMPROVEMENT: Check if already confiscated
            // Column E is index 4. If it's already "TRUE", warn user.
            if (match.row[4] && match.row[4].toLowerCase() === "true") {
                return interaction.editReply(`⚠️ **Warning:** This property was already marked as confiscated on ${match.row[5] || "Unknown Date"}.`);
            }

            // 5. Prepare Updates
            // Update: A=DateGiven, B=Faction, C=Address, D=Type, E=Confiscated, F=DateConfiscated, G=Staff
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const staffName = interaction.user.tag;

            // Preserve existing data for A-D, update E-G
            const updatedRow = [
                match.row[0] || dateGivenInput,
                match.row[1] || factionInput,
                match.row[2] || addressInput,
                match.row[3] || typeInput,
                "TRUE",     // E: Confiscated
                today,      // F: Date Confiscated
                staffName   // G: Confiscated By (NEW)
            ];

            // 6. Update Main Sheet
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `PropertyRewards!A${sheetRow}:G${sheetRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [updatedRow] }
            });

            // 7. IMPROVEMENT: Write to Audit Log (ConfiscationLogs)
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "ConfiscationLogs!A:E",
                valueInputOption: "USER_ENTERED",
                requestBody: { 
                    values: [[today, factionInput, addressInput, typeInput, staffName]] 
                }
            });

            return interaction.editReply(`✅ **Confiscated:** ${addressInput} (${factionInput})\n📅 Date: ${today}\n👮 Staff: ${staffName}\n📂 *Logged to Audit Trail.*`);

        } catch (err) {
            console.error("CONFISCATE ERROR:", err);
            return interaction.editReply("❌ Database Error. Check logs.");
        }
    }
};
