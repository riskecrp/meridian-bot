import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// Helper Functions specific to this command
async function findNextRowRewards() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "PropertyRewards!A:A"
    });
    return (res.data.values || []).length + 1;
}

async function findNextRowSheet1() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Sheet1!F:F"
    });
    return (res.data.values || []).length + 1;
}

export default {
    data: new SlashCommandBuilder()
        .setName("addproperty")
        .setDescription("Add a property reward and update the faction database.")
        .addStringOption(o =>
            o.setName("date")
                .setDescription("Date Given (YYYY-MM-DD)")
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
                .setDescription("Property Type")
                .setRequired(true)
                .addChoices(
                    { name: "Property", value: "Property" },
                    { name: "Warehouse", value: "Warehouse" },
                    { name: "HQ", value: "HQ" }
                )
        )
        .addBooleanOption(o =>
            o.setName("confiscated")
                .setDescription("Confiscated or not?")
                .setRequired(true)
        ),

    // Re-use the autocomplete from factioninfo logic? 
    // Since we don't have a shared cache yet, we will just load it simply here.
    // Ideally, you move loadFactions to utils, but for now, let's keep it simple.
    async autocomplete(interaction) {
        // Simple autocomplete handling
        const focusedValue = interaction.options.getFocused();
        // NOTE: In a real app, import 'loadFactions' from a shared util to avoid API spam
        // For now, we will just return a generic message or basic cache if available.
        // If you want full faction autocomplete here, we need to export the loader from utils.
        await interaction.respond([]); 
    },

    async execute(interaction) {
        // Role check
        const memberRoles = interaction.member?.roles?.cache;
        const hasManagement = memberRoles ? memberRoles.some(r => r.name === "Management") : false;

        if (!hasManagement) {
            return interaction.reply({ 
                content: "You do not have permission to run this command. (Requires Management role)", 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const date = interaction.options.getString("date");
        const faction = interaction.options.getString("faction");
        const address = interaction.options.getString("address");
        const type = interaction.options.getString("type");
        const confiscated = interaction.options.getBoolean("confiscated");

        try {
            // Update PropertyRewards
            const rewardsRow = await findNextRowRewards();
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `PropertyRewards!A${rewardsRow}:E${rewardsRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[date, faction, address, type, confiscated]]
                }
            });

            // Update Sheet1
            const row = await findNextRowSheet1();
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Sheet1!F${row}:H${row}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [
                        [
                            faction,
                            address,
                            type === "HQ" ? true : false
                        ]
                    ]
                }
            });

            return interaction.editReply({
                content: "✅ Property recorded and added to faction database."
            });

        } catch (err) {
            console.error("ADDPROPERTY ERROR:", err);
            return interaction.editReply("There was an error updating the Google Sheet.");
        }
    }
};
