import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";
import { replyWithPaginatedEmbed } from "../utils/helpers.js";

export default {
    data: new SlashCommandBuilder()
        .setName("listproperties")
        .setDescription("List all properties recorded on the PropertyRewards sheet."),

    async execute(interaction) {
        // Role Check: Management Only
        const memberRoles = interaction.member?.roles?.cache;
        const hasManagement = memberRoles ? memberRoles.some(r => r.name === "Management") : false;

        if (!hasManagement) {
            return interaction.reply({ 
                content: "You do not have permission to run this command. (Requires Management role)", 
                ephemeral: true 
            });
        }

        try {
            // Fetch Data
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "PropertyRewards!A1:E999"
            });

            const rows = res.data.values || [];
            const data = rows.slice(1); // Skip header

            // Format Lines
            const lines = data.map(r => {
                const faction = r[1] || "Unknown Faction";
                const address = r[2] || "N/A";
                const type = r[3] || "Property";
                // Choose icon based on type
                const icon = type === "HQ" ? "🏠" : type === "Warehouse" ? "📦" : "📍";
                return `**${faction}** - ${icon} ${type}: ${address}`;
            });

            // Use our helper to send the response (handles splitting logic)
            const title = `━━━━━━━━━━━━━━━━━━━━━━━━━━\n🗂️  **FACTION MANAGEMENT**\n**Property List**\n━━━━━━━━━━━━━━━━━━━━━━━━━━`;
            
            await replyWithPaginatedEmbed(interaction, lines, title);

        } catch (err) {
            console.error("LISTPROPERTIES ERROR:", err);
            return interaction.reply("There was an error accessing the Google Sheet.");
        }
    }
};
