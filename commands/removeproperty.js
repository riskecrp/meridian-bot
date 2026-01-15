import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- ADDRESS CACHING ---
let addressCache = [];
let lastFetchTime = 0;
const CACHE_DURATION = 30000;

async function getAddresses() {
    const now = Date.now();
    if (addressCache.length > 0 && (now - lastFetchTime < CACHE_DURATION)) return addressCache;
    try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "PropertyRewards!C2:C2000" });
        const rows = res.data.values || [];
        addressCache = [...new Set(rows.flat().map(a => a ? a.trim() : "").filter(a => a.length > 0))];
        lastFetchTime = now;
        return addressCache;
    } catch (err) { return []; }
}

async function getSheetId(title) {
    try {
        const res = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
        return res.data.sheets.find(s => s.properties.title === title)?.properties.sheetId;
    } catch (e) { return null; }
}

export default {
    data: new SlashCommandBuilder()
        .setName("removeproperty")
        .setDescription("Permanently delete a property from the database (Logs before deleting).")
        .addStringOption(o => o.setName("address").setDescription("Property Address").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("date").setDescription("Original Date Given (Optional)").setRequired(false)),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = await getAddresses();
        const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
        await interaction.respond(filtered.map(c => ({ name: c, value: c })));
    },

    async execute(interaction) {
        // PERMISSION: [ECRP] FM Leadership
        const memberRoles = interaction.member?.roles?.cache;
        const hasLeadership = memberRoles ? memberRoles.some(r => r.name === "[ECRP] FM Leadership") : false;

        if (!hasLeadership) return interaction.reply({ content: "❌ Permission Denied: [ECRP] FM Leadership required.", ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        const address = interaction.options.getString("address");
        // We capture this just for logging if needed, though we prefer the sheet data
        const dateInput = interaction.options.getString("date");

        try {
            // 1. Find Row Index & Data
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "PropertyRewards!A1:G5000" });
            const rows = res.data.values || [];
            
            let rowIndex = -1;
            let rowData = null;

            // Find by Address (Column C, Index 2)
            for (let i = 1; i < rows.length; i++) {
                if (rows[i][2] && rows[i][2].trim().toLowerCase() === address.trim().toLowerCase()) {
                    rowIndex = i; 
                    rowData = rows[i];
                    break;
                }
            }

            if (rowIndex === -1) return interaction.editReply(`❌ Address not found: **${address}**`);

            // 2. Log to ConfiscationLogs BEFORE Deletion
            // We append "(DELETED)" to the type so we know why it's in the logs.
            const today = new Date().toISOString().split('T')[0];
            const staffName = interaction.user.tag;
            const oldFaction = rowData[1] || "Unknown";
            const oldType = rowData[3] || "Property";
            
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "ConfiscationLogs!A:E",
                valueInputOption: "USER_ENTERED",
                requestBody: { 
                    values: [[today, oldFaction, address, `${oldType} (DELETED)`, staffName]] 
                }
            });

            // 3. Delete Row
            const sheetId = await getSheetId("PropertyRewards");
            if (sheetId === undefined || sheetId === null) return interaction.editReply("❌ Error: Could not find sheet ID.");

            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: GOOGLE_SHEET_ID,
                requestBody: {
                    requests: [{
                        deleteDimension: {
                            range: {
                                sheetId: sheetId,
                                dimension: "ROWS",
                                startIndex: rowIndex,
                                endIndex: rowIndex + 1
                            }
                        }
                    }]
                }
            });

            return interaction.editReply(`🗑️ **Deleted:** ${address}\n📉 **Previous Owner:** ${oldFaction}\n📂 *Logged to Audit Trail.*`);

        } catch (err) {
            console.error(err);
            return interaction.editReply("❌ Database Error.");
        }
    }
};
