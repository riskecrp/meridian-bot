import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

export default {
    data: new SlashCommandBuilder()
        .setName("confiscateproperty")
        .setDescription("Mark a previously-recorded property as confiscated and set the Date Confiscated.")
        .addStringOption(o =>
            o.setName("date")
                .setDescription("Date Given (YYYY-MM-DD) — kept for context but NOT required to match")
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName("faction")
                .setDescription("Faction Name")
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(o =>
            o.setName("address")
                .setDescription("Property Address")
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName("type")
                .setDescription("Property Type (kept for context but NOT required to match)")
                .setRequired(true)
                .addChoices(
                    { name: "Property", value: "Property" },
                    { name: "Warehouse", value: "Warehouse" },
                    { name: "HQ", value: "HQ" }
                )
        )
        .addBooleanOption(o =>
            o.setName("confiscated")
                .setDescription("Set to true to mark confiscated")
                .setRequired(true)
        ),

    async autocomplete(interaction) {
        // Placeholder for future autocomplete logic
        await interaction.respond([]);
    },

    async execute(interaction) {
        // Role Check: Management Only
        const memberRoles = interaction.member?.roles?.cache;
        const hasManagement = memberRoles ? memberRoles.some(r => r.name === "[ECRP] FM Management") : false;

        if (!hasManagement) {
            return interaction.reply({ 
                content: "You do not have permission to run this command. (Requires Management role)", 
                ephemeral: true 
            });
        }

        // Defer because searching rows takes time
        await interaction.deferReply({ ephemeral: true });

        const dateGivenInput = interaction.options.getString("date");
        const factionInput = interaction.options.getString("faction");
        const addressInput = interaction.options.getString("address");
        const typeInput = interaction.options.getString("type");
        const confiscatedFlag = interaction.options.getBoolean("confiscated");

        // Safety check
        if (!confiscatedFlag) {
            return interaction.editReply("No action taken — 'confiscated' was not set to true.");
        }

        try {
            // 1. Read the sheet to find the row
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "PropertyRewards!A1:F999"
            });

            const rows = res.data.values || [];

            // 2. Find matches
            const factionNorm = (factionInput || "").trim().toLowerCase();
            const addressNorm = (addressInput || "").trim().toLowerCase();

            const candidates = []; // { index, dateTimestamp, row }

            // Start at 1 to skip header
            for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                const rFaction = (r[1] || "").toString().trim().toLowerCase();
                const rAddress = (r[2] || "").toString().trim().toLowerCase();

                if (rFaction === factionNorm && rAddress === addressNorm) {
                    // Try to parse date from column A for sorting
                    let ts = 0;
                    if (r[0]) {
                        const parsed = Date.parse(r[0].toString().trim());
                        if (!isNaN(parsed)) ts = parsed;
                    }
                    candidates.push({ index: i, dateTimestamp: ts, row: r });
                }
            }

            if (candidates.length === 0) {
                return interaction.editReply("No matching PropertyRewards row found for that Faction and Address.");
            }

            // 3. Sort by date (descending) to modify the most recent entry
            candidates.sort((a, b) => {
                if (a.dateTimestamp === b.dateTimestamp) return a.index - b.index;
                return b.dateTimestamp - a.dateTimestamp;
            });

            const chosen = candidates[0];
            const sheetRow = chosen.index + 1; // 1-based index for Google API

            // 4. Update the row
            // We preserve existing data or fall back to input if missing
            const existingRow = chosen.row;
            const updatedA = existingRow[0] || dateGivenInput;
            const updatedB = existingRow[1] || factionInput;
            const updatedC = existingRow[2] || addressInput;
            const updatedD = existingRow[3] || typeInput;
            const updatedE = true; // Confiscated = TRUE
            const dateConfiscated = new Date().toISOString().slice(0, 10); // Today's date YYYY-MM-DD
            const updatedF = dateConfiscated;

            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `PropertyRewards!A${sheetRow}:F${sheetRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[updatedA, updatedB, updatedC, updatedD, updatedE, updatedF]]
                }
            });

            return interaction.editReply(`✅ Property row updated for Faction="${updatedB}", Address="${updatedC}":\nConfiscated=TRUE\nDate Confiscated=${dateConfiscated}`);

        } catch (err) {
            console.error("CONFISCATEPROPERTY ERROR:", err);
            return interaction.editReply("There was an error updating the Google Sheet.");
        }
    }
};
