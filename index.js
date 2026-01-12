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
// CONFIGURATION
// ───────────────────────────────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

const FACTION_MANAGEMENT_ROLE_ID = "1457229857749729363";
const REMINDER_GID = 543228518;

// ───────────────────────────────────────────────
// AUTH & CLIENT
// ───────────────────────────────────────────────
const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL, null, GOOGLE_PRIVATE_KEY, ["https://www.googleapis.com/auth/spreadsheets"]
);
const sheets = google.sheets({ version: "v4", auth });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages
    ]
});

// Use global sets to track notifications during the current runtime
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
    } catch (e) { return `@${value}`; }
}

// ───────────────────────────────────────────────
// COMMANDS
// ───────────────────────────────────────────────
const deploy = [
    new SlashCommandBuilder()
        .setName("setreminder")
        .setDescription("Set a reminder with auto-pings")
        .addStringOption(o => o.setName("text").setDescription("Content").setRequired(true))
        .addStringOption(o => o.setName("time").setDescription("HH:MM (24h UTC)").setRequired(true))
        .addStringOption(o => o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("Where to ping").addChannelTypes(0).setRequired(true))
        .addStringOption(o => o.setName("target_type").setDescription("User or Role").setRequired(true).addChoices({name:"User", value:"user"},{name:"Role", value:"role"}))
        .addStringOption(o => o.setName("target_value").setDescription("Username or Role Name").setRequired(true))
        .addStringOption(o => o.setName("recurrence").setDescription("Pattern").addChoices({name:"None", value:"none"},{name:"Daily", value:"daily"},{name:"Weekly", value:"weekly"},{name:"Monthly", value:"monthly"}))
];

client.once("ready", async () => {
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: deploy });
    
    console.log(`[SYSTEM] Bot Online. Initializing loop...`);
    
    // Core Loop: Runs every minute
    cron.schedule("* * * * *", async () => {
        const timestamp = DateTime.now().setZone("UTC").toFormat("HH:mm:ss");
        console.log(`[PULSE] Heartbeat at ${timestamp} UTC`);
        try {
            await checkReminders();
        } catch (err) {
            console.error("[CRON ERROR]", err.message);
        }
    });
});

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "setreminder") {
        const isFM = interaction.member.roles.cache.has(FACTION_MANAGEMENT_ROLE_ID);
        if (!isFM) return interaction.reply({ content: "Unauthorized.", ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        const [text, time, date, chan, tType, tVal, rec] = [
            interaction.options.getString("text"), interaction.options.getString("time"),
            interaction.options.getString("date"), interaction.options.getChannel("channel"),
            interaction.options.getString("target_type"), interaction.options.getString("target_value"),
            interaction.options.getString("recurrence") || "none"
        ];

        // Format validation
        const dt = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", { zone: "UTC" });
        if (!dt.isValid) return interaction.editReply("❌ Use YYYY-MM-DD and HH:MM format.");

        try {
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Reminders!A:A" });
            const nextRow = (res.data.values || []).length + 1;
            
            const values = [text, time, date, "UTC", dt.toFormat("HH:mm"), dt.toFormat("yyyy-MM-dd"), rec, interaction.user.username, "FM", "public", tType, tVal, "active", chan.id, chan.name];

            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!A${nextRow}:O${nextRow}`,
                valueInputOption: "USER_ENTERED", requestBody: { values: [values] }
            });
            return interaction.editReply(`✅ Success. Reminder for **${tVal}** logged.`);
        } catch (e) { return interaction.editReply("❌ Sheet Error."); }
    }
});

// ───────────────────────────────────────────────
// REMINDER ENGINE
// ───────────────────────────────────────────────
async function checkReminders() {
    // 1. Fetch data from Sheet
    const res = await sheets.spreadsheets.values.get({ 
        spreadsheetId: GOOGLE_SHEET_ID, 
        range: "Reminders!A2:O100" 
    });
    
    const rows = res.data.values || [];
    if (rows.length === 0) return;

    const now = DateTime.now().setZone("UTC");
    const guild = await client.guilds.fetch(GUILD_ID);

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        
        // Status check (Col M = Index 12)
        if (!r || r.length < 13 || r[12]?.trim().toLowerCase() !== "active") continue;

        // Date/Time Check (Col F=Index 5, Col E=Index 4)
        const rDt = DateTime.fromFormat(`${r[5]?.trim()} ${r[4]?.trim()}`, "yyyy-MM-dd HH:mm", { zone: "UTC" });
        if (!rDt.isValid) continue;

        const diff = rDt.diff(now, 'minutes').minutes;
        const key = `${r[5]}_${r[4]}_${r[11]}_${r[13]}`; 

        // 1. 30-MINUTE WARNING (25 to 30 mins remaining)
        if (diff <= 30 && diff > 24 && !notified30m.has(key)) {
            try {
                const chan = await guild.channels.fetch(r[13]);
                const mention = await resolvePing(guild, r[10], r[11]);
                await chan.send({ 
                    content: `${mention} **30-MINUTE WARNING**`, 
                    embeds: [new EmbedBuilder().setColor(0xffa500).setTitle("Upcoming Event").setDescription(r[0])]
                });
                notified30m.add(key);
                console.log(`[SENT] 30m Ping for ${r[11]}`);
            } catch (e) { console.error(`[SKIP] Could not ping channel ${r[13]}`); }
        }

        // 2. FINAL ALERT (Due now or up to 3 mins past)
        if (diff <= 0 && diff > -4 && !notifiedFinal.has(key)) {
            try {
                const chan = await guild.channels.fetch(r[13]);
                const mention = await resolvePing(guild, r[10], r[11]);
                await chan.send({ 
                    content: `${mention} **EVENT STARTING NOW**`, 
                    embeds: [new EmbedBuilder().setColor(0xff0000).setTitle("Reminder").setDescription(r[0])]
                });
                notifiedFinal.add(key);
                console.log(`[SENT] Final Ping for ${r[11]}`);

                // CLEANUP / RECURRENCE
                if (r[6]?.toLowerCase() === "none") {
                    await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: GOOGLE_SHEET_ID,
                        requestBody: {
                            requests: [{ deleteDimension: { range: { sheetId: REMINDER_GID, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 } } }]
                        }
                    });
                } else {
                    const rec = r[6].toLowerCase();
                    const next = rDt.plus(rec === "daily" ? { days: 1 } : rec === "weekly" ? { weeks: 1 } : { months: 1 });
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEET_ID, range: `Reminders!F${i + 2}`,
                        valueInputOption: "USER_ENTERED", requestBody: { values: [[next.toFormat("yyyy-MM-dd")]] }
                    });
                }
            } catch (e) { console.error(`[SKIP] Final ping failed for ${r[11]}`); }
        }
    }
}

client.login(DISCORD_TOKEN);
