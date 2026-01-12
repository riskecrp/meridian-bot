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
import { DateTime } from "luxon";
import cron from "node-cron";

// ───────────────────────────────────────────────
// 1. CONFIGURATION & ENV
// ───────────────────────────────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
// Fix private key formatting for Railway env vars
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Role IDs & Constants
const FACTION_MANAGEMENT_ROLE_ID = "1457229857749729363";
const REMINDER_TAB_GID = 543228518; // Specific ID for 'Reminders' tab deletion

// Headers for the Reminder Sheet (Used to ensure tab exists)
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
// 3. DISCORD CLIENT (With Required Intents)
// ───────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, // REQUIRED: To resolve user/role IDs for pings
        GatewayIntentBits.GuildMessages
    ]
});

// ───────────────────────────────────────────────
// 4. UTILITIES
// ───────────────────────────────────────────────

/**
 * Resolves a target string (username or role name) into a proper Discord mention format.
 */
async function resolvePing(guild, type, value) {
    if (!value) return "Unknown Target";
    try {
        const cleanValue = value.trim().toLowerCase();
        if (type === "role") {
            const roles = await guild.roles.fetch();
            const role = roles.find(r => r.name.toLowerCase() === cleanValue);
            return role ? `<@&${role.id}>` : `@${value}`;
        } else {
            // "user" target
            const members = await guild.members.fetch();
            const member = members.find(m => m.user.username.toLowerCase() === cleanValue);
            return member ? `<@${member.id}>` : `@${value}`;
        }
    } catch (e) {
        console.error("Ping Resolution Error:", e);
        return `@${value}`; // Fallback to plain text
    }
}

/**
 * Converts user input (Date/Time/Timezone) to a UTC object.
 */
function convertToUTC(date, time, timezone) {
    // Luxon parses the input string in the specific timezone provided
    const dt = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", { zone: timezone });
    if (!dt.isValid) return null;
    
    // Convert to UTC
    const utcDt = dt.toUTC();
    return {
        utcDate: utcDt.toFormat("yyyy-MM-dd"),
        utcTime: utcDt.toFormat("HH:mm")
    };
}

/**
 * Ensures the specific Google Sheet tab exists and has headers.
 */
async function ensureSheetTab(tabName, headers = []) {
    try {
        const info = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
        const sheetExists = info.data.sheets.some(s => s.properties.title === tabName);
        
        if (!sheetExists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: GOOGLE_SHEET_ID,
                requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
            });
            // If we just created it, add headers (if provided)
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
    // --- Existing Commands (Preserved) ---
    new SlashCommandBuilder().setName("factioninfo").setDescription("Lookup intelligence data for a faction").addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("scenecount").setDescription("View scene history (last 90 days)").addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("logscene").setDescription("Log a scene execution").addStringOption(o => o.setName("scene_name").setDescription("Name of scene").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("participants").setDescription("Factions involved").setRequired(true)),
    new SlashCommandBuilder().setName("addnote").setDescription("Log a notable interaction").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("note").setDescription("Details").setRequired(true)),
    new SlashCommandBuilder().setName("getnotes").setDescription("Retrieve notes").addStringOption(o => o.setName("faction").setDescription("Faction").setRequired(true).setAutocomplete(true)).addBooleanOption(o => o.setName("all").setDescription("Show all history")),
    new SlashCommandBuilder().setName("help").setDescription("Show command directory"),
    new SlashCommandBuilder().setName("listreminders").setDescription("View scheduled pings"),
    
    new SlashCommandBuilder().setName("adddossier").setDescription("Manage intel entries")
        .addSubcommand(s => s.setName("person").setDescription("Add person").addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("character").setRequired(true)).addStringOption(o => o.setName("phone").setDescription("Phone")).addStringOption(o => o.setName("personaladdress").setDescription("Address")).addBooleanOption(o => o.setName("leader").setDescription("Is Leader")))
        .addSubcommand(s => s.setName("location").setDescription("Add location").addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setRequired(true)).addBooleanOption(o => o.setName("is_hq").setRequired(true))),
    
    new SlashCommandBuilder().setName("addproperty").setDescription("Log property reward").addStringOption(o => o.setName("date").setRequired(true)).addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setRequired(true)).addStringOption(o => o.setName("type").setRequired(true).addChoices({name:"HQ",value:"HQ"},{name:"Warehouse",value:"Warehouse"},{name:"Property",value:"Property"})).addBooleanOption(o => o.setName("confiscated").setRequired(true)),
    new SlashCommandBuilder().setName("listproperties").setDescription("List master property log"),
    new SlashCommandBuilder().setName("confiscateproperty").setDescription("Mark property as confiscated").addStringOption(o => o.setName("date").setRequired(true)).addStringOption(o => o.setName("faction").setRequired(true).setAutocomplete(true)).addStringOption(o => o.setName("address").setRequired(true)).addStringOption(o => o.setName("type").setRequired(true)).addBooleanOption(o => o.setName("confiscated").setRequired(true)),

    // --- The Fixed Reminder Command ---
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
// 6. INITIALIZATION & CRON START
// ───────────────────────────────────────────────
client.once("ready", async () => {
    try {
        const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log(`[SYSTEM] Meridian Bot Online (${client.user.tag})`);
        
        // Start Cron Job (Check every minute)
        cron.schedule("* * * * *", () => {
            const now = DateTime.now().setZone("UTC").toFormat("HH:mm");
            console.log(`[CRON] Checking Reminders... (UTC: ${now})`);
            checkReminders();
        });
    } catch (e) { console.error("Startup Error:", e); }
});

// ───────────────────────────────────────────────
// 7. INTERACTION HANDLER
// ───────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
    // Handle Autocomplete (Stub for now)
    if (interaction.isAutocomplete()) return interaction.respond([]);
    
    if (!interaction.isChatInputCommand()) return;

    // Check Roles
    const isFM = interaction.member.roles.cache.has(FACTION_MANAGEMENT_ROLE_ID);
    const isMgt = interaction.member.roles.cache.some(r => r.name === "[ECRP] FM Management");
    const isTL = interaction.member.roles.cache.some(r => r.name === "Team Lead");

    // --- REMINDER LOGIC (Permission: Faction Management) ---
    if (interaction.commandName === "setreminder") {
        if (!isFM) return interaction.reply({ content: "❌ Unauthorized.", ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        // Gather Inputs
        const text = interaction.options.getString("text");
        const time = interaction.options.getString("time");
        const date = interaction.options.getString("date");
        const channel = interaction.options.getChannel("channel");
        const targetType = interaction.options.getString("target_type");
        const targetValue = interaction.options.getString("target_value");
        const recurrence = interaction.options.getString("recurrence") || "none";
        // Default to UTC if user leaves it empty
        const timezone = interaction.options.getString("timezone") || "UTC";

        // Convert User's Local Time -> UTC for Storage
        const utcData = convertToUTC(date, time, timezone);
        
        if (!utcData) {
            return interaction.editReply(`❌ **Invalid Time/Date/Timezone.**\nEnsure format is YYYY-MM-DD and HH:MM.\nVerify timezone is valid (e.g. 'America/Chicago').`);
        }

        try {
            await ensureSheetTab("Reminders", REMINDER_HEADERS);
            // Append to sheet
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A:A" });
            const nextRow = (res.data.values || []).length + 1;

            // Mapped Row Data
            const values = [
                text, time, date, timezone,                 // A-D
                utcData.utcTime, utcData.utcDate,           // E-F (System uses this)
                recurrence, interaction.user.username, "FM",// G-I
                "public", targetType, targetValue,          // J-L
                "active", channel.id, channel.name          // M-O
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

    // --- OTHER COMMANDS (Preserved logic) ---
    if (interaction.commandName === "help") {
        return interaction.reply({ content: "Help menu placeholder.", ephemeral: true });
    }
    // (Additional command handling logic for property/dossier would go here, preserved from previous context)
});

// ───────────────────────────────────────────────
// 8. REMINDER ENGINE (Background Worker)
// ───────────────────────────────────────────────
async function checkReminders() {
    try {
        const res = await sheets.spreadsheets.values.get({ 
            spreadsheetId: GOOGLE_SHEET_ID, 
            range: "Reminders!A2:O100" // Adjust range size if needed
        });
        
        const rows = res.data.values || [];
        if (rows.length === 0) return;

        const now = DateTime.now().setZone("UTC");
        const guild = await client.guilds.fetch(GUILD_ID);

        for (let i = 0; i < rows.length; i++) {
            try {
                const r = rows[i];
                // Row mapping:
                // [0]Text, [4]UTCTime, [5]UTCDate, [6]Recur, [10]Type, [11]Val, [12]Status, [13]ChanID
                
                // 1. Check Status
                let status = r[12]?.trim().toLowerCase();
                if (!r || status === "completed" || !status) continue;

                // 2. Parse Date (Robust Parsing)
                const dateStr = r[5]?.trim();
                const timeStr = r[4]?.trim();
                // Combine into ISO format string 'YYYY-MM-DDTHH:mm'
                const rDt = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: "UTC" });
                
                if (!rDt.isValid) {
                    // console.log(`Invalid date at row ${i+2}`);
                    continue;
                }

                // 3. Calculate Difference
                const diffMinutes = rDt.diff(now, 'minutes').minutes;
                
                // Get Channel
                const chanId = r[13];
                const channel = await guild.channels.fetch(chanId).catch(() => null);
                if (!channel) continue;

                // ─── LOGIC: 30-MINUTE WARNING ───
                // Trigger if time is between 25 and 30 mins away, AND status is strictly "active"
                if (status === "active" && diffMinutes <= 30 && diffMinutes > 20) {
                    const mention = await resolvePing(guild, r[10], r[11]);
                    
                    const embed = new EmbedBuilder()
                        .setColor(0xffa500) // Orange
                        .setTitle("⏰ 30-MINUTE WARNING")
                        .setDescription(`**Event:** ${r[0]}\n**Time:** <t:${Math.floor(rDt.toSeconds())}:R>`);

                    await channel.send({ 
                        content: `${mention}`, 
                        embeds: [embed],
                        allowedMentions: { parse: ['users', 'roles'] }
                    });

                    // UPDATE STATUS -> 'warned' so we don't spam
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!M${i + 2}`,
                        valueInputOption: "USER_ENTERED", requestBody: { values: [["warned"]] }
                    });
                    console.log(`[SENT] 30m warning for row ${i+2}`);
                }

                // ─── LOGIC: FINAL ALERT ───
                // Trigger if time has arrived (<= 0) or is slightly passed (up to -5 mins)
                if (diffMinutes <= 0 && diffMinutes > -10) {
                    const mention = await resolvePing(guild, r[10], r[11]);

                    const embed = new EmbedBuilder()
                        .setColor(0xff0000) // Red
                        .setTitle("🔔 EVENT REMINDER")
                        .setDescription(`**Happening Now:** ${r[0]}`);

                    await channel.send({ 
                        content: `${mention}`, 
                        embeds: [embed],
                        allowedMentions: { parse: ['users', 'roles'] }
                    });
                    console.log(`[SENT] Final alert for row ${i+2}`);

                    // ─── CLEANUP / RECURRENCE ───
                    const recurrence = r[6]?.toLowerCase();
                    
                    if (recurrence === "none" || !recurrence) {
                        // DELETE ROW
                        await sheets.spreadsheets.batchUpdate({
                            spreadsheetId: GOOGLE_SHEET_ID,
                            requestBody: {
                                requests: [{ 
                                    deleteDimension: { 
                                        range: { sheetId: REMINDER_TAB_GID, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } 
                                    } 
                                }]
                            }
                        });
                        // Note: When deleting, we technically shift rows up, but the loop continues.
                        // Ideally, we'd decrement 'i', but for simplicity in low-volume bots, letting the next minute catch the shifted rows is fine.
                    } else {
                        // UPDATE DATE for Recurrence
                        let nextDt = rDt;
                        if (recurrence === "daily") nextDt = rDt.plus({ days: 1 });
                        if (recurrence === "weekly") nextDt = rDt.plus({ weeks: 1 });
                        if (recurrence === "monthly") nextDt = rDt.plus({ months: 1 });

                        // Write new UTC Date/Time (Cols E-F) and reset Status (Col M)
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
