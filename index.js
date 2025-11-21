import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";
import { google } from "googleapis";

// Load secrets from Railway Environment Variables
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const GOOGLE_PROJECT_ID = process.env.GOOGLE_PROJECT_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Google Sheets Auth
const auth = new google.auth.GoogleAuth({
  credentials: {
    type: "service_account",
    project_id: GOOGLE_PROJECT_ID,
    private_key_id: "",
    private_key: GOOGLE_PRIVATE_KEY,
    client_email: GOOGLE_CLIENT_EMAIL,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

// Discord Client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Slash Command
const factionInfoCmd = new Sla
