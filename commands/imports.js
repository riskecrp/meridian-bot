import { 
    SlashCommandBuilder, 
    EmbedBuilder 
} from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- CONFIGURATION ---
const GAM_ROLE_ID = "123456789012345678"; // Replace with actual ID
const SHEET_TAB_NAME = "ImportsList";

// --- HELPERS ---

// 1. Fetch all Headers (Row 1) to map Faction Names to Column Indices
async function getHeaders() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${SHEET_TAB_NAME}!1:1` 
    });
    return res.data.values?.[0] || [];
}

// 2. Fetch all Items (Column B) to map Item Names to Row Indices
async function getItems() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${SHEET_TAB_NAME}!B:B` 
    });
    const rows = res.data.values || [];
    // Filter out empty rows or the header "Item"
    return rows.map((r, i) => ({ name: r[0], rowIndex: i })).filter(i => i.name && i.name !== "Item");
}

// 3. Helper to convert Column Index to Letter
function getColumnLetter(colIndex) {
    let temp, letter = '';
    while (colIndex >= 0) {
        temp = (colIndex) % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        colIndex = (colIndex - temp - 1) / 26;
        colIndex = Math.floor(colIndex) - 1; 
    }
    return letter;
}

export default {
    data: new SlashCommandBuilder()
        .setName("imports")
        .setDescription("Manage Faction Import Permissions")
        // VIEW SUBCOMMAND
        .addSubcommand(sub => sub.setName("view").setDescription("View permissions.")
            .addStringOption(o => o.setName("type").setDescription("Search by?").setRequired(true)
                .addChoices({ name: "By Faction (See what they have)", value: "faction" }, { name: "By Item (See who has it)", value: "item" }))
            .addStringOption(o => o.setName("target").setDescription("The Faction or Item Name").setRequired(true).setAutocomplete(true))
        )
        // TOGGLE SUBCOMMAND (UPDATED FOR BULK)
        .addSubcommand(sub => sub.setName("toggle").setDescription("Grant or Revoke items.")
            .addStringOption(o => o.setName("faction").setDescription("Faction Name").setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName("items").setDescription("Item Name(s) - Comma separated").setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName("access").setDescription("Grant or Revoke?").setRequired(true)
                .addChoices({ name: "✅ Allow (Grant)", value: "TRUE" }, { name: "❌ Deny (Revoke)", value: "FALSE" }))
        )
        // ADD ITEM SUBCOMMAND (Simplified)
        .addSubcommand(sub => sub.setName("add").setDescription("Add new Items to the list.")
            .addStringOption(o => o.setName("name").setDescription("Item Name(s) - Comma separated").setRequired(true))
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const userValue = focusedOption.value.toLowerCase();
        let choices = [];

        try {
            if (focusedOption.name === "faction" || (focusedOption.name === "target" && interaction.options.getString("type") === "faction")) {
                const headers = await getHeaders();
                choices = headers.slice(5).filter(h => h); 
            } 
            else if (focusedOption.name === "items" || focusedOption.name === "item" || (focusedOption.name === "target" && interaction.options.getString("type") === "item")) {
                const items = await getItems();
                choices = items.map(i => i.name);
            }

            const filtered = choices.filter(c => c.toLowerCase().includes(userValue)).slice(0, 25);
            await interaction.respond(filtered.map(c => ({ name: c, value: c })));
        } catch (e) {
            console.error(e);
            await interaction.respond([]);
        }
    },

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(GAM_ROLE_ID)) {
            return interaction.reply({ content: "❌ Authorized personnel only [GAM].", ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();
        await interaction.deferReply();

        try {
            // --- VIEW COMMAND ---
            if (sub === "view") {
                const type = interaction.options.getString("type");
                const target = interaction.options.getString("target");
                
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${SHEET_TAB_NAME}!A:AZ` });
                const grid = res.data.values || [];
                const headers = grid[0];

                if (type === "faction") {
                    const colIndex = headers.indexOf(target);
                    if (colIndex === -1) return interaction.editReply(`❌ Faction **${target}** not found in headers.`);

                    const allowedItems = [];
                    for (let i = 1; i < grid.length; i++) {
                        const row = grid[i];
                        if (row[colIndex] === "TRUE") {
                            allowedItems.push(`• **${row[1]}**`); 
                        }
                    }

                    const embed = new EmbedBuilder()
                        .setTitle(`📦 Imports: ${target}`)
                        .setColor(0x00AAFF)
                        .setDescription(allowedItems.length ? allowedItems.join("\n") : "_No imports authorized._")
                        .setFooter({ text: `Total Items: ${allowedItems.length}` });

                    return interaction.editReply({ embeds: [embed] });

                } else {
                    const itemRow = grid.find(r => r[1] === target);
                    if (!itemRow) return interaction.editReply(`❌ Item **${target}** not found.`);

                    const allowedFactions = [];
                    for (let c = 5; c < headers.length; c++) {
                        if (itemRow[c] === "TRUE") {
                            allowedFactions.push(`• **${headers[c]}**`);
                        }
                    }

                    const embed = new EmbedBuilder()
                        .setTitle(`🔍 Item: ${target}`)
                        .setDescription(`**Authorized Factions:**\n${allowedFactions.length ? allowedFactions.join("\n") : "_None_"}`)
                        .setColor(0xFFA500);

                    return interaction.editReply({ embeds: [embed] });
                }
            }

            // --- TOGGLE COMMAND (BULK) ---
            if (sub === "toggle") {
                const factionName = interaction.options.getString("faction");
                const itemInput = interaction.options.getString("items");
                const newVal = interaction.options.getString("access");

                // 1. Get Headers & Map Faction Column
                const headers = await getHeaders();
                const colIndex = headers.indexOf(factionName);
                if (colIndex === -1) return interaction.editReply(`❌ Faction header **${factionName}** not found.`);
                
                const colLetter = getColumnLetter(colIndex);

                // 2. Get All Items
                const allItems = await getItems();

                // 3. Process Input List
                const inputNames = itemInput.split(',').map(n => n.trim()).filter(n => n.length > 0);
                const updates = []; // To store batch requests
                const successNames = [];
                const notFoundNames = [];

                for (const name of inputNames) {
                    const itemObj = allItems.find(i => i.name.toLowerCase() === name.toLowerCase());
                    if (itemObj) {
                        // Found it! Prepare the update.
                        const range = `${SHEET_TAB_NAME}!${colLetter}${itemObj.rowIndex + 1}`;
                        updates.push({
                            range: range,
                            values: [[newVal]]
                        });
                        successNames.push(itemObj.name);
                    } else {
                        notFoundNames.push(name);
                    }
                }

                if (updates.length === 0) {
                    return interaction.editReply(`❌ None of the items were found: ${notFoundNames.join(", ")}`);
                }

                // 4. BATCH UPDATE (One request for all cells)
                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    requestBody: {
                        valueInputOption: "USER_ENTERED",
                        data: updates
                    }
                });

                // 5. Build Response
                const statusEmoji = newVal === "TRUE" ? "✅" : "❌";
                const statusText = newVal === "TRUE" ? "Authorized" : "Denied";
                
                let msg = `${statusEmoji} **Updated ${updates.length} items** for **${factionName}** to: ${statusText}.\n`;
                msg += `> ${successNames.join(", ")}`;

                if (notFoundNames.length > 0) {
                    msg += `\n\n⚠️ **Not Found:** ${notFoundNames.join(", ")}`;
                }

                return interaction.editReply(msg);
            }

            // --- ADD ITEM COMMAND ---
            if (sub === "add") {
                const nameInput = interaction.options.getString("name");
                
                const names = nameInput.split(',').map(n => n.trim()).filter(n => n.length > 0);
                const existingItems = await getItems();
                const duplicates = [];
                const newRows = [];

                for (const name of names) {
                    if (existingItems.find(i => i.name.toLowerCase() === name.toLowerCase())) {
                        duplicates.push(name);
                    } else {
                        newRows.push(["", name]);
                    }
                }

                if (newRows.length === 0) {
                    return interaction.editReply(`❌ All items entered already exist: ${duplicates.join(", ")}`);
                }

                await sheets.spreadsheets.values.append({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: `${SHEET_TAB_NAME}!A:B`, 
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: newRows }
                });

                let msg = `✅ **Added ${newRows.length} items** to the list.\n`;
                msg += `> ${newRows.map(r => r[1]).join(", ")}`;
                
                if (duplicates.length > 0) {
                    msg += `\n\n⚠️ **Skipped (Already Exists):**\n> ${duplicates.join(", ")}`;
                }

                return interaction.editReply(msg);
            }

        } catch (err) {
            console.error(err);
            interaction.editReply("❌ System Error processing Imports.");
        }
    }
};
