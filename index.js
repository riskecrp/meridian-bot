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
const REMINDER_GID = 543228518; // Your specific Reminders Tab ID

// ───────────────────────────────────────────────
// GOOGLE AUTH & CLIENT SETUP
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
    } catch (e) { return `@${value}`; }
}

// ───────────────────────────────────────────────
// COMMAND DEFINITIONS
// ───────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder().setName("factioninfo").setDescription("Lookup intelligence data for a faction").addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true)),
    new SlashCommandBuilder().setName("scenecount").setDescription("View scene history (last 90 days)").addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true)),
    new SlashCommandBuilder().setName("logscene").setDescription("Log a scene execution").addStringOption(o => o.setName("scene_name").setDescription("Name of scene").setRequired(true)).addStringOption(o => o.setName("participants").setDescription("Factions involved").setRequired(true)),
    new SlashCommandBuilder().setName("addnote").setDescription("Log a notable interaction").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true)).addStringOption(o => o.setName("note").setDescription("Details").setRequired(true)),
    new SlashCommandBuilder().setName("getnotes").setDescription("Retrieve notes").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true)).addBooleanOption(o => o.setName("all").setDescription("Show all history")),
    new SlashCommandBuilder().setName("help").setDescription("Show command directory"),
    new SlashCommandBuilder().setName("listreminders").setDescription("View scheduled pings"),
    new SlashCommandBuilder().setName("setreminder").setDescription("Set a reminder with auto-pings")
        .addStringOption(o => o.setName("text").setDescription("Content").setRequired(true))
        .addStringOption(o => o.setName("time").setDescription("HH:MM (24h)").setRequired(true))
        .addStringOption(o => o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("Where to ping").addChannelTypes(0).setRequired(true))
        .addStringOption(o => o.setName("target_type").setDescription("User or Role").setRequired(true).addChoices({name:"User", value:"user"},{name:"Role", value:"role"}))
        .addStringOption(o => o.setName("target_value").setDescription("Username or Role Name").setRequired(true))
        .addStringOption(o => o.setName("recurrence").setDescription("Pattern").addChoices({name:"None", value:"none"},{name:"Daily", value:"daily"},{name:"Weekly", value:"weekly"},{name:"Monthly", value:"monthly"}))
        .addStringOption(o => o.setName("timezone").setDescription("Timezone (e.g. UTC)")),
    new SlashCommandBuilder().setName("adddossier").setDescription("Manage intel entries")
        .addSubcommand(s => s.setName("person").setDescription("Add person").addStringOption(o => o.setName("faction").setRequired(true)).addStringOption(o => o.setName("character").setRequired(true)).addStringOption(o => o.setName("phone")).addStringOption(o => o.setName("personaladdress")).addBooleanOption(o => o.setName("leader")))
        .addSubcommand(s => s.setName("location").setDescription("Add location").addStringOption(o => o.setName("faction").setRequired(true)).addStringOption(o => o.setName("address").setRequired(true)).addBooleanOption(o => o.setName("is_hq").setRequired(true))),
    new SlashCommandBuilder().setName("addproperty").setDescription("Log property reward").addStringOption(o => o.setName("date").setRequired(true)).addStringOption(o => o.setName("faction").setRequired(true)).addStringOption(o => o.setName("address").setRequired(true)).addStringOption(o => o.setName("type").setRequired(true).addChoices({name:"HQ",value:"HQ"},{name:"Warehouse",value:"Warehouse"},{name:"Property",value:"Property"})).addBooleanOption(o => o.setName("confiscated").setRequired(true)),
    new SlashCommandBuilder().setName("listproperties").setDescription("List master property log"),
    new SlashCommandBuilder().setName("confiscateproperty").setDescription("Mark property as confiscated").addStringOption(o => o.setName("date").setRequired(true)).addStringOption(o => o.setName("faction").setRequired(true)).addStringOption(o => o.setName("address").setRequired(true)).addStringOption(o => o.setName("type").setRequired(true)).addBooleanOption(o => o.setName("confiscated").setRequired(true))
];

// ───────────────────────────────────────────────
// STARTUP
// ───────────────────────────────────────────────
client.once("ready", async () => {
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`[SYSTEM] Bot Online. Monitoring sheet every 60s.`);
    
    cron.schedule("* * * * *", async () => {
        console.log(`[PULSE] Heartbeat at ${DateTime.now().setZone("UTC").toFormat("HH:mm:ss")}`);
        await checkReminders();
    });
});

// ───────────────────────────────────────────────
// INTERACTION HANDLER
// ───────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const isFM = interaction.member.roles.cache.has(FACTION_MANAGEMENT_ROLE_ID);
    const isMgt = interaction.member.roles.cache.some(r => r.name === FM_MANAGEMENT_ROLE_NAME);
    const isTL = interaction.member.roles.cache.some(r => r.name === TEAM_LEAD_ROLE_NAME);

    // Permission Logic
    const fmRequired = ["factioninfo", "scenecount", "help", "logscene", "addnote", "getnotes", "setreminder", "listreminders"];
    if (fmRequired.includes(interaction.commandName) && !isFM) return interaction.reply({ content: "Unauthorized: FM Role Required.", ephemeral: true });
    if (interaction.commandName === "adddossier" && !isTL) return interaction.reply({ content: "Unauthorized: Team Lead Required.", ephemeral: true });
    if (["addproperty", "listproperties", "confiscateproperty"].includes(interaction.commandName) && !isMgt) return interaction.reply({ content: "Unauthorized: FM Management Required.", ephemeral: true });

    if (interaction.commandName === "setreminder") {
        await interaction.deferReply({ ephemeral: true });
        const [text, time, date, chan, tType, tVal, rec] = [
            interaction.options.getString("text"), interaction.options.getString("time"),
            interaction.options.getString("date"), interaction.options.getChannel("channel"),
            interaction.options.getString("target_type"), interaction.options.getString("target_value"),
            interaction.options.getString("recurrence") || "none"
        ];

        try {
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A:A" });
            const row = (res.data.values || []).length + 1;
            // Status (Col M) = "active"
            const values = [text, time, date, "UTC", time, date, rec, interaction.user.username, "FM", "public", tType, tVal, "active", chan.id, chan.name];
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!A${row}:O${row}`,
                valueInputOption: "USER_ENTERED", requestBody: { values: [values] }
            });
            return interaction.editReply(`✅ Reminder logged for **${tVal}**.`);
        } catch (e) { return interaction.editReply("❌ Sheet Error."); }
    }

    if (interaction.commandName === "help") {
        const embed = new EmbedBuilder().setColor(0x2b6cb0).setTitle("Command Directory")
            .addFields(
                { name: "🛡️ Faction Management", value: "`/factioninfo`, `/scenecount`, `/logscene`, `/addnote`, `/getnotes`, `/setreminder`, `/listreminders`" },
                { name: "📁 Team Lead", value: "`/adddossier`" },
                { name: "💼 FM Management", value: "`/addproperty`, `/listproperties`, `/confiscateproperty`" }
            );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// ───────────────────────────────────────────────
// REMINDER ENGINE
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
                let status = r[12]?.trim().toLowerCase();
                if (!r || status === "completed") continue;

                const rDt = DateTime.fromISO(`${r[5]}T${r[4]}`, { zone: "UTC" });
                if (!rDt.isValid) continue;

                const diff = rDt.diff(now, 'minutes').minutes;
                const chan = await guild.channels.fetch(r[13]);
                if (!chan) continue;

                // 1. 30-MINUTE WARNING
                if (status === "active" && diff <= 30 && diff > 0) {
                    const ping = await resolvePing(guild, r[10], r[11]);
                    await chan.send({ 
                        content: `${ping} **30-MINUTE WARNING**`, 
                        embeds: [new EmbedBuilder().setColor(0xffa500).setTitle("Upcoming Event").setDescription(r[0])]
                    });
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                        valueInputOption: "USER_ENTERED", requestBody: { values: [["warned"]] }
                    });
                    console.log(`[SENT] 30m warning for row ${i+2}`);
                }

                // 2. FINAL ALERT
                if (diff <= 0 && diff > -5) {
                    const ping = await resolvePing(guild, r[10], r[11]);
                    await chan.send({ 
                        content: `${ping} **REMINDER NOW**`, 
                        embeds: [new EmbedBuilder().setColor(0xff0000).setTitle("Event Starting").setDescription(r[0])]
                    });

                    if (r[6]?.toLowerCase() === "none") {
                        // DELETE One-time
                        await sheets.spreadsheets.batchUpdate({
                            spreadsheetId: GOOGLE_SHEET_ID,
                            requestBody: {
                                requests: [{ deleteDimension: { range: { sheetId: REMINDER_GID, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } } }]
                            }
                        });
                        console.log(`[CLEANUP] Deleted row ${i+2}`);
                    } else {
                        // UPDATE Recurring
                        const rec = r[6].toLowerCase();
                        const next = rDt.plus(rec === "daily" ? { days: 1 } : rec === "weekly" ? { weeks: 1 } : { months: 1 });
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!E${i + 2}:F${i + 2}`,
                            valueInputOption: "USER_ENTERED", requestBody: { values: [[next.toFormat("HH:mm"), next.toFormat("yyyy-MM-dd")]] }
                        });
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                            valueInputOption: "USER_ENTERED", requestBody: { values: [["active"]] }
                        });
                        console.log(`[RECUR] Updated row ${i+2} to ${next.toISODate()}`);
                    }
                }
            } catch (err) { console.error(`[ERROR] Row ${i+2}: ${err.message}`); }
        }
    } catch (e) { console.error(`[CRITICAL] Engine Failure: ${e.message}`); }
}

client.login(DISCORD_TOKEN);
