import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} from "discord.js";

import { google } from "googleapis";

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Google Sheets Authentication
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// Slash command definitions
const factionInfoCmd = new SlashCommandBuilder()
    .setName("factioninfo")
    .setDescription("Look up faction information from the Meridian database.")
    .addStringOption(option =>
        option.setName("faction")
            .setDescription("Faction name")
            .setRequired(true)
            .setAutocomplete(true)
    );

const addPropertyCmd = new SlashCommandBuilder()
    .setName("addproperty")
    .setDescription("Add a property record for a faction.")
    .addStringOption(opt =>
        opt.setName("date")
            .setDescription("Date Given (YYYY-MM-DD)")
            .setRequired(true)
    )
    .addStringOption(opt =>
        opt.setName("faction")
            .setDescription("Faction Name")
            .setRequired(true)
    )
    .addStringOption(opt =>
        opt.setName("address")
            .setDescription("Property Address")
            .setRequired(true)
    )
    .addStringOption(opt =>
        opt.setName("type")
            .setDescription("Type of property")
            .addChoices(
                { name: "Property", value: "Property" },
                { name: "Warehouse", value: "Warehouse" },
                { name: "HQ", value: "HQ" }
            )
            .setRequired(true)
    );

// Register commands
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

async function deployCommands() {
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: [factionInfoCmd.toJSON(), addPropertyCmd.toJSON()] }
        );
        console.log("Commands registered.");
    } catch (err) {
        console.error("DEPLOY ERROR:", err);
    }
}

// Cache faction list for autocomplete
let cachedFactions = [];

async function loadFactions() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Sheet1!A1:H999"
    });

    const rows = res.data.values || [];
    const data = rows.slice(1);

    const set = new Set();
    for (const r of data) {
        if (r[0]) set.add(r[0].trim());
        if (r[5]) set.add(r[5].trim());
    }

    cachedFactions = [...set];
}

// Discord client
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);

    client.user.setPresence({
        activities: [{ name: "Waiting for associate request...", type: 3 }],
        status: "online"
    });
});

// AUTOCOMPLETE HANDLER
client.on("interactionCreate", async interaction => {
    if (!interaction.isAutocomplete()) return;

    if (interaction.commandName === "factioninfo") {
        if (cachedFactions.length === 0) await loadFactions();
        const focused = interaction.options.getFocused();

        const list = cachedFactions
            .filter(f => f.toLowerCase().includes(focused.toLowerCase()))
            .slice(0, 25)
            .map(f => ({ name: f, value: f }));

        return interaction.respond(list);
    }
});

// MAIN COMMAND HANDLER
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // ---------------------------------------------------------
    // NEW COMMAND: /addproperty
    // ---------------------------------------------------------
    if (interaction.commandName === "addproperty") {

        const mgmtRole = interaction.guild.roles.cache.find(r => r.name === "Management");
        if (!mgmtRole || !interaction.member.roles.cache.has(mgmtRole.id)) {
            return interaction.reply({
                content: "❌ You do not have permission to use this command.",
                ephemeral: true
            });
        }

        const date = interaction.options.getString("date");
        const faction = interaction.options.getString("faction");
        const address = interaction.options.getString("address");
        const type = interaction.options.getString("type");

        // Validate date format YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return interaction.reply({
                content: "❌ Invalid date format. Use **YYYY-MM-DD**.",
                ephemeral: true
            });
        }

        try {
            // Load Sheet1 for duplicate protection
            const sheet1 = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Sheet1!A1:H999"
            });

            const rows = sheet1.data.values || [];
            const data = rows.slice(1);

            // Duplicate check
            const exists = data.some(r =>
                (r[5] || "").toLowerCase().trim() === faction.toLowerCase().trim() &&
                (r[6] || "").toLowerCase().trim() === address.toLowerCase().trim()
            );

            if (exists) {
                return interaction.reply({
                    content: "⚠️ This address already exists for this faction and was not added.",
                    ephemeral: true
                });
            }

            // Write to PropertyRewards (A–D)
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "PropertyRewards!A:D",
                valueInputOption: "RAW",
                requestBody: {
                    values: [[date, faction, address, type]]
                }
            });

            // Write to Sheet1 (F–H)
            const isHQ = type === "HQ" ? "TRUE" : "FALSE";

            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Sheet1!F:H",
                valueInputOption: "RAW",
                requestBody: {
                    values: [[faction, address, isHQ]]
                }
            });

            return interaction.reply(`✅ Property successfully added to:
• **PropertyRewards**  
• **Sheet1** (locations table)  

**Faction:** ${faction}  
**Address:** ${address}  
**Type:** ${type}  
**Date:** ${date}`);

        } catch (err) {
            console.error("ADD PROPERTY ERROR:", err);
            return interaction.reply("❌ An error occurred while writing to the Google Sheet.");
        }
    }

    // ---------------------------------------------------------
    // EXISTING COMMAND: /factioninfo
    // (unchanged from working version)
    // ---------------------------------------------------------
    
    if (interaction.commandName === "factioninfo") {
        const factionRequested = interaction.options.getString("faction").toLowerCase();

        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Sheet1!A1:H999"
            });

            const rows = res.data.values || [];
            const data = rows.slice(1);

            // PEOPLE TABLE — Columns A–E
            const peopleRows = data.filter(r =>
                r[0] && r[0].toLowerCase().trim() === factionRequested
            );

            const mergedPeople = {};
            for (const r of peopleRows) {
                const name = r[1] || "Unknown";
                const phone = r[2] || null;
                const address = r[3] || null;
                const isLeader = r[4] && r[4].toUpperCase() === "TRUE";

                if (!mergedPeople[name]) {
                    mergedPeople[name] = {
                        character: name,
                        phones: new Set(),
                        addresses: new Set(),
                        leader: false
                    };
                }
                if (phone) mergedPeople[name].phones.add(phone);
                if (address) mergedPeople[name].addresses.add(address);
                if (isLeader) mergedPeople[name].leader = true;
            }

            const mergedPeopleArray = Object.values(mergedPeople);

            // LOCATION TABLE — Columns F–H
            const locationRows = data.filter(r =>
                r[5] && r[5].toLowerCase().trim() === factionRequested
            );

            const hqs = [];
            const addresses = [];

            for (const r of locationRows) {
                const address = r[6] ? r[6].trim() : null;
                const isHQ = r[7] && r[7].toUpperCase() === "TRUE";
                if (!address) continue;

                if (isHQ) hqs.push(address);
                else addresses.push(address);
            }

            const embed = new EmbedBuilder()
                .setTitle(`📁 ${interaction.options.getString("faction")} Intelligence File`)
                .setColor(0x2b6cb0);

            // People section
            if (mergedPeopleArray.length > 0) {
                let peopleText = "";

                mergedPeopleArray.forEach((p, idx) => {
                    const phones = [...p.phones].map(ph => `📞 ${ph}`).join("\n");
                    const personalAddresses = [...p.addresses].map(a => `🏠 ${a}`).join("\n");

                    peopleText += `**${p.character}**${p.leader ? " (Leader)" : ""}\n`;
                    if (phones) peopleText += phones + "\n";
                    if (personalAddresses) peopleText += personalAddresses + "\n";

                    if (idx < mergedPeopleArray.length - 1)
                        peopleText += `──────────────\n`;
                });

                embed.addFields({ name: "Members", value: peopleText });
            } else {
                embed.addFields({
                    name: "Members",
                    value: "(This faction has no registered personnel.)"
                });
            }

            // Locations section
            let locText = "";
            hqs.forEach(addr => locText += `🏠 **HQ:** ${addr}\n`);
            addresses.forEach(addr => locText += `📍 ${addr}\n`);

            embed.addFields({
                name: "Locations",
                value: locText || "No addresses listed."
            });

            return interaction.reply({ embeds: [embed] });

        } catch (err) {
            console.error("COMMAND ERROR:", err);
            return interaction.reply("There was an error accessing the Google Sheet.");
        }
    }
});

deployCommands();
client.login(DISCORD_TOKEN);
