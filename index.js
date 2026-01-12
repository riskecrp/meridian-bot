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

const REMINDER_GID = 543228518;

const REMINDER_SHEET_HEADERS = [
    "Reminder Text", "Input Time", "Input Date", "Input Timezone", 
    "UTC Time", "UTC Date", "Recurrence", "Creator", "Creator Role", 
    "Visibility", "Target Type", "Target Value", "Status", "Channel ID", "Channel Name"
];

// ───────────────────────────────────────────────
// GOOGLE AUTH & SETUP
// ───────────────────────────────────────────────
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL, null, GOOGLE_PRIVATE_KEY, 
    ["https://www.googleapis.com/auth/spreadsheets"]
);
const sheets = google.sheets({ version: "v4", auth });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages
    ]
});

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
// COMMANDS (ALL DESCRIPTIONS ADDED TO PREVENT CRASH)
// ───────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder()
        .setName("factioninfo")
        .setDescription("Lookup intelligence data for a specific faction")
        .addStringOption(o => o.setName("faction").setDescription("The name of the faction").setRequired(true).setAutocomplete(true)),
    
    new SlashCommandBuilder()
        .setName("scenecount")
        .setDescription("View scene history for a faction from the last 90 days")
        .addStringOption(o => o.setName("faction").setDescription("The name of the faction").setRequired(true).setAutocomplete(true)),
    
    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show the bot command directory and permissions guide"),
    
    new SlashCommandBuilder()
        .setName("logscene")
        .setDescription("Record a scene execution in the database")
        .addStringOption(o => o.setName("scene_name").setDescription("Name of the scene").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("participants").setDescription("Names of participating factions/individuals").setRequired(true)),
    
    new SlashCommandBuilder()
        .setName("addnote")
        .setDescription("Log a notable interaction for a faction")
        .addStringOption(o => o.setName("faction").setDescription("The faction involved").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("note").setDescription("Details of the interaction").setRequired(true)),
    
    new SlashCommandBuilder()
        .setName("getnotes")
        .setDescription("Retrieve recorded notes for a faction")
        .addStringOption(o => o.setName("faction").setDescription("The faction name").setRequired(true).setAutocomplete(true))
        .addBooleanOption(o => o.setName("all").setDescription("Show all notes instead of just the last 30 days")),
    
    new SlashCommandBuilder()
        .setName("setreminder")
        .setDescription("Set a reminder with a 30m warning and a final ping")
        .addStringOption(o => o.setName("text").setDescription("The reminder message").setRequired(true))
        .addStringOption(o => o.setName("time").setDescription("Time in 24h format (HH:MM)").setRequired(true))
        .addStringOption(o => o.setName("date").setDescription("Date (YYYY-MM-DD)").setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("Channel for the pings").addChannelTypes(0).setRequired(true))
        .addStringOption(o => o.setName("target_type").setDescription("Whether to ping a User or a Role").setRequired(true).addChoices({name:"User", value:"user"},{name:"Role", value:"role"}))
        .addStringOption(o => o.setName("target_value").setDescription("The Username or Role Name").setRequired(true))
        .addStringOption(o => o.setName("recurrence").setDescription("How often to repeat").addChoices({name:"None", value:"none"},{name:"Daily", value:"daily"},{name:"Weekly", value:"weekly"},{name:"Monthly", value:"monthly"}))
        .addStringOption(o => o.setName("timezone").setDescription("Your timezone (e.g., America/New_York). Default is UTC")),
    
    new SlashCommandBuilder()
        .setName("listreminders")
        .setDescription("View all active reminders scheduled in the system"),
    
    new SlashCommandBuilder()
        .setName("adddossier")
        .setDescription("Add intelligence entries to the database")
        .addSubcommand(s => s.setName("person").setDescription("Add a person to the database")
            .addStringOption(o => o.setName("faction").setDescription("Their faction").setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName("character").setDescription("Character name").setRequired(true))
            .addStringOption(o => o.setName("phone").setDescription("Phone number"))
            .addStringOption(o => o.setName("personaladdress").setDescription("Residential address"))
            .addBooleanOption(o => o.setName("leader").setDescription("Are they a leader?")))
        .addSubcommand(s => s.setName("location").setDescription("Add a location to the database")
            .addStringOption(o => o.setName("faction").setDescription("Owning faction").setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName("address").setDescription("Property address").setRequired(true))
            .addBooleanOption(o => o.setName("is_hq").setDescription("Is this an HQ?").setRequired(true))),
    
    new SlashCommandBuilder()
        .setName("addproperty")
        .setDescription("Log a new property reward")
        .addStringOption(o => o.setName("date").setDescription("Date given (YYYY-MM-DD)").setRequired(true))
        .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("address").setDescription("Property address").setRequired(true))
        .addStringOption(o => o.setName("type").setDescription("Type of property").setRequired(true).addChoices({name:"HQ",value:"HQ"},{name:"Warehouse",value:"Warehouse"},{name:"Property",value:"Property"}))
        .addBooleanOption(o => o.setName("confiscated").setDescription("Is it already confiscated?").setRequired(true)),
    
    new SlashCommandBuilder()
        .setName("listproperties")
        .setDescription("View the master list of all recorded properties"),
    
    new SlashCommandBuilder()
        .setName("confiscateproperty")
        .setDescription("Mark an existing property as confiscated")
        .addStringOption(o => o.setName("date").setDescription("Date of confiscation").setRequired(true))
        .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName("address").setDescription("Property address").setRequired(true))
        .addStringOption(o => o.setName("type").setDescription("Property type").setRequired(true))
        .addBooleanOption(o => o.setName("confiscated").setDescription("Set to true").setRequired(true))
];

// ───────────────────────────────────────────────
// NOTIFICATION CACHE
// ───────────────────────────────────────────────
const notified30m = new Set();
const notifiedFinal = new Set();

client.once("ready", async () => {
    try {
        const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log("✅ Commands Registered & Bot Online");
        cron.schedule("* * * * *", () => checkReminders());
    } catch (err) {
        console.error("Critical Start Error:", err);
    }
});

// ───────────────────────────────────────────────
// INTERACTION HANDLER
// ───────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
    if (interaction.isAutocomplete()) {
        // Simple autocomplete stub to prevent errors
        return interaction.respond([]);
    }

    if (!interaction.isChatInputCommand()) return;

    const isFM = interaction.member.roles.cache.has(FACTION_MANAGEMENT_ROLE_ID);
    const isMgt = interaction.member.roles.cache.some(r => r.name === FM_MANAGEMENT_ROLE_NAME);
    const isTL = interaction.member.roles.cache.some(r => r.name === TEAM_LEAD_ROLE_NAME);

    // Permission Gates
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

    // Logic
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

    if (interaction.commandName === "help") {
        const embed = new EmbedBuilder().setColor(0x2b6cb0).setTitle("Meridian Bot Command Directory")
            .addFields(
                { name: "🛡️ Faction Management", value: "`/factioninfo`, `/scenecount`, `/logscene`, `/addnote`, `/getnotes`, `/setreminder`, `/listreminders`" },
                { name: "📁 Team Lead", value: "`/adddossier`" },
                { name: "💼 FM Management", value: "`/addproperty`, `/listproperties`, `/confiscateproperty`" }
            );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Add other command implementations (factioninfo, logscene, etc) as needed based on logic above.
});

// ───────────────────────────────────────────────
// REMINDER ENGINE
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
                    
                    if (r[6] === "none" || r[6] === "None") {
                        await sheets.spreadsheets.batchUpdate({
                            spreadsheetId: GOOGLE_SHEET_ID,
                            requestBody: {
                                requests: [{ deleteDimension: { range: { sheetId: REMINDER_GID, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } } }]
                            }
                        });
                    } else {
                        const next = rDt.plus(r[6].toLowerCase() === "daily" ? { days: 1 } : r[6].toLowerCase() === "weekly" ? { weeks: 1 } : { months: 1 });
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
    } catch (e) { console.error("Cron Error:", e.message); }
}

client.login(DISCORD_TOKEN);
