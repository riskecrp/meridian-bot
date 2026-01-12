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
// 1. CONFIGURATION & ENV
// ───────────────────────────────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

const FACTION_MANAGEMENT_ROLE_ID = "1457229857749729363";
const FM_MANAGEMENT_ROLE_NAME = "[ECRP] FM Management";
const TEAM_LEAD_ROLE_NAME = "Team Lead";
const REMINDER_TAB_GID = 543228518;

const REMINDER_HEADERS = [
    "Reminder Text", "Input Time", "Input Date", "Input Timezone", 
    "UTC Time", "UTC Date", "Recurrence", "Creator", "Creator Role", 
    "Visibility", "Target Type", "Target Value", "Status", "Channel ID", "Channel Name"
];

// ───────────────────────────────────────────────
// 2. GOOGLE AUTH
// ───────────────────────────────────────────────
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL, null, GOOGLE_PRIVATE_KEY, 
    ["https://www.googleapis.com/auth/spreadsheets"]
);
const sheets = google.sheets({ version: "v4", auth });

// ───────────────────────────────────────────────
// 3. DISCORD CLIENT
// ───────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages
    ]
});

// ───────────────────────────────────────────────
// 4. UTILITIES
// ───────────────────────────────────────────────
async function resolvePing(guild, type, value) {
    if (!value) return "@Unknown";
    try {
        const cleanValue = value.trim().toLowerCase();
        if (type === "role") {
            const roles = await guild.roles.fetch();
            const role = roles.find(r => r.name.toLowerCase() === cleanValue);
            return role ? `<@&${role.id}>` : `@${value}`;
        } else {
            const members = await guild.members.fetch();
            const member = members.find(m => m.user.username.toLowerCase() === cleanValue);
            return member ? `<@${member.id}>` : `@${value}`;
        }
    } catch (e) { return `@${value}`; }
}

function convertToUTC(date, time, timezone) {
    const dt = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", { zone: timezone });
    if (!dt.isValid) return null;
    const utcDt = dt.toUTC();
    return { utcDate: utcDt.toFormat("yyyy-MM-dd"), utcTime: utcDt.toFormat("HH:mm") };
}

async function ensureSheetTab(tabName, headers = []) {
    try {
        const info = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
        if (!info.data.sheets.some(s => s.properties.title === tabName)) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: GOOGLE_SHEET_ID,
                requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
            });
            if (headers.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID, range: `${tabName}!A1`,
                    valueInputOption: "USER_ENTERED", requestBody: { values: [headers] }
                });
            }
        }
    } catch (e) { console.error(`Sheet Tab Error:`, e.message); }
}

// ───────────────────────────────────────────────
// 5. COMMAND DEFINITIONS
// ───────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder().setName("factioninfo").setDescription("Lookup intelligence data").addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("scenecount").setDescription("View scene history").addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("logscene").setDescription("Log a scene").addStringOption(o => o.setName("scene_name").setDescription("Scene Name").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("participants").setDescription("Participants").setRequired(true)),
    new SlashCommandBuilder().setName("addnote").setDescription("Log interaction").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("note").setDescription("Details").setRequired(true)),
    new SlashCommandBuilder().setName("getnotes").setDescription("Retrieve notes").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addBooleanOption(o => o.setName("all").setDescription("Show all")),
    new SlashCommandBuilder().setName("help").setDescription("Show commands"),
    new SlashCommandBuilder().setName("listreminders").setDescription("View pings"),
    
    new SlashCommandBuilder().setName("adddossier").setDescription("Manage intel")
        .addSubcommand(s => s.setName("person").setDescription("Add person").addStringOption(o => o.setName("faction").setDescription("F").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("character").setDescription("C").setRequired(true)).addStringOption(o => o.setName("phone").setDescription("P")).addStringOption(o => o.setName("personaladdress").setDescription("A")).addBooleanOption(o => o.setName("leader").setDescription("L")))
        .addSubcommand(s => s.setName("location").setDescription("Add location").addStringOption(o => o.setName("faction").setDescription("F").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setDescription("A").setRequired(true)).addBooleanOption(o => o.setName("is_hq").setDescription("H").setRequired(true))),
    
    new SlashCommandBuilder().setName("addproperty").setDescription("Log property").addStringOption(o => o.setName("date").setDescription("D").setRequired(true)).addStringOption(o => o.setName("faction").setDescription("F").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setDescription("A").setRequired(true)).addStringOption(o => o.setName("type").setDescription("T").setRequired(true).addChoices({name:"HQ",value:"HQ"},{name:"Warehouse",value:"Warehouse"},{name:"Property",value:"Property"})).addBooleanOption(o => o.setName("confiscated").setDescription("C").setRequired(true)),
    new SlashCommandBuilder().setName("listproperties").setDescription("List properties"),
    new SlashCommandBuilder().setName("confiscateproperty").setDescription("Mark confiscated").addStringOption(o => o.setName("date").setDescription("D").setRequired(true)).addStringOption(o => o.setName("faction").setDescription("F").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setDescription("A").setRequired(true)).addStringOption(o => o.setName("type").setDescription("T").setRequired(true)).addBooleanOption(o => o.setName("confiscated").setDescription("C").setRequired(true)),

    new SlashCommandBuilder().setName("setreminder").setDescription("Set a reminder")
        .addStringOption(o => o.setName("text").setDescription("Content").setRequired(true))
        .addStringOption(o => o.setName("time").setDescription("HH:MM (24h)").setRequired(true))
        .addStringOption(o => o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("Where to ping").addChannelTypes(0).setRequired(true))
        .addStringOption(o => o.setName("target_type").setDescription("User or Role").setRequired(true).addChoices({name:"User", value:"user"},{name:"Role", value:"role"}))
        .addStringOption(o => o.setName("target_value").setDescription("Username or Role Name").setRequired(true))
        .addStringOption(o => o.setName("recurrence").setDescription("Pattern").addChoices({name:"None", value:"none"},{name:"Daily", value:"daily"},{name:"Weekly", value:"weekly"},{name:"Monthly", value:"monthly"}))
        .addStringOption(o => o.setName("timezone").setDescription("Timezone (Default: UTC)"))
];

// ───────────────────────────────────────────────
// 6. INITIALIZATION
// ───────────────────────────────────────────────
client.once("ready", async () => {
    try {
        const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log(`[SYSTEM] Meridian Bot Online (${client.user.tag})`);
        
        cron.schedule("* * * * *", () => {
            checkRemindersDiagnostic();
        });
    } catch (e) { console.error("Startup Error:", e); }
});

// ───────────────────────────────────────────────
// 7. INTERACTION HANDLER
// ───────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
    if (interaction.isAutocomplete()) return interaction.respond([]);
    if (!interaction.isChatInputCommand()) return;

    const isFM = interaction.member.roles.cache.has(FACTION_MANAGEMENT_ROLE_ID);
    const isMgt = interaction.member.roles.cache.some(r => r.name === FM_MANAGEMENT_ROLE_NAME);
    const isTL = interaction.member.roles.cache.some(r => r.name === TEAM_LEAD_ROLE_NAME);

    const fmCmds = ["factioninfo", "scenecount", "help", "logscene", "addnote", "getnotes", "setreminder", "listreminders"];
    if (fmCmds.includes(interaction.commandName) && !isFM) return interaction.reply({ content: "❌ Unauthorized: FM Role Required.", ephemeral: true });
    if (interaction.commandName === "adddossier" && !isTL) return interaction.reply({ content: "❌ Unauthorized: Team Lead Role Required.", ephemeral: true });
    if (["addproperty", "listproperties", "confiscateproperty"].includes(interaction.commandName) && !isMgt) return interaction.reply({ content: "❌ Unauthorized: FM Management Role Required.", ephemeral: true });

    if (interaction.commandName === "setreminder") {
        await interaction.deferReply({ ephemeral: true });
        const [text, time, date, channel, targetType, targetValue, recurrence, timezone] = [
            interaction.options.getString("text"),
            interaction.options.getString("time"),
            interaction.options.getString("date"),
            interaction.options.getChannel("channel"),
            interaction.options.getString("target_type"),
            interaction.options.getString("target_value"),
            interaction.options.getString("recurrence") || "none",
            interaction.options.getString("timezone") || "UTC"
        ];

        const utcData = convertToUTC(date, time, timezone);
        if (!utcData) return interaction.editReply(`❌ **Invalid Time/Date/Timezone.**`);

        try {
            await ensureSheetTab("Reminders", REMINDER_HEADERS);
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A:A" });
            const nextRow = (res.data.values || []).length + 1;
            const values = [
                text, time, date, timezone,                 
                utcData.utcTime, utcData.utcDate,           
                recurrence, interaction.user.username, "FM",
                "public", targetType, targetValue,          
                "active", channel.id, channel.name          
            ];
            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!A${nextRow}:O${nextRow}`,
                valueInputOption: "USER_ENTERED", requestBody: { values: [values] }
            });
            return interaction.editReply(`✅ **Reminder Set!**\nTarget: ${targetValue}\nTime: ${date} ${time} (${timezone})\n(Stored as UTC: ${utcData.utcDate} ${utcData.utcTime})`);
        } catch (e) { return interaction.editReply("❌ Database Error."); }
    }

    if (interaction.commandName === "help") return interaction.reply({ content: "Bot Online.", ephemeral: true });
});

// ───────────────────────────────────────────────
// 8. DIAGNOSTIC REMINDER ENGINE (VERBOSE)
// ───────────────────────────────────────────────
async function checkRemindersDiagnostic() {
    try {
        console.log("--- [DIAGNOSTIC START] ---");
        const res = await sheets.spreadsheets.values.get({ 
            spreadsheetId: GOOGLE_SHEET_ID, 
            range: "Reminders!A1:O100" 
        });
        
        const rows = res.data.values || [];
        const now = DateTime.now().setZone("UTC");
        console.log(`[SYSTEM TIME UTC] ${now.toFormat("yyyy-MM-dd HH:mm:ss")}`);
        console.log(`[SHEET] Found ${rows.length} rows.`);

        if (rows.length === 0) return;

        const guild = await client.guilds.fetch(GUILD_ID);

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const rowNum = i + 2;
            
            // 1. Log Raw Data
            let rawStatus = r[12]?.trim().toLowerCase();
            let rawDate = r[5]?.trim();
            let rawTime = r[4]?.trim();
            
            console.log(`[ROW ${rowNum}] RawStatus: '${rawStatus}' | RawDate: '${rawDate}' | RawTime: '${rawTime}'`);

            if (!r || !rawStatus || rawStatus === "completed") {
                console.log(`[ROW ${rowNum}] >> SKIPPING (Not active)`);
                continue;
            }

            // 2. Fix Time Padding & Parse
            if (rawTime && rawTime.indexOf(":") > -1 && rawTime.length < 5) {
                rawTime = rawTime.padStart(5, "0"); // Fix "3:30" -> "03:30"
            }

            const rDt = DateTime.fromISO(`${rawDate}T${rawTime}`, { zone: "UTC" });
            
            if (!rDt.isValid) {
                console.log(`[ROW ${rowNum}] >> SKIPPING (Invalid Date Parse)`);
                continue;
            }

            // 3. Diff Calc
            const diffMinutes = rDt.diff(now, 'minutes').minutes;
            console.log(`[ROW ${rowNum}] >> Event Time: ${rDt.toFormat("HH:mm")} | Diff: ${diffMinutes.toFixed(2)} mins`);

            const chanId = r[13];
            const channel = await guild.channels.fetch(chanId).catch(() => null);
            if (!channel) {
                console.log(`[ROW ${rowNum}] >> SKIPPING (Invalid Channel ID: ${chanId})`);
                continue;
            }

            // 4. Logic Checks
            
            // 30M Warning Logic
            if (rawStatus === "active" && diffMinutes <= 30 && diffMinutes > 20) {
                console.log(`[ROW ${rowNum}] >> MATCH! Sending 30m Warning.`);
                const mention = await resolvePing(guild, r[10], r[11]);
                const embed = new EmbedBuilder().setColor(0xffa500).setTitle("⏰ 30-MINUTE WARNING").setDescription(`**Event:** ${r[0]}`);
                await channel.send({ content: `${mention}`, embeds: [embed], allowedMentions: { parse: ['users', 'roles'] } });
                
                await sheets.spreadsheets.values.update({
                    spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${rowNum}`,
                    valueInputOption: "USER_ENTERED", requestBody: { values: [["warned"]] }
                });
            }

            // Final Alert Logic
            else if (diffMinutes <= 0 && diffMinutes > -10) {
                console.log(`[ROW ${rowNum}] >> MATCH! Sending Final Alert.`);
                const mention = await resolvePing(guild, r[10], r[11]);
                const embed = new EmbedBuilder().setColor(0xff0000).setTitle("🔔 EVENT REMINDER").setDescription(`**Happening Now:** ${r[0]}`);
                await channel.send({ content: `${mention}`, embeds: [embed], allowedMentions: { parse: ['users', 'roles'] } });

                // Cleanup
                const recurrence = r[6]?.toLowerCase();
                if (recurrence === "none" || !recurrence) {
                    console.log(`[ROW ${rowNum}] >> Deleting Row (One-time event)`);
                    await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        requestBody: { requests: [{ deleteDimension: { range: { sheetId: REMINDER_TAB_GID, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } } }] }
                    });
                } else {
                    console.log(`[ROW ${rowNum}] >> Updating Recurrence (${recurrence})`);
                    let nextDt = rDt;
                    if (recurrence === "daily") nextDt = rDt.plus({ days: 1 });
                    if (recurrence === "weekly") nextDt = rDt.plus({ weeks: 1 });
                    if (recurrence === "monthly") nextDt = rDt.plus({ months: 1 });

                    await sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!E${rowNum}:F${rowNum}`,
                        valueInputOption: "USER_ENTERED", requestBody: { values: [[nextDt.toFormat("HH:mm"), nextDt.toFormat("yyyy-MM-dd")]] }
                    });
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${rowNum}`,
                        valueInputOption: "USER_ENTERED", requestBody: { values: [["active"]] }
                    });
                }
            } else {
                console.log(`[ROW ${rowNum}] >> No Action Required (Not in window)`);
            }
        }
        console.log("--- [DIAGNOSTIC END] ---");
    } catch (e) { console.error("[CRON FATAL]", e); }
}

client.login(DISCORD_TOKEN);
