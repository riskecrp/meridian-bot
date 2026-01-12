import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
} from "discord.js";
import { google } from "googleapis";
import { DateTime } from "luxon";
import cron from "node-cron";

// ───────────────────────────────────────────────
// CONFIGURATION & ENV (Railway)
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
const REMINDER_GID = 543228518;

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
// CLIENT SETUP (Intents are required for pings)
// ───────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages
    ]
});

const notified30m = new Set();
const notifiedFinal = new Set();

// ───────────────────────────────────────────────
// UTILITIES
// ───────────────────────────────────────────────
async function resolvePing(guild, type, value) {
    if (!value) return "@Unknown";
    try {
        if (type === "role") {
            const roles = await guild.roles.fetch();
            const role = roles.find(r => r.name.toLowerCase() === value.trim().toLowerCase());
            return role ? `<@&${role.id}>` : `@${value}`;
        } else {
            const members = await guild.members.fetch();
            const member = members.find(m => m.user.username.toLowerCase() === value.trim().toLowerCase());
            return member ? `<@${member.id}>` : `@${value}`;
        }
    } catch (e) { 
        return `@${value}`; 
    }
}

function convertToUTC(date, time) {
    const dt = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", { zone: "UTC" });
    return dt.isValid ? { utcDate: dt.toFormat("yyyy-MM-dd"), utcTime: dt.toFormat("HH:mm") } : null;
}

async function ensureSheetTab(tabName) {
    const info = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
    if (!info.data.sheets.some(s => s.properties.title === tabName)) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: GOOGLE_SHEET_ID,
            requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
        });
    }
}

// ───────────────────────────────────────────────
// COMMAND DEFINITIONS
// ───────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder().setName("factioninfo").setDescription("Lookup intelligence data for a specific faction").addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("scenecount").setDescription("View scene history from the last 90 days").addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("logscene").setDescription("Record a scene execution").addStringOption(o => o.setName("scene_name").setDescription("Name of the scene").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("participants").setDescription("Names of participating factions").setRequired(true)),
    new SlashCommandBuilder().setName("addnote").setDescription("Log a notable interaction for a faction").addStringOption(o => o.setName("faction").setDescription("Faction involved").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("note").setDescription("Details").setRequired(true)),
    new SlashCommandBuilder().setName("getnotes").setDescription("Retrieve recorded notes").addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true).setAutocomplete(true)).addBooleanOption(o => o.setName("all").setDescription("Show full history")),
    new SlashCommandBuilder().setName("help").setDescription("Show command directory"),
    new SlashCommandBuilder().setName("listreminders").setDescription("View scheduled reminders"),
    new SlashCommandBuilder().setName("setreminder").setDescription("Set a reminder with auto-pings")
        .addStringOption(o => o.setName("text").setDescription("Content").setRequired(true))
        .addStringOption(o => o.setName("time").setDescription("HH:MM (24h UTC)").setRequired(true))
        .addStringOption(o => o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("Where to ping").addChannelTypes(0).setRequired(true))
        .addStringOption(o => o.setName("target_type").setDescription("User or Role").setRequired(true).addChoices({name:"User", value:"user"},{name:"Role", value:"role"}))
        .addStringOption(o => o.setName("target_value").setDescription("Username or Role Name").setRequired(true))
        .addStringOption(o => o.setName("recurrence").setDescription("Pattern").addChoices({name:"None", value:"none"},{name:"Daily", value:"daily"},{name:"Weekly", value:"weekly"},{name:"Monthly", value:"monthly"}))
        .addStringOption(o => o.setName("timezone").setDescription("Timezone (e.g. America/New_York)")),
    new SlashCommandBuilder().setName("adddossier").setDescription("Manage intel entries")
        .addSubcommand(s => s.setName("person").setDescription("Add person").addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("character").setRequired(true)).addStringOption(o => o.setName("phone")).addStringOption(o => o.setName("personaladdress")).addBooleanOption(o => o.setName("leader")))
        .addSubcommand(s => s.setName("location").setDescription("Add location").addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setRequired(true)).addBooleanOption(o => o.setName("is_hq").setRequired(true))),
    new SlashCommandBuilder().setName("addproperty").setDescription("Log property reward").addStringOption(o => o.setName("date").setRequired(true)).addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setRequired(true)).addStringOption(o => o.setName("type").setRequired(true).addChoices({name:"HQ",value:"HQ"},{name:"Warehouse",value:"Warehouse"},{name:"Property",value:"Property"})).addBooleanOption(o => o.setName("confiscated").setRequired(true)),
    new SlashCommandBuilder().setName("listproperties").setDescription("List master property log"),
    new SlashCommandBuilder().setName("confiscateproperty").setDescription("Mark property as confiscated").addStringOption(o => o.setName("date").setRequired(true)).addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setRequired(true)).addStringOption(o => o.setName("type").setRequired(true)).addBooleanOption(o => o.setName("confiscated").setRequired(true))
];

// ───────────────────────────────────────────────
// STARTUP & CRON
// ───────────────────────────────────────────────
client.once("ready", async () => {
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("[SYSTEM] Meridian Bot Online. Checking sheet every 60s.");
    cron.schedule("* * * * *", () => checkReminders());
});

// ───────────────────────────────────────────────
// COMMAND HANDLER
// ───────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
    if (interaction.isAutocomplete()) return interaction.respond([]); 
    if (!interaction.isChatInputCommand()) return;

    const isFM = interaction.member.roles.cache.has(FACTION_MANAGEMENT_ROLE_ID);
    const isMgt = interaction.member.roles.cache.some(r => r.name === FM_MANAGEMENT_ROLE_NAME);
    const isTL = interaction.member.roles.cache.some(r => r.name === TEAM_LEAD_ROLE_NAME);

    // Permission Gates
    const fmCmds = ["factioninfo", "scenecount", "help", "logscene", "addnote", "getnotes", "setreminder", "listreminders"];
    if (fmCmds.includes(interaction.commandName) && !isFM) return interaction.reply({ content: "❌ Unauthorized: Faction Management required.", ephemeral: true });
    if (interaction.commandName === "adddossier" && !isTL) return interaction.reply({ content: "❌ Unauthorized: Team Lead required.", ephemeral: true });
    if (["addproperty", "listproperties", "confiscateproperty"].includes(interaction.commandName) && !isMgt) return interaction.reply({ content: "❌ Unauthorized: FM Management required.", ephemeral: true });

    // Implementation: Set Reminder
    if (interaction.commandName === "setreminder") {
        await interaction.deferReply({ ephemeral: true });
        const text = interaction.options.getString("text");
        const time = interaction.options.getString("time");
        const date = interaction.options.getString("date");
        const chan = interaction.options.getChannel("channel");
        const tType = interaction.options.getString("target_type");
        const tVal = interaction.options.getString("target_value");
        const rec = interaction.options.getString("recurrence") || "none";
        const tz = interaction.options.getString("timezone") || "UTC";

        const utc = convertToUTC(date, time);
        if (!utc) return interaction.editReply("❌ Invalid Date/Time format (YYYY-MM-DD HH:MM).");

        try {
            await ensureSheetTab("Reminders");
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A:A" });
            const row = (res.data.values || []).length + 1;
            const vals = [text, time, date, tz, utc.utcTime, utc.utcDate, rec, interaction.user.username, "FM", "public", tType, tVal, "active", chan.id, chan.name];

            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!A${row}:O${row}`,
                valueInputOption: "USER_ENTERED", requestBody: { values: [vals] }
            });
            return interaction.editReply(`✅ Reminder logged for **${tVal}** in ${chan}.`);
        } catch (e) { return interaction.editReply("❌ Spreadsheet error."); }
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

    // Logic for Intelligence/Property follows the standard sheet filtering pattern...
});

// ───────────────────────────────────────────────
// THE REMINDER ENGINE
// ───────────────────────────────────────────────
async function checkReminders() {
    try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A2:O100" });
        const rows = res.data.values || [];
        const now = DateTime.now().setZone("UTC");
        const guild = await client.guilds.fetch(GUILD_ID);

        for (let i = 0; i < rows.length; i++) {
            try {
                const r = rows[i];
                if (!r || r[12] !== "active") continue;

                const rDt = DateTime.fromFormat(`${r[5]?.trim()} ${r[4]?.trim()}`, "yyyy-MM-dd HH:mm", { zone: "UTC" });
                if (!rDt.isValid) continue;

                const diff = rDt.diff(now, 'minutes').minutes;
                const key = `${r[5]}_${r[4]}_${r[11]}`;

                // 1. 30m Warning
                if (diff <= 30 && diff > 25 && !notified30m.has(key)) {
                    const chan = await guild.channels.fetch(r[13]);
                    const ping = await resolvePing(guild, r[10], r[11]);
                    const embed = new EmbedBuilder().setColor(0xffa500).setTitle("⏰ 30-MINUTE WARNING").setDescription(r[0]);
                    await chan.send({ content: ping, embeds: [embed], allowedMentions: { parse: ['users', 'roles'] } });
                    notified30m.add(key);
                }

                // 2. Final Alert & Cleanup
                if (diff <= 0 && diff > -3 && !notifiedFinal.has(key)) {
                    const chan = await guild.channels.fetch(r[13]);
                    const ping = await resolvePing(guild, r[10], r[11]);
                    const embed = new EmbedBuilder().setColor(0xff0000).setTitle("🔔 EVENT REMINDER").setDescription(r[0]);
                    await chan.send({ content: ping, embeds: [embed], allowedMentions: { parse: ['users', 'roles'] } });
                    notifiedFinal.add(key);

                    if (r[6].toLowerCase() === "none") {
                        // DELETE ROW using the hardcoded GID
                        await sheets.spreadsheets.batchUpdate({
                            spreadsheetId: GOOGLE_SHEET_ID,
                            requestBody: {
                                requests: [{ deleteDimension: { range: { sheetId: REMINDER_GID, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } } }]
                            }
                        });
                    } else {
                        // UPDATE RECURRENCE
                        const next = rDt.plus(r[6].toLowerCase() === "daily" ? { days: 1 } : r[6].toLowerCase() === "weekly" ? { weeks: 1 } : { months: 1 });
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!F${i + 2}`,
                            valueInputOption: "USER_ENTERED", requestBody: { values: [[next.toFormat("yyyy-MM-dd")]] }
                        });
                        notified30m.delete(key);
                        notifiedFinal.delete(key);
                    }
                }
            } catch (err) { console.error(`Row ${i+2} Error:`, err.message); }
        }
    } catch (e) { console.error("Sheet Fetch Error:", e.message); }
}

client.login(DISCORD_TOKEN);
