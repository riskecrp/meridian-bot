import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";
import { ensureSheetTab, findNextRowInTab } from "../utils/sheetUtils.js";

// Helper to check for roles
function hasRequiredRole(interaction, roleNames) {
    const memberRoles = interaction.member?.roles?.cache;
    if (!memberRoles) return false;
    return roleNames.some(roleName => memberRoles.some(r => r.name === roleName));
}

// Helper to get unique factions from Sheet1 Column A
async function getUniqueFactions() {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "Sheet1!A2:A999" // Skip header A1
        });
        const rows = res.data.values || [];
        // Flatten array, trim whitespace, and get unique values
        const unique = [...new Set(rows.flat().map(f => f.trim()).filter(f => f))];
        return unique.sort();
    } catch (err) {
        console.error("Error fetching factions:", err);
        return [];
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName("logscene")
        .setDescription("Log a scene run for a specific faction.")
        .addStringOption(o =>
            o.setName("faction")
                .setDescription("The faction the scene was run for")
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(o =>
            o.setName("rewards")
                .setDescription("Rewards given (items, money, etc.)")
                .setRequired(true)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        
        // Fetch factions (In a real production bot, you'd cache this to avoid API limits)
        const factions = await getUniqueFactions();
        
        // Filter based on what the user is typing
        const filtered = factions
            .filter(choice => choice.toLowerCase().includes(focusedValue))
            .slice(0, 25); // Discord limit

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
        const rewards = interaction.options.getString("rewards");
        const loggedBy = interaction.user.username;
        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        await interaction.deferReply({ ephemeral: true });

        try {
            // Ensure "Scene Logs" tab exists
            await ensureSheetTab("Scene Logs", ["Date", "Faction", "Rewards", "Logged By"]);

            // Find next empty row
            const nextRow = await findNextRowInTab("Scene Logs", "A");

            // Append the log
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: `Scene Logs!A${nextRow}:D${nextRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[date, faction, rewards, loggedBy]]
                }
            });

            return interaction.editReply({ 
                content: `✅ **Scene Logged!**\n**Faction:** ${faction}\n**Rewards:** ${rewards}\n**Date:** ${date}` 
            });

        } catch (err) {
            console.error("LOGSCENE ERROR:", err);
            return interaction.editReply({ content: "There was an error updating the Google Sheet." });
        }
    }
};
