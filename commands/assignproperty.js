import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- DUAL CACHING SYSTEM ---
let addressCache = [];
let factionCache = [];
let lastFetchTime = 0;
const CACHE_DURATION = 60000; // 60 Seconds

async function getData() {
    const now = Date.now();
    // Return cache if valid
    if (addressCache.length > 0 && factionCache.length > 0 && (now - lastFetchTime < CACHE_DURATION)) {
        return { addresses: addressCache, factions: factionCache };
    }

    try {
        // 1. Fetch Addresses (PropertyRewards!C)
        const propRes = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "PropertyRewards!C2:C2000"
        });
        const propRows = propRes.data.values || [];
        addressCache = [...new Set(propRows.flat().map(a => a ? a.trim() : "").filter(a => a.length > 0))];

        // 2. Fetch Factions (FactionData!A)
        const facRes = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "FactionData!A2:A999"
        });
        const facRows = facRes.data.values || [];
        factionCache = facRows.flat().map(f => f.trim()).filter(f => f);

        lastFetchTime = now;
        console.log(`[Assign] Cached ${addressCache.length} addresses and ${factionCache.length} factions.`);
        return { addresses: addressCache, factions: factionCache };

    } catch (err) {
        console.error("Error fetching data:", err);
        return { addresses: [], factions: [] };
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName("assignproperty")
        .setDescription("Assign a property to a faction (Updates owner & clears confiscation).")
        .addStringOption(o => o.setName("address").setDescription("Property Address").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("faction").setDescription("New Faction Owner").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("date").setDescription("New Date Given (YYYY-MM-DD)").setRequired(true))
        .addStringOption(o => o.setName("type").setDescription("Property Type").setRequired(true)
            .addChoices(
                { name: "Property", value: "Property" },
                { name: "Warehouse", value: "Warehouse" },
                { name: "HQ", value: "HQ" }
            )
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const { addresses, factions } = await getData();

        let choices = [];
        if (focusedOption.name === "address") choices = addresses;
        if (focusedOption.name === "faction") choices = factions;

        const filtered = choices
            .filter(c => c.toLowerCase().includes(focusedOption.value.toLowerCase()))
            .slice(0, 25);
            
        await interaction.respond(filtered.map(c => ({ name: c, value: c })));
    },

    async execute(interaction) {
        // PERMISSION: [ECRP] FM Leadership
        const memberRoles = interaction.member?.roles?.cache;
        const hasLeadership = memberRoles ? memberRoles.some(r => r.name === "[ECRP] FM Leadership") : false;

        if (!hasLeadership) return interaction.reply({ content: "❌ Permission Denied: [ECRP] FM Leadership required.", ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        const address = interaction.options.getString("address");
        const faction = interaction.options.getString("faction");
        const date = interaction.options.getString("date");
        const type = interaction.options.getString("type");

        try {
            // 1. Find the Row by Address
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "PropertyRewards!A1:G5000" });
            const rows = res.data.values || [];
            
            let sheetRow = -1;
            // Scan Column C (Index 2)
            for (let i = 1; i < rows.length; i++) {
                if (rows[i][2] && rows[i][2].trim().toLowerCase() === address.trim().toLowerCase()) {
                    sheetRow = i + 1; // 1-based index
                    break;
                }
            }

            if (sheetRow === -1) return interaction.editReply(`❌ Address not found: **${address}**`);

            // 2. Overwrite Data
            // A=Date, B=Faction, C=Address, D=Type, E=Confiscated, F=DateConf, G=Staff
            const updatedRow = [
                date,       // New Date
                faction,    // New Owner
                address,    // Same Address
                type,       // Type
                "FALSE",    // Not Confiscated
                "",         // Clear Date
                ""          // Clear Staff
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `PropertyRewards!A${sheetRow}:G${sheetRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [updatedRow] }
            });

            return interaction.editReply(`✅ **Assigned:** ${address} is now owned by **${faction}**.`);

        } catch (err) {
            console.error(err);
            return interaction.editReply("❌ Database Error.");
        }
    }
};
