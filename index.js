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
// Handle Railway's newline formatting in private keys
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Role IDs & Constants
const FACTION_MANAGEMENT_ROLE_ID = "1457229857749729363";
const FM_MANAGEMENT_ROLE_NAME = "[ECRP] FM Management";
const TEAM_LEAD_ROLE_NAME = "Team Lead";

const REMINDER_HEADERS = [
    "Reminder Text", "Input Time", "Input Date", "Input Timezone", 
    "UTC Time", "UTC Date", "Recurrence", "Creator", "Creator Role", 
    "Visibility", "Target Type", "Target Value", "Status", "Channel ID", "Channel Name"
];

// ───────────────────────────────────────────────
// 2. GOOGLE SHEETS AUTH
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
        GatewayIntentBits.GuildMembers, // REQUIRED for pings to work
        GatewayIntentBits.GuildMessages
    ]
});

// ───────────────────────────────────────────────
// 4. UTILITIES
// ───────────────────────────────────────────────

/**
 * Resolves a target (User or Role) into a mentionable string.
 * FIX: Checks if input already starts with '@' to prevent double symbols.
 */
async function resolvePing(guild, type, value) {
    if (!value) return "@Unknown";
    
    // 1. Clean the input for searching (remove @ temporarily)
    const cleanValue = value.replace(/^@/, '').trim().toLowerCase();
    
    try {
        if (type === "role") {
            const roles = await guild.roles.fetch();
            const role = roles.find(r => r.name.toLowerCase() === cleanValue);
            if (role) return `<@&${role.id}>`;
        } else {
            const members = await guild.members.fetch();
            const member = members.find(m => m.user.username.toLowerCase() === cleanValue);
            if (member) return `<@${member.id}>`;
        }
    } catch (e) { 
        console.error("Ping Resolution Error:", e.message);
    }

    // 2. Fallback: If not found, use user input. 
    // If user typed "@aleks", return "@aleks". If "aleks", return "@aleks".
    return value.startsWith('@') ? value : `@${value}`;
}

/**
 * Parses user input into a standardized ISO-like format for storage.
 * FIX: Adds padding to time inputs (3:30 -> 03:30)
 */
function convertToUTC(date, time, timezone) {
    // Pad time just in case user inputs "3:30" instead of "03:30"
    const paddedTime = time.includes(":") && time.length < 5 ? time.padStart(5, "0") : time;
    
    // Attempt strict parsing first
    const dt = DateTime.fromFormat(`${date} ${paddedTime}`, "yyyy-MM-dd HH:mm", { zone: timezone });
    if (!dt.isValid) return null;
    
    const utcDt = dt.toUTC();
    return {
        utcDate: utcDt.toFormat("yyyy-MM-dd"),
        utcTime: utcDt.toFormat("HH:mm")
    };
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
    } catch (e) { console.error(`Sheet Tab Error (${tabName}):`, e.message); }
}

// ───────────────────────────────────────────────
// 5. SLASH COMMAND DEFINITIONS
// ───────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder().setName("factioninfo").setDescription("Lookup intelligence data for a faction").addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("scenecount").setDescription("View scene history (last 90 days)").addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("logscene").setDescription("Log a scene execution").addStringOption(o => o.setName("scene_name").setDescription("Name of scene").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("participants").setDescription("Factions involved").setRequired(true)),
    new SlashCommandBuilder().setName("addnote").setDescription("Log a notable interaction").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("note").setDescription("Details").setRequired(true)),
    new SlashCommandBuilder().setName("getnotes").setDescription("Retrieve notes").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addBooleanOption(o => o.setName("all").setDescription("Show all history")),
    new SlashCommandBuilder().setName("help").setDescription("Show command directory"),
    new SlashCommandBuilder().setName("listreminders").setDescription("View scheduled pings"),
    
    new SlashCommandBuilder().setName("adddossier").setDescription("Manage intel entries")
        .addSubcommand(s => s.setName("person").setDescription("Add person").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("character").setDescription("Name").setRequired(true)).addStringOption(o => o.setName("phone").setDescription("Phone")).addStringOption(o => o.setName("personaladdress").setDescription("Address")).addBooleanOption(o => o.setName("leader").setDescription("Is Leader")))
        .addSubcommand(s => s.setName("location").setDescription("Add location").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setDescription("Address").setRequired(true)).addBooleanOption(o => o.setName("is_hq").setDescription("Is HQ").setRequired(true))),
    
    new SlashCommandBuilder().setName("addproperty").setDescription("Log property reward").addStringOption(o => o.setName("date").setDescription("Date").setRequired(true)).addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setDescription("Address").setRequired(true)).addStringOption(o => o.setName("type").setDescription("Type").setRequired(true).addChoices({name:"HQ",value:"HQ"},{name:"Warehouse",value:"Warehouse"},{name:"Property",value:"Property"})).addBooleanOption(o => o.setName("confiscated").setDescription("Confiscated").setRequired(true)),
    new SlashCommandBuilder().setName("listproperties").setDescription("List master property log"),
    new SlashCommandBuilder().setName("confiscateproperty").setDescription("Mark property as confiscated").addStringOption(o => o.setName("date").setDescription("Date").setRequired(true)).addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setDescription("Address").setRequired(true)).addStringOption(o => o.setName("type").setDescription("Type").setRequired(true)).addBooleanOption(o => o.setName("confiscated").setDescription("Confirm").setRequired(true)),

    new SlashCommandBuilder().setName("setreminder").setDescription("Set a timezone-aware reminder")
        .addStringOption(o => o.setName("text").setDescription("Content").setRequired(true))
        .addStringOption(o => o.setName("time").setDescription("HH:MM (24h)").setRequired(true))
        .addStringOption(o => o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("Where to ping").addChannelTypes(0).setRequired(true))
        .addStringOption(o => o.setName("target_type").setDescription("User or Role").setRequired(true).addChoices({name:"User", value:"user"},{name:"Role", value:"role"}))
        .addStringOption(o => o.setName("target_value").setDescription("Username or Role Name").setRequired(true))
        .addStringOption(o => o.setName("recurrence").setDescription("Pattern").addChoices({name:"None", value:"none"},{name:"Daily", value:"daily"},{name:"Weekly", value:"weekly"},{name:"Monthly", value:"monthly"}))
        .addStringOption(o => o.setName("timezone").setDescription("Your Timezone (e.g. America/New_York) - Default: UTC"))
];

// ───────────────────────────────────────────────
// 6. INITIALIZATION & CRON
// ───────────────────────────────────────────────
client.once("ready", async () => {
    try {
        const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log(`[SYSTEM] Meridian Bot Online (${client.user.tag})`);
        
        // Start Cron Job
        cron.schedule("* * * * *", () => {
            console.log(`[CRON] Tick.`);
            checkReminders();
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

    // Permissions
    const fmCmds = ["factioninfo", "scenecount", "help", "logscene", "addnote", "getnotes", "setreminder", "listreminders"];
    if (fmCmds.includes(interaction.commandName) && !isFM) return interaction.reply({ content: "❌ Unauthorized: FM Role Required.", ephemeral: true });
    if (interaction.commandName === "adddossier" && !isTL) return interaction.reply({ content: "❌ Unauthorized: Team Lead Role Required.", ephemeral: true });
    if (["addproperty", "listproperties", "confiscateproperty"].includes(interaction.commandName) && !isMgt) return interaction.reply({ content: "❌ Unauthorized: FM Management Role Required.", ephemeral: true });

    // SET REMINDER
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
        } catch (e) {
            console.error(e);
            return interaction.editReply("❌ Database Error."); 
        }
    }

    if (interaction.commandName === "help") return interaction.reply({ content: "Bot Online.", ephemeral: true });
});

// ───────────────────────────────────────────────
// 8. REMINDER ENGINE (SPAM FIXED)
// ───────────────────────────────────────────────
async function checkReminders() {
    try {
        const res = await sheets.spreadsheets.values.get({ 
            spreadsheetId: GOOGLE_SHEET_ID, 
            range: "Reminders!A2:O100" 
        });
        
        const rows = res.data.values || [];
        if (rows.length === 0) return;

        const now = DateTime.now().setZone("UTC");
        const guild = await client.guilds.fetch(GUILD_ID);

        for (let i = 0; i < rows.length; i++) {
            try {
                const r = rows[i];
                let status = r[12]?.trim().toLowerCase();
                
                // SKIPS COMPLETED ROWS INSTANTLY
                if (!r || !status || status === "completed") continue;

                // --- Auto-Fix Time Formatting ---
                let dateStr = r[5]?.trim();
                let timeStr = r[4]?.trim();
                if (timeStr && timeStr.indexOf(":") > -1 && timeStr.length < 5) timeStr = timeStr.padStart(5, "0");

                const rDt = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: "UTC" });
                if (!rDt.isValid) continue;

                const diffMinutes = rDt.diff(now, 'minutes').minutes;
                const chanId = r[13];
                const channel = await guild.channels.fetch(chanId).catch(() => null);
                if (!channel) continue;

                // ─── 1. 30-MINUTE WARNING ───
                if (status === "active" && diffMinutes <= 30 && diffMinutes > 20) {
                    const mention = await resolvePing(guild, r[10], r[11]);
                    
                    const embed = new EmbedBuilder()
                        .setColor(0xffa500)
                        .setTitle("⏰ 30-MINUTE WARNING")
                        .setDescription(`**Event:** ${r[0]}\n**Time:** <t:${Math.floor(rDt.toSeconds())}:R>`);

                    await channel.send({ 
                        content: `${mention}`, 
                        embeds: [embed],
                        allowedMentions: { parse: ['users', 'roles'] }
                    });

                    // Update Status to 'warned'
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                        valueInputOption: "USER_ENTERED", requestBody: { values: [["warned"]] }
                    });
                }

                // ─── 2. FINAL ALERT ───
                if (diffMinutes <= 0 && diffMinutes > -10) {
                    const mention = await resolvePing(guild, r[10], r[11]);

                    const embed = new EmbedBuilder()
                        .setColor(0xff0000)
                        .setTitle("🔔 EVENT REMINDER")
                        .setDescription(`**Happening Now:** ${r[0]}`);

                    await channel.send({ 
                        content: `${mention}`, 
                        embeds: [embed],
                        allowedMentions: { parse: ['users', 'roles'] }
                    });

                    // ─── FIX: MARK COMPLETED (Instead of deleting) ───
                    const recurrence = r[6]?.toLowerCase();
                    
                    if (recurrence === "none" || !recurrence) {
                        console.log(`[COMPLETED] Row ${i+2}`);
                        // Update Column M to "completed" -> Stops the loop from picking it up again
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                            valueInputOption: "USER_ENTERED", 
                            requestBody: { values: [["completed"]] }
                        });
                    } else {
                        // UPDATE RECURRENCE
                        let nextDt = rDt;
                        if (recurrence === "daily") nextDt = rDt.plus({ days: 1 });
                        if (recurrence === "weekly") nextDt = rDt.plus({ weeks: 1 });
                        if (recurrence === "monthly") nextDt = rDt.plus({ months: 1 });

                        await sheets.spreadsheets.values.update({
                            spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!E${i + 2}:F${i + 2}`,
                            valueInputOption: "USER_ENTERED", 
                            requestBody: { values: [[nextDt.toFormat("HH:mm"), nextDt.toFormat("yyyy-MM-dd")]] }
                        });
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                            valueInputOption: "USER_ENTERED", 
                            requestBody: { values: [["active"]] }
                        });
                    }
                }

            } catch (err) {
                console.error(`[ROW ERROR] Index ${i}:`, err.message);
            }
        }
    } catch (e) { console.error("[CRON FATAL]", e.message); }
}

client.login(DISCORD_TOKEN);
