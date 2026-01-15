import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- CACHING SYSTEM FOR ADDRESSES ONLY ---
let addressCache = [];
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 Seconds

async function getPropertyAddresses() {
    const now = Date.now();
    if (addressCache.length > 0 && (now - lastFetchTime < CACHE_DURATION)) {
        return addressCache;
    }

    try {
        console.log("[Confiscate] Fetching addresses from PropertyRewards!C:C...");
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            // Column C is Address
            range: "PropertyRewards!C2:C2000" 
        });
        
        const rows = res.data.values || [];
        const raw = rows.flat().map(a => a ? a.trim() : "").filter(a => a.length > 0);
        addressCache = [...new Set(raw)]; 
        
        lastFetchTime = now;
        return addressCache;
    } catch (err) {
        console.error("Error fetching addresses:", err);
        return [];
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName("confiscateproperty")
        .setDescription("Instantly confiscate a property (Sets Faction to 'None' & logs it).")
        .addStringOption(o => o.setName("address").setDescription("Select Property Address").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("date").setDescription("Original Date Given (Optional override)").setRequired(false)),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);

        if (focusedOption.name === "address") {
            const choices = await getPropertyAddresses();
            const filtered = choices
                .filter(c => c.toLowerCase().includes(focusedOption.value.toLowerCase()))
                .slice(0, 25);
            
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        } else {
            await interaction.respond([]);
        }
    },

    async execute(interaction) {
        // PERMISSION CHECK: [ECRP] FM Leadership
        const memberRoles = interaction.member?.roles?.cache;
        const hasLeadership = memberRoles ? memberRoles.some(r => r.name === "[ECRP] FM Leadership") : false;

        if (!hasLeadership) {
            return interaction.reply({ content: "❌ Permission Denied: [ECRP] FM Leadership required.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const addressInput = interaction.options.getString("address");
        const dateInput = interaction.options.getString("date");

        try {
            // 1. Search PropertyRewards
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "PropertyRewards!A1:G5000"
            });
            const rows = res.data.values || [];
            
            // 2. Find Match by Address
            const addressNorm = addressInput.trim().toLowerCase();
            let match = null;
            let sheetRow = -1;

            for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                if (r[2] && r[2].trim().toLowerCase() === addressNorm) {
                    match = r;
                    sheetRow = i + 1; // 1-based index
                    break;
                }
            }

            if (!match) {
                return interaction.editReply(`❌ No record found for address: **${addressInput}**.`);
            }

            // 3. Capture Existing Data
            const oldDateGiven = match[0] || dateInput || "Unknown Date"; 
            const oldFaction = match[1] || "Unknown Faction";             
            const existingType = match[3] || "Property";                  

            // 4. Check if already confiscated
            if (match[4] && match[4].toLowerCase() === "true") {
                return interaction.editReply(`⚠️ **Warning:** **${addressInput}** is already marked as confiscated.`);
            }

            // 5. Update the Row
            const today = new Date().toISOString().split('T')[0];
            const staffName = interaction.user.tag;

            const updatedRow = [
                oldDateGiven,
                "None",        // Faction -> None
                addressInput,
                existingType,  // Preserves existing Type
                "TRUE",        // Confiscated
                today,         // Date Confiscated
                staffName      // Staff
            ];

            // 6. Commit Update
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `PropertyRewards!A${sheetRow}:G${sheetRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [updatedRow] }
            });

            // 7. Write to Audit Log
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "ConfiscationLogs!A:E",
                valueInputOption: "USER_ENTERED",
                requestBody: { 
                    values: [[today, oldFaction, addressInput, existingType, staffName]] 
                }
            });

            return interaction.editReply(
                `✅ **Property Confiscated**\n` +
                `🏠 **Address:** ${addressInput}\n` +
                `📉 **From:** ${oldFaction}\n` +
                `📅 **Date:** ${today}\n` +
                `📂 *Logged to Audit Trail.*`
            );

        } catch (err) {
            console.error("CONFISCATE ERROR:", err);
            return interaction.editReply("❌ Database Error. Check logs.");
        }
    }
};
