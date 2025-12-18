import { Client, GatewayIntentBits } from 'discord.js';

// Environment variables from Railway
const {
  CLIENT_ID,
  DISCORD_TOKEN,
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_SHEET_ID,
  GUILD_ID
} = process.env;

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Bot ready event
client.once('ready', () => {
  console.log(`✅ Bot is ready! Logged in as ${client.user.tag}`);
  
  // Only log environment variable status in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`📋 Environment variables loaded:`);
    console.log(`   - CLIENT_ID: ${CLIENT_ID ? '✓' : '✗'}`);
    console.log(`   - DISCORD_TOKEN: ${DISCORD_TOKEN ? '✓' : '✗'}`);
    console.log(`   - GOOGLE_CLIENT_EMAIL: ${GOOGLE_CLIENT_EMAIL ? '✓' : '✗'}`);
    console.log(`   - GOOGLE_PRIVATE_KEY: ${GOOGLE_PRIVATE_KEY ? '✓' : '✗'}`);
    console.log(`   - GOOGLE_SHEET_ID: ${GOOGLE_SHEET_ID ? '✓' : '✗'}`);
    console.log(`   - GUILD_ID: ${GUILD_ID ? '✓' : '✗'}`);
  }
});

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

// Login to Discord
if (!DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN environment variable is not set');
  process.exit(1);
}

client.login(DISCORD_TOKEN).catch((error) => {
  console.error('❌ Failed to login to Discord:', error);
  process.exit(1);
});