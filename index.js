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

const REMINDER_SHEET_HEADERS = [
    "Reminder Text", "Input Time", "Input Date", "Input Timezone", 
    "UTC Time", "UTC Date", "Recurrence", "Creator", "Creator Role", 
    "Visibility", "Target Type", "Target Value", "Status", "Channel ID", "Channel Name"
];

// ───────────────────────────────────────────────
// GOOGLE SHEETS SETUP
// ───────────────────────────────────────────────
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL, null, GOOGLE_PRIVATE_KEY, 
    ["https://www.googleapis.com/auth/spreadsheets"]
);
const sheets = google.sheets({ version: "v4", auth });

// ───────────────────────────────────────────────
// UTILITIES
// ───────────────────────────────────────────────
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

function numberToColumnLetter(num) {
    let letter = '';
    while (num > 0) {
        let remainder = (num - 1) % 26;
        letter = String.fromCharCode(65 + remainder) + letter;
        num = Math.floor((num - 1) / 26);
    }
    return letter;
}

async function ensureSheetTab(tabName, headers) {
    const info = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
    if (!info.data.sheets.some(s => s.properties.title === tabName)) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: GOOGLE_SHEET_ID,
            requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
        });
    }
    const lastCol = numberToColumnLetter(headers.length);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${tabName}!A1:${lastCol}1` });
    if (!res.data.values?.[0]) {
        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEET_ID, range: `${tabName}!A1:${lastCol}1`,
            valueInputOption: "USER_ENTERED", requestBody: { values: [headers] }
        });
    }
}

async function findNextRow(tab, col = "A") {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${tab}!${col}:${col}` });
    return (res.data.values || []).length + 1;
}

// ───────────────────────────────────────────────
// COMMAND DEFINITIONS
// ───────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder().setName("factioninfo").setDescription("Lookup faction info").addStringOption(o => o.setName("faction").setDescription("Faction Name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("scenecount").setDescription("View scene history").addStringOption(o => o.setName("faction").setDescription("Faction Name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("logscene").setDescription("Log a scene").addStringOption(o => o.setName("scene_name").setDescription("Scene Name").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("participants").setDescription("Comma separated list").setRequired(true)),
    new SlashCommandBuilder().setName("addnote").setDescription("Log interaction").addStringOption(o => o.setName("faction").setDescription("Faction Name").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("note").setDescription("Note text").setRequired(true)),
    new SlashCommandBuilder().setName("getnotes").setDescription("View notes").addStringOption(o => o.setName("faction").setDescription("Faction Name").setRequired(true).setAutocomplete(true)).addBooleanOption(o => o.setName("all").setDescription("Show all history?")),
    new SlashCommandBuilder().setName("help").setDescription("Show command list"),
    new SlashCommandBuilder().setName("listreminders").setDescription("View scheduled reminders"),
    new SlashCommandBuilder().setName("setreminder").setDescription("Set a reminder with 30m warning")
        .addStringOption(o => o.setName("text").setDescription("Reminder text").setRequired(true))
        .addStringOption(o => o.setName("time").setDescription("HH:MM (24h)").setRequired(true))
        .addStringOption(o => o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("Where to ping").addChannelTypes(0).setRequired(true))
        .addStringOption(o => o.setName("target_type").setDescription("User or Role").setRequired(true).addChoices({name:"User", value:"user"}, {name:"Role", value:"role"}))
        .addStringOption(o => o.setName("target_value").setDescription("Username or Role Name").setRequired(true))
        .addStringOption(o => o.setName("recurrence").setDescription("Recurrence").addChoices({name:"None", value:"none"},{name:"Daily", value:"daily"},{name:"Weekly", value:"weekly"},{name:"Monthly", value:"monthly"}))
        .addStringOption(o => o.setName("timezone").setDescription("Timezone")),
    new SlashCommandBuilder().setName("adddossier").setDescription("Manage dossiers")
        .addSubcommand(s => s.setName("person").setDescription("Add person").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("character").setDescription("Name").setRequired(true)).addStringOption(o => o.setName("phone").setDescription("Phone")).addStringOption(o => o.setName("personaladdress").setDescription("Address")).addBooleanOption(o => o.setName("leader").setDescription("Leader?")))
        .addSubcommand(s => s.setName("location").setDescription("Add location").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setDescription("Address").setRequired(true)).addBooleanOption(o => o.setName("is_hq").setDescription("HQ?").setRequired(true))),
    new SlashCommandBuilder().setName("addproperty").setDescription("Add property").addStringOption(o => o.setName("date").setDescription("YYYY-MM-DD").setRequired(true)).addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setRequired(true)).addStringOption(o => o.setName("type").setRequired(true).addChoices({name:"HQ",value:"HQ"},{name:"Warehouse",value:"Warehouse"},{name:"Property",value:"Property"})).addBooleanOption(o => o.setName("confiscated").setRequired(true)),
    new SlashCommandBuilder().setName("listproperties").setDescription("List all properties"),
    new SlashCommandBuilder().setName("confiscateproperty").setDescription("Mark as confiscated").addStringOption(o => o.setName("date").setRequired(true)).addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setRequired(true)).addStringOption(o => o.setName("type").setRequired(true)).addBooleanOption(o => o.setName("confiscated").setRequired(true))
];

// ───────────────────────────────────────────────
// CLIENT & LOGIC
// ───────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let cachedFactions = [];
let cachedScenes = [];
const notified30m = new Set();
const notifiedFinal = new Set();

client.once("ready", async () => {
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Meridian Bot Ready");
    cron.schedule("* * * * *", () => checkReminders());
});

client.on("interactionCreate", async interaction => {
    if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused().toLowerCase();
        if (interaction.options.getFocused(true).name === "scene_name") {
            if (!cachedScenes.length) {
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "One Off Scenes!A2:A" });
                cachedScenes = (res.data.values || []).map(r => r[0]);
            }
            return interaction.respond(cachedScenes.filter(s => s.toLowerCase().includes(focused)).slice(0, 25).map(s => ({ name: s, value: s })));
        }
        if (!cachedFactions.length) {
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Sheet1!A2:H" });
            const set = new Set();
            (res.data.values || []).forEach(r => { if (r[0]) set.add(r[0]); if (r[5]) set.add(r[5]); });
            cachedFactions = [...set];
        }
        return interaction.respond(cachedFactions.filter(f => f.toLowerCase().includes(focused)).slice(0, 25).map(f => ({ name: f, value: f })));
    }

    if (!interaction.isChatInputCommand()) return;

    const isFM = interaction.member.roles.cache.has(FACTION_MANAGEMENT_ROLE_ID);
    const isMgt = interaction.member.roles.cache.some(r => r.name === FM_MANAGEMENT_ROLE_NAME);
    const isTL = interaction.member.roles.cache.some(r => r.name === TEAM_LEAD_ROLE_NAME);

    // Permission Gates
    const fmCmds = ["factioninfo", "scenecount", "help", "logscene", "addnote", "getnotes", "setreminder", "listreminders"];
    if (fmCmds.includes(interaction.commandName) && !isFM) return interaction.reply({ content: "Unauthorized: [ECRP] Faction Management required.", ephemeral: true });
    if (interaction.commandName === "adddossier" && !isTL) return interaction.reply({ content: "Unauthorized: Team Lead required.", ephemeral: true });
    if (["addproperty", "listproperties", "confiscateproperty"].includes(interaction.commandName) && !isMgt) return interaction.reply({ content: "Unauthorized: [ECRP] FM Management required.", ephemeral: true });

    // Implementation
    if (interaction.commandName === "setreminder") {
        await interaction.deferReply({ ephemeral: true });
        const [text, time, date, chan, tType, tVal, rec, tz] = [interaction.options.getString("text"), interaction.options.getString("time"), interaction.options.getString("date"), interaction.options.getChannel("channel"), interaction.options.getString("target_type"), interaction.options.getString("target_value"), interaction.options.getString("recurrence") || "none", interaction.options.getString("timezone") || "UTC"];
        if (!isValidTimezone(tz)) return interaction.editReply("Invalid Timezone.");
        const utc = convertToUTC(date, time, tz);
        if (!utc) return interaction.editReply("Invalid Date/Time.");
        
        await ensureSheetTab("Reminders", REMINDER_SHEET_HEADERS);
        const row = await findNextRow("Reminders");
        const values = [text, time, date, tz, utc.utcTime, utc.utcDate, rec, interaction.user.username, "FM", "public", tType, tVal, "active", chan.id, chan.name];
        await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!A${row}:O${row}`, valueInputOption: "USER_ENTERED", requestBody: { values: [values] } });
        return interaction.editReply(`✅ Reminder set in ${chan} for ${tVal}.`);
    }

    if (interaction.commandName === "factioninfo") {
        const faction = interaction.options.getString("faction").toLowerCase();
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Sheet1!A2:H" });
        const rows = res.data.values || [];
        const members = rows.filter(r => r[0]?.toLowerCase() === faction).map(r => `**${r[1]}**${r[4] === "TRUE" ? " (L)" : ""} - ${r[2]}`);
        const props = rows.filter(r => r[5]?.toLowerCase() === faction).map(r => `${r[7] === "TRUE" ? "🏠" : "📍"} ${r[6]}`);
        const embed = new EmbedBuilder().setColor(0x2b6cb0).setTitle(`Faction: ${interaction.options.getString("faction")}`)
            .addFields({ name: "Members", value: members.join("\n") || "None" }, { name: "Properties", value: props.join("\n") || "None" });
        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "logscene") {
        await interaction.deferReply({ ephemeral: true });
        const name = interaction.options.getString("scene_name");
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "One Off Scenes!A2:G" });
        const rows = res.data.values || [];
        const idx = rows.findIndex(r => r[0]?.toLowerCase() === name.toLowerCase());
        if (idx === -1) return interaction.editReply("Scene not found.");
        const count = parseInt(rows[idx][4] || "0") + 1;
        const participants = rows[idx][5] ? `${rows[idx][5]}, ${interaction.options.getString("participants")}` : interaction.options.getString("participants");
        await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `One Off Scenes!E${idx + 2}:G${idx + 2}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[count, participants, DateTime.now().toISODate()]] } });
        return interaction.editReply(`✅ Logged ${name}. Count: ${count}`);
    }

    if (interaction.commandName === "help") {
        const embed = new EmbedBuilder().setColor(0x2b6cb0).setTitle("Meridian Bot Help")
            .setDescription("**/setreminder**: Create pings\n**/factioninfo**: Lookup stats\n**/logscene**: Record RP activity\n**/adddossier**: (TL) Add intel\n**/addproperty**: (Mgt) Log assets");
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    // ... (Remaining property and note commands follow similar logic to previous version)
});

// ───────────────────────────────────────────────
// BACKGROUND REMINDER CHECKER
// ───────────────────────────────────────────────
async function checkReminders() {
    try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A2:O" });
        const rows = res.data.values || [];
        const now = DateTime.now().setZone("UTC");
        const guild = await client.guilds.fetch(GUILD_ID);

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const rDt = DateTime.fromFormat(`${r[5]} ${r[4]}`, "yyyy-MM-dd HH:mm", { zone: "UTC" });
            if (!rDt.isValid) continue;

            const diff = rDt.diff(now, 'minutes').minutes;
            const key = `${i}_${r[5]}_${r[4]}`;
            const chan = await guild.channels.fetch(r[13]);
            
            let mention = r[11];
            if (r[10] === "role") {
                const role = guild.roles.cache.find(rl => rl.name.toLowerCase() === r[11].toLowerCase());
                if (role) mention = `<@&${role.id}>`;
            } else {
                const mem = (await guild.members.fetch()).find(m => m.user.username.toLowerCase() === r[11].toLowerCase());
                if (mem) mention = `<@${mem.id}>`;
            }

            // 30m Warning
            if (diff <= 30 && diff > 25 && !notified30m.has(key)) {
                await chan.send({ content: `${mention}`, embeds: [new EmbedBuilder().setColor(0xffa500).setTitle("30m Warning").setDescription(r[0])] });
                notified30m.add(key);
            }

            // Final Alert & Cleanup/Recurrence
            if (diff <= 0 && diff > -5 && !notifiedFinal.has(key)) {
                await chan.send({ content: `${mention}`, embeds: [new EmbedBuilder().setColor(0xff0000).setTitle("REMINDER").setDescription(r[0])] });
                notifiedFinal.add(key);

                if (r[6] === "none") {
                    // DELETE the row if it's not recurring
                    await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        requestBody: {
                            requests: [{ deleteDimension: { range: { sheetId: (await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID })).data.sheets.find(s => s.properties.title === "Reminders").properties.sheetId, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } } }]
                        }
                    });
                } else {
                    // Update for recurrence
                    const next = rDt.plus(r[6] === "daily" ? { days: 1 } : r[6] === "weekly" ? { weeks: 1 } : { months: 1 });
                    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!F${i + 2}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[next.toFormat("yyyy-MM-dd")]] } });
                    notified30m.delete(key);
                    notifiedFinal.delete(key);
                }
            }
        }
    } catch (e) { console.error("Loop Error:", e); }
}

client.login(DISCORD_TOKEN);
