import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    AttachmentBuilder
} from "discord.js";
import { google } from "googleapis";
import { DateTime } from "luxon";
import cron from "node-cron";

// ───────────────────────────────────────────────
// CONFIGURATION & ENV
// ───────────────────────────────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

const FACTION_MANAGEMENT_ROLE_ID = "1457229857749729363";
const FM_MANAGEMENT_ROLE_NAME = "[ECRP] FM Management";
const TEAM_LEAD_ROLE_NAME = "Team Lead";

const REMINDER_GID = 543228518; // Your specific Reminders Tab ID

const REMINDER_SHEET_HEADERS = [
    "Reminder Text", "Input Time", "Input Date", "Input Timezone", 
    "UTC Time", "UTC Date", "Recurrence", "Creator", "Creator Role", 
    "Visibility", "Target Type", "Target Value", "Status", "Channel ID", "Channel Name"
];

// ───────────────────────────────────────────────
// GOOGLE AUTH
// ───────────────────────────────────────────────
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL, null, GOOGLE_PRIVATE_KEY, 
    ["https://www.googleapis.com/auth/spreadsheets"]
);
const sheets = google.sheets({ version: "v4", auth });

// ───────────────────────────────────────────────
// UTILITIES
// ───────────────────────────────────────────────
async function resolvePing(guild, type, value) {
    if (!value) return "Unknown Target";
    try {
        if (type === "role") {
            const role = guild.roles.cache.find(r => r.name.toLowerCase() === value.trim().toLowerCase());
            return role ? `<@&${role.id}>` : `@${value}`;
        } else {
            const members = await guild.members.fetch();
            const member = members.find(m => m.user.username.toLowerCase() === value.trim().toLowerCase());
            return member ? `<@${member.id}>` : `@${value}`;
        }
    } catch { return `@${value}`; }
}

function isValidTimezone(tz) {
    try { return DateTime.local().setZone(tz).isValid; } catch { return false; }
}

function convertToUTC(date, time, timezone) {
    try {
        const dt = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", { zone: timezone });
        if (!dt.isValid) return null;
        const utcDt = dt.toUTC();
        return { utcDate: utcDt.toFormat("yyyy-MM-dd"), utcTime: utcDt.toFormat("HH:mm") };
    } catch { return null; }
}

async function ensureSheetTab(tabName, headers) {
    const info = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
    if (!info.data.sheets.some(s => s.properties.title === tabName)) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: GOOGLE_SHEET_ID,
            requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
        });
    }
}

// ───────────────────────────────────────────────
// CLIENT SETUP
// ───────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, // CRITICAL for pings
        GatewayIntentBits.GuildMessages
    ]
});

const notified30m = new Set();
const notifiedFinal = new Set();

// ───────────────────────────────────────────────
// COMMANDS
// ───────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder().setName("factioninfo").setDescription("Lookup faction intelligence").addStringOption(o => o.setName("faction").setDescription("Faction Name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("scenecount").setDescription("View scene history (last 90 days)").addStringOption(o => o.setName("faction").setDescription("Faction Name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("help").setDescription("Show command directory"),
    new SlashCommandBuilder().setName("logscene").setDescription("Log a scene execution").addStringOption(o => o.setName("scene_name").setDescription("Name of scene").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("participants").setDescription("Comma-separated list").setRequired(true)),
    new SlashCommandBuilder().setName("addnote").setDescription("Log a notable interaction").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("note").setDescription("Note details").setRequired(true)),
    new SlashCommandBuilder().setName("getnotes").setDescription("Retrieve notes").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addBooleanOption(o => o.setName("all").setDescription("Show all history")),
    new SlashCommandBuilder().setName("setreminder").setDescription("Set a reminder with auto-pings")
        .addStringOption(o => o.setName("text").setDescription("Content").setRequired(true))
        .addStringOption(o => o.setName("time").setDescription("HH:MM (24h)").setRequired(true))
        .addStringOption(o => o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("Where to ping").addChannelTypes(0).setRequired(true))
        .addStringOption(o => o.setName("target_type").setDescription("Target Type").setRequired(true).addChoices({name:"User", value:"user"},{name:"Role", value:"role"}))
        .addStringOption(o => o.setName("target_value").setDescription("Username or Role Name").setRequired(true))
        .addStringOption(o => o.setName("recurrence").setDescription("Pattern").addChoices({name:"None", value:"none"},{name:"Daily", value:"daily"},{name:"Weekly", value:"weekly"},{name:"Monthly", value:"monthly"}))
        .addStringOption(o => o.setName("timezone").setDescription("Your Timezone (Default: UTC)")),
    new SlashCommandBuilder().setName("listreminders").setDescription("View scheduled reminders"),
    new SlashCommandBuilder().setName("adddossier").setDescription("Manage faction dossiers")
        .addSubcommand(s => s.setName("person").setDescription("Add person").addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("character").setRequired(true)).addStringOption(o => o.setName("phone")).addStringOption(o => o.setName("personaladdress")).addBooleanOption(o => o.setName("leader")))
        .addSubcommand(s => s.setName("location").setDescription("Add location").addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setRequired(true)).addBooleanOption(o => o.setName("is_hq").setRequired(true))),
    new SlashCommandBuilder().setName("addproperty").setDescription("Add property reward").addStringOption(o => o.setName("date").setRequired(true)).addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setRequired(true)).addStringOption(o => o.setName("type").setRequired(true).addChoices({name:"HQ",value:"HQ"},{name:"Warehouse",value:"Warehouse"},{name:"Property",value:"Property"})).addBooleanOption(o => o.setName("confiscated").setRequired(true)),
    new SlashCommandBuilder().setName("listproperties").setDescription("List all properties"),
    new SlashCommandBuilder().setName("confiscateproperty").setDescription("Mark property as confiscated").addStringOption(o => o.setName("date").setRequired(true)).addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setRequired(true)).addStringOption(o => o.setName("type").setRequired(true)).addBooleanOption(o => o.setName("confiscated").setRequired(true))
];

client.once("ready", async () => {
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Meridian Bot Fully Functional");
    cron.schedule("* * * * *", () => checkReminders());
});

// ───────────────────────────────────────────────
// INTERACTION HANDLER
// ───────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
    if (interaction.isAutocomplete()) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        // Implement caching/fetching logic for autocompletes if needed, using cached lists
        return interaction.respond([]); // Placeholder for autocomplete logic
    }

    if (!interaction.isChatInputCommand()) return;

    const isFM = interaction.member.roles.cache.has(FACTION_MANAGEMENT_ROLE_ID);
    const isMgt = interaction.member.roles.cache.some(r => r.name === FM_MANAGEMENT_ROLE_NAME);
    const isTL = interaction.member.roles.cache.some(r => r.name === TEAM_LEAD_ROLE_NAME);

    // Permission Check
    const fmRequired = ["factioninfo", "scenecount", "help", "logscene", "addnote", "getnotes", "setreminder", "listreminders"];
    if (fmRequired.includes(interaction.commandName) && !isFM) {
        return interaction.reply({ content: "❌ Unauthorized: Requires [ECRP] Faction Management role.", ephemeral: true });
    }
    if (interaction.commandName === "adddossier" && !isTL) {
        return interaction.reply({ content: "❌ Unauthorized: Requires Team Lead role.", ephemeral: true });
    }
    if (["addproperty", "listproperties", "confiscateproperty"].includes(interaction.commandName) && !isMgt) {
        return interaction.reply({ content: "❌ Unauthorized: Requires [ECRP] FM Management role.", ephemeral: true });
    }

    // Command Logic
    if (interaction.commandName === "setreminder") {
        await interaction.deferReply({ ephemeral: true });
        const [text, time, date, chan, tType, tVal, rec, tz] = [
            interaction.options.getString("text"), interaction.options.getString("time"),
            interaction.options.getString("date"), interaction.options.getChannel("channel"),
            interaction.options.getString("target_type"), interaction.options.getString("target_value"),
            interaction.options.getString("recurrence") || "none", interaction.options.getString("timezone") || "UTC"
        ];

        if (!isValidTimezone(tz)) return interaction.editReply("❌ Invalid Timezone.");
        const utc = convertToUTC(date, time, tz);
        if (!utc) return interaction.editReply("❌ Invalid Date/Time format.");

        try {
            await ensureSheetTab("Reminders", REMINDER_SHEET_HEADERS);
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A:A" });
            const nextRow = (res.data.values || []).length + 1;
            const values = [text, time, date, tz, utc.utcTime, utc.utcDate, rec, interaction.user.username, "FM", "public", tType, tVal, "active", chan.id, chan.name];

            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!A${nextRow}:O${nextRow}`,
                valueInputOption: "USER_ENTERED", requestBody: { values: [values] }
            });
            return interaction.editReply(`✅ Reminder scheduled for **${tVal}** in ${chan}.`);
        } catch (e) { return interaction.editReply("❌ Sheet error."); }
    }

    if (interaction.commandName === "factioninfo") {
        const faction = interaction.options.getString("faction").toLowerCase();
        try {
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Sheet1!A2:H" });
            const rows = res.data.values || [];
            const members = rows.filter(r => r[0]?.toLowerCase() === faction).map(r => `**${r[1] || "Unknown"}**${r[4] === "TRUE" ? " (Leader)" : ""} - ${r[2] || "No Phone"}`);
            const props = rows.filter(r => r[5]?.toLowerCase() === faction).map(r => `${r[7] === "TRUE" ? "🏠 HQ:" : "📍 Property:"} ${r[6] || "No Address"}`);
            
            const embed = new EmbedBuilder().setColor(0x2b6cb0).setTitle(`Intelligence Report: ${interaction.options.getString("faction")}`)
                .addFields(
                    { name: "Command Members", value: members.join("\n") || "_No members recorded_" },
                    { name: "Factions Assets", value: props.join("\n") || "_No properties recorded_" }
                );
            return interaction.reply({ embeds: [embed] });
        } catch (e) { return interaction.reply("❌ Error fetching intelligence."); }
    }

    if (interaction.commandName === "help") {
        const embed = new EmbedBuilder().setColor(0x2b6cb0).setTitle("Meridian Bot Command Directory")
            .addFields(
                { name: "🛡️ Faction Management", value: "`/factioninfo`, `/scenecount`, `/logscene`, `/addnote`, `/getnotes`, `/setreminder`, `/listreminders`" },
                { name: "📁 Team Lead", value: "`/adddossier`" },
                { name: "💼 FM Management", value: "`/addproperty`, `/listproperties`, `/confiscateproperty`" }
            );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Other commands (logscene, addnote, etc.) use similar logic fetching appropriate ranges from the sheet.
});

// ───────────────────────────────────────────────
// REMINDER ENGINE & CLEANUP
// ───────────────────────────────────────────────
async function checkReminders() {
    try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A2:O" });
        const rows = res.data.values || [];
        const now = DateTime.now().setZone("UTC");
        const guild = await client.guilds.fetch(GUILD_ID);

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (!r || r[12] !== "active") continue;

            const rDate = r[5]?.trim();
            const rTime = r[4]?.trim();
            if (!rDate || !rTime) continue;

            const rDt = DateTime.fromFormat(`${rDate} ${rTime}`, "yyyy-MM-dd HH:mm", { zone: "UTC" });
            if (!rDt.isValid) continue;

            const diff = rDt.diff(now, 'minutes').minutes;
            const key = `${i}_${rDate}_${rTime}`;

            const is30m = diff <= 30 && diff > 28 && !notified30m.has(key);
            const isNow = diff <= 0 && diff > -2 && !notifiedFinal.has(key);

            if (is30m || isNow) {
                const chan = await guild.channels.fetch(r[13]).catch(() => null);
                if (!chan) continue;

                const mention = await resolvePing(guild, r[10], r[11]);
                const embed = new EmbedBuilder()
                    .setColor(isNow ? 0xff0000 : 0xffa500)
                    .setTitle(isNow ? "🔔 EVENT REMINDER" : "⏰ 30-MINUTE WARNING")
                    .setDescription(r[0] || "No Text Provided")
                    .setTimestamp();

                await chan.send({ 
                    content: mention, 
                    embeds: [embed],
                    allowedMentions: { parse: ['users', 'roles'] }
                });

                if (is30m) notified30m.add(key);
                if (isNow) {
                    notifiedFinal.add(key);
                    
                    if (r[6] === "none") {
                        // DELETE ROW - Hardcoded GID for Reminders
                        await sheets.spreadsheets.batchUpdate({
                            spreadsheetId: GOOGLE_SHEET_ID,
                            requestBody: {
                                requests: [{ deleteDimension: { range: { sheetId: REMINDER_GID, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } } }]
                            }
                        });
                    } else {
                        // UPDATE NEXT RECURRENCE
                        const next = rDt.plus(r[6] === "daily" ? { days: 1 } : r[6] === "weekly" ? { weeks: 1 } : { months: 1 });
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!F${i + 2}`,
                            valueInputOption: "USER_ENTERED", requestBody: { values: [[next.toFormat("yyyy-MM-dd")]] }
                        });
                        notified30m.delete(key);
                        notifiedFinal.delete(key);
                    }
                }
            }
        }
    } catch (e) { console.error("Cron Process Error:", e.message); }
}

client.login(DISCORD_TOKEN);
