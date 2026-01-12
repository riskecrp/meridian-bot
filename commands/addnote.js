import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";
import { ensureSheetTab, findNextRowInTab } from "../utils/sheetUtils.js";

// Helper: Check Roles
function hasRequiredRole(interaction, roleNames) {
    const memberRoles = interaction.member?.roles?.cache;
    if (!memberRoles) return false;
    return roleNames.some(roleName => memberRoles.some(r => r.name === roleName));
}

// Helper: Get unique factions for autocomplete
async function getUniqueFactions() {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "Sheet1!A2:A999"
        });
        const rows = res.data.values || [];
        const unique = [...new Set(rows.flat().map(f => f.trim()).filter(f => f))];
        return unique.sort();
    } catch (err) {
        console.error("Error fetching factions:", err);
        return [];
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName("addnote")
        .setDescription("Log a notable interaction for a faction.")
        .addStringOption(o =>
            o.setName("faction")
                .setDescription("Faction name")
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(o =>
            o.setName("note")
                .setDescription("The notable interaction to record")
                .setRequired(true)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const factions = await getUniqueFactions();
        
        const filtered = factions
            .filter(choice => choice.toLowerCase().includes(focusedValue))
            .slice(0, 25);

        await interaction.respond(
            filtered.map(choice => ({ name: choice, value: choice }))
        );
    },

    async execute(interaction) {
        // Role Check
        if (!hasRequiredRole(interaction, ["Team Leader", "Management", "Team Guide"])) {
            return interaction.reply({ 
                content: "You do not have permission to run this command. (Requires Team Leader, Management, or Team Guide role)", 
                ephemeral: true 
            });
        }

        const faction = interaction.options.getString("faction");
        const note = interaction.options.getString("note");
        const createdBy = interaction.user.username;
        const createdOn = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        await interaction.deferReply({ ephemeral: true });

        try {
            // Ensure Tab Exists
            await ensureSheetTab("Notable Interactions", ["Faction", "Note", "Created By", "Created On"]);

            // Find next row
            const nextRow = await findNextRowInTab("Notable Interactions", "A");

            // Add the note
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Notable Interactions!A${nextRow}:D${nextRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[faction, note, createdBy, createdOn]]
                }
            });

            return interaction.editReply({ content: `✅ Note added for faction "**${faction}**".` });

        } catch (err) {
            console.error("ADDNOTE ERROR:", err);
            return interaction.editReply({ content: "There was an error updating the Google Sheet." });
        }
    }
};
