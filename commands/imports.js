import { 
    SlashCommandBuilder, 
    EmbedBuilder 
} from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- CONFIGURATION ---
const GAM_ROLE_ID = "1457189093594239147"; 
const SHEET_TAB_NAME = "ImportsList";

// --- CATEGORY RENAME MAP ---
// Use this to make spreadsheet categories look nice in Discord
// Key = Exact text in Spreadsheet (Column E)
// Value = Nice text in Discord
const CATEGORY_NAMES = {
    "Pistol Light": "Light Pistols",
    "Pistol Medium": "Medium Pistols",
    "Pistol Heavy": "Heavy Pistols",
    "SMG": "Submachine Guns",
    "MG": "Machine Guns",
    "Melee": "Melee Weapons",
    "ChopShop": "Chop Shop Tools",
    "Mod": "Weapon Mods",
    "Ingredient": "Chemicals & Ingredients",
    "Attachment Clip": "Magazines & Clips",
    "Attachment Flashlight": "Flashlights",
    "Attachment Muzzle": "Muzzle Attachments",
    "Attachment Sight": "Sights & Scopes",
    "Attachment Suppressor": "Suppressors"
};

// --- HELPERS ---

async function getHeaders() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${SHEET_TAB_NAME}!1:1` 
    });
    return res.data.values?.[0] || [];
}

async function getItems() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${SHEET_TAB_NAME}!B:B` 
    });
    const rows = res.data.values || [];
    return rows.map((r, i) => ({ name: r[0], rowIndex: i })).filter(i => i.name && i.name !== "Item");
}

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

// --- AMMO COMPRESSOR HELPER ---
function formatAmmoList(items) {
    const groups = {};
    items.forEach(item => {
        let cleaner = item.replace(/Rounds|Round|\(\d+x\)/gi, "").trim();
        const calibers = ["9mm", ".45 ACP", "5.56mm", "7.62mm", ".357", ".44 Magnum", ".50", "12 Gauge", ".36 Revolver"];
        let foundCal = calibers.find(c => cleaner.startsWith(c));
        let key = foundCal || "Other";
        let variant = cleaner.replace(key, "").trim();
        if (!variant) variant = "Standard";
        if (!groups[key]) groups[key] = [];
        groups[key].push(variant);
    });

    return Object.entries(groups).map(([caliber, variants]) => {
        if (caliber === "Other") return variants.map(v => `• ${v}`).join("\n");
        return `• **${caliber}** (${variants.join(", ")})`;
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName("imports")
        .setDescription("Manage Faction Import Permissions")
        .addSubcommand(sub => sub.setName("view").setDescription("View permissions.")
            .addStringOption(o => o.setName("type").setDescription("Search by?").setRequired(true)
                .addChoices({ name: "By Faction (See what they have)", value: "faction" }, { name: "By Item (See who has it)", value: "item" }))
            .addStringOption(o => o.setName("target").setDescription("The Faction or Item Name").setRequired(true).setAutocomplete(true))
        )
        .addSubcommand(sub => sub.setName("toggle").setDescription("Grant or Revoke items.")
            .addStringOption(o => o.setName("faction").setDescription("Faction Name").setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName("items").setDescription("Item Name(s) - Comma separated").setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName("access").setDescription("Grant or Revoke?").setRequired(true)
                .addChoices({ name: "✅ Allow (Grant)", value: "TRUE" }, { name: "❌ Deny (Revoke)", value: "FALSE" }))
        )
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
            if (sub === "view") {
                const type = interaction.options.getString("type");
                const target = interaction.options.getString("target");
                
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${SHEET_TAB_NAME}!A:AZ` });
                const grid = res.data.values || [];
                const headers = grid[0];

                // ------------------------------------------------
                // VIEW BY FACTION (CLEAN LIST)
                // ------------------------------------------------
                if (type === "faction") {
                    const colIndex = headers.indexOf(target);
                    if (colIndex === -1) return interaction.editReply(`❌ Faction **${target}** not found in headers.`);

                    const gearCategories = {};
                    const ammoCategories = [];
                    let totalItems = 0;

                    for (let i = 1; i < grid.length; i++) {
                        const row = grid[i];
                        if (row[colIndex] === "TRUE") {
                            const itemName = row[1]; 
                            const rawClass = row[4] ? row[4].trim() : "General";

                            if (rawClass.toLowerCase().includes("ammo")) {
                                ammoCategories.push(itemName);
                            } else {
                                if (!gearCategories[rawClass]) gearCategories[rawClass] = [];
                                gearCategories[rawClass].push(itemName);
                            }
                            totalItems++;
                        }
                    }

                    const embed = new EmbedBuilder()
                        .setTitle(`📦 Imports: ${target}`)
                        .setColor(0x2b2d31) // Dark/Clean color
                        .setFooter({ text: `Total Authorized Items: ${totalItems}` });

                    if (totalItems === 0) {
                        embed.setDescription("_No imports authorized._");
                        return interaction.editReply({ embeds: [embed] });
                    }

                    // 1. RENDER GEAR FIELDS
                    const sortedGearKeys = Object.keys(gearCategories).sort();
                    
                    sortedGearKeys.forEach(key => {
                        // Check if we have a pretty name in the map, otherwise remove "Attachment" manually or use raw key
                        let cleanTitle = CATEGORY_NAMES[key] 
                            ? CATEGORY_NAMES[key] 
                            : key.replace("Attachment", "").trim();

                        const itemList = gearCategories[key].sort().map(i => `• ${i}`).join("\n");
                        
                        embed.addFields({ 
                            name: `**${cleanTitle}**`, // No emoji, just bold text
                            value: itemList.length > 1024 ? itemList.substring(0, 1020) + "..." : itemList, 
                            inline: true 
                        });
                    });

                    // 2. RENDER AMMO
                    if (ammoCategories.length > 0) {
                        const compressedAmmo = formatAmmoList(ammoCategories);
                        embed.addFields({
                            name: "**Ammunition**",
                            value: compressedAmmo.join("\n"),
                            inline: false 
                        });
                    }

                    return interaction.editReply({ embeds: [embed] });
                } 
                
                // ------------------------------------------------
                // VIEW BY ITEM
                // ------------------------------------------------
                else {
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

            if (sub === "toggle") {
                const factionName = interaction.options.getString("faction");
                const itemInput = interaction.options.getString("items");
                const newVal = interaction.options.getString("access");

                const headers = await getHeaders();
                const colIndex = headers.indexOf(factionName);
                if (colIndex === -1) return interaction.editReply(`❌ Faction header **${factionName}** not found.`);
                
                const colLetter = getColumnLetter(colIndex);
                const allItems = await getItems();

                const inputNames = itemInput.split(',').map(n => n.trim()).filter(n => n.length > 0);
                const updates = []; 
                const successNames = [];
                const notFoundNames = [];

                for (const name of inputNames) {
                    const itemObj = allItems.find(i => i.name.toLowerCase() === name.toLowerCase());
                    if (itemObj) {
                        const range = `${SHEET_TAB_NAME}!${colLetter}${itemObj.rowIndex + 1}`;
                        updates.push({ range: range, values: [[newVal]] });
                        successNames.push(itemObj.name);
                    } else {
                        notFoundNames.push(name);
                    }
                }

                if (updates.length === 0) {
                    return interaction.editReply(`❌ None of the items were found: ${notFoundNames.join(", ")}`);
                }

                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    requestBody: { valueInputOption: "USER_ENTERED", data: updates }
                });

                const statusEmoji = newVal === "TRUE" ? "✅" : "❌";
                const statusText = newVal === "TRUE" ? "Authorized" : "Denied";
                
                let msg = `${statusEmoji} **Updated ${updates.length} items** for **${factionName}** to: ${statusText}.\n`;
                msg += `> ${successNames.join(", ")}`;

                if (notFoundNames.length > 0) {
                    msg += `\n\n⚠️ **Not Found:** ${notFoundNames.join(", ")}`;
                }

                return interaction.editReply(msg);
            }

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
