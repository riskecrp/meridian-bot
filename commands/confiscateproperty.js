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
            // Column C is Address (A=Date, B=Faction, C=Address)
            range: "PropertyRewards!C2:C2000" 
        });
        
        const rows = res.data.values || [];
        // Flatten 2D array, trim spaces, remove duplicates
        const raw = rows.flat().map(a => a ? a.trim() : "").filter(a => a.length > 0);
        addressCache = [...new Set(raw)]; 
        
        lastFetchTime = now;
        console.log(`[Confiscate] Cached ${addressCache.length} unique addresses.`);
        return addressCache;
    } catch (err) {
        console.error("Error fetching addresses:", err);
        return [];
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName("confiscateproperty")
        .setDescription("Confiscate a property (Sets Faction to 'None' and logs history).")
        // 1. ADDRESS is now the main autocomplete field
        .addStringOption(o => o.setName("address").setDescription("Property Address").setRequired(true).setAutocomplete(true))
        // 2. Date is just a text field
        .addStringOption(o => o.setName("date").setDescription("Date Given (YYYY-MM-DD) - For verification context").setRequired(true))
        .addStringOption(o => o.setName("type").setDescription("Property Type").setRequired(true)
            .addChoices(
                { name: "Property", value: "Property" },
                { name: "Warehouse", value: "Warehouse" },
                { name: "HQ", value: "HQ" }
            )
        )
        .addBooleanOption(o => o.setName("confiscated").setDescription("Confirm Confiscation").setRequired(true)),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);

        // STRICT CHECK: Only run this if the user is typing in "address"
        if (focusedOption.name === "address") {
            const choices = await getPropertyAddresses();
            const filtered = choices
                .filter(c => c.toLowerCase().includes(focusedOption.value.toLowerCase()))
                .slice(0, 25);
            
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        } else {
            // If they are somehow typing in another field, return nothing
            await interaction.respond([]);
        }
    },

    async execute(interaction) {
        // Role Check
        const memberRoles = interaction.member?.roles?.cache;
        const hasManagement = memberRoles ? memberRoles.some(r => r.name === "[ECRP] FM Management") : false;

        if (!hasManagement) {
            return interaction.reply({ content: "❌ Permission Denied: Management role required.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const addressInput = interaction.options.getString("address");
        const dateGivenInput = interaction.options.getString("date");
        const typeInput = interaction.options.getString("type");
        const confiscatedFlag = interaction.options.getBoolean("confiscated");

        if (!confiscatedFlag) return interaction.editReply("❌ Action cancelled. 'Confiscated' must be set to True.");

        try {
            // 1. Search PropertyRewards (Cols A-G)
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "PropertyRewards!A1:G5000"
            });
            const rows = res.data.values || [];
            
            // 2. Find Match by Address (Column C, Index 2)
            const addressNorm = addressInput.trim().toLowerCase();
            let match = null;
            let sheetRow = -1;

            for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                // Check Column C (Index 2)
                if (r[2] && r[2].trim().toLowerCase() === addressNorm) {
                    match = r;
                    sheetRow = i + 1; // 1-based index
                    break;
                }
            }

            if (!match) {
                return interaction.editReply(`❌ No record found for address: **${addressInput}**.`);
            }

            // 3. Capture Old Data
            const oldFaction = match[1] || "Unknown Faction"; // Column B
            const oldDateGiven = match[0] || dateGivenInput;
            const oldType = match[3] || typeInput;

            // 4. Update the Row
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const staffName = interaction.user.tag;

            const updatedRow = [
                oldDateGiven,
                "None",       // B: Faction wiped to None
                addressInput, // C: Address
                oldType,      // D: Type
                "TRUE",       // E: Confiscated
                today,        // F: Date Confiscated
                staffName     // G: Staff Member
            ];

            // 5. Commit to Google Sheets
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `PropertyRewards!A${sheetRow}:G${sheetRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [updatedRow] }
            });

            // 6. Write to Audit Log (ConfiscationLogs)
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "ConfiscationLogs!A:E",
                valueInputOption: "USER_ENTERED",
                requestBody: { 
                    values: [[today, oldFaction, addressInput, typeInput, staffName]] 
                }
            });

            return interaction.editReply(
                `✅ **Property Confiscated**\n` +
                `🏠 **Address:** ${addressInput}\n` +
                `📉 **Previous Owner:** ${oldFaction}\n` +
                `✨ **New Owner:** None\n` +
                `📅 **Date:** ${today}\n` +
                `👮 **Staff:** ${staffName}\n` +
                `📂 *Logged to Audit Trail.*`
            );

        } catch (err) {
            console.error("CONFISCATE ERROR:", err);
            return interaction.editReply("❌ Database Error. Check logs.");
        }
    }
};
