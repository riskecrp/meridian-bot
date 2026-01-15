import { SlashCommandBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// Helper: Find next empty row for People (Columns A-E)
async function findNextRowTable1() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Sheet1!A:A"
    });
    return (res.data.values || []).length + 1;
}

// Helper: Find next empty row for Locations (Columns F-H)
async function findNextRowSheet1() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Sheet1!F:F"
    });
    return (res.data.values || []).length + 1;
}

export default {
    data: new SlashCommandBuilder()
        .setName("adddossier")
        .setDescription("Add a dossier entry (person or location) to Sheet1.")
        .addSubcommand(sub =>
            sub.setName("person")
                .setDescription("Add a person (Table 1: Sheet1 A-E)")
                .addStringOption(o =>
                    o.setName("faction")
                        .setDescription("Faction Name")
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(o =>
                    o.setName("character")
                        .setDescription("Character name")
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName("phone")
                        .setDescription("Phone")
                        .setRequired(false)
                )
                .addStringOption(o =>
                    o.setName("personaladdress")
                        .setDescription("Personal Address")
                        .setRequired(false)
                )
                .addBooleanOption(o =>
                    o.setName("leader")
                        .setDescription("Is this character a leader?")
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName("location")
                .setDescription("Add a location tied to a faction (Table 2: Sheet1 F-H)")
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
                .addBooleanOption(o =>
                    o.setName("is_hq")
                        .setDescription("Is this property an HQ?")
                        .setRequired(true)
                )
        ),

    async autocomplete(interaction) {
        // Simple autocomplete stub to prevent crashing
        // In the future, we can link this to the shared cache in factioninfo
        const focusedValue = interaction.options.getFocused();
        await interaction.respond([]);
    },

    async execute(interaction) {
        // Role Check: Team Lead OR Management
        const memberRoles = interaction.member?.roles?.cache;
        const hasTeamLead = memberRoles ? memberRoles.some(r => r.name === "[ECRP] FM Team Lead") : false;
        const hasManagement = memberRoles ? memberRoles.some(r => r.name === "[ECRP] FM Leadership") : false;

        if (!(hasTeamLead || hasManagement)) {
            return interaction.reply({
                content: "You do not have permission to run this command. (Requires Team Lead or Management role)",
                ephemeral: true
            });
        }

        const sub = interaction.options.getSubcommand();

        try {
            if (sub === "person") {
                const faction = interaction.options.getString("faction");
                const character = interaction.options.getString("character");
                const phone = interaction.options.getString("phone") || "";
                const personalAddress = interaction.options.getString("personaladdress") || "";
                const leader = interaction.options.getBoolean("leader") ? true : false;

                const row = await findNextRowTable1();
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `Sheet1!A${row}:E${row}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: [[faction, character, phone, personalAddress, leader]]
                    }
                });

                return interaction.reply({ content: "✅ Person dossier recorded to Sheet1 (A-E).", ephemeral: true });
            }

            if (sub === "location") {
                const faction = interaction.options.getString("faction");
                const address = interaction.options.getString("address");
                const isHQ = interaction.options.getBoolean("is_hq") ? true : false;

                const row = await findNextRowSheet1();
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `Sheet1!F${row}:H${row}`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: [[faction, address, isHQ]]
                    }
                });

                return interaction.reply({ content: "✅ Location dossier recorded to Sheet1 (F-H).", ephemeral: true });
            }

        } catch (err) {
            console.error("ADDDOSSIER ERROR:", err);
            return interaction.reply({ content: "There was an error updating the Google Sheet.", ephemeral: true });
        }
    }
};
