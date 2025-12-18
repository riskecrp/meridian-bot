import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import fs from 'fs';

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Load Google credentials
let serviceAccountAuth;
try {
  const credentials = JSON.parse(fs.readFileSync('./credentials.json', 'utf8'));
  serviceAccountAuth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
} catch (error) {
  console.error('Error loading credentials.json:', error.message);
  process.exit(1);
}

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

// Initialize Google Sheets
let doc;
async function initializeSheet() {
  doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  console.log('Connected to Google Sheets:', doc.title);
}

// Helper function to get or create a sheet
async function getOrCreateSheet(title) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({ title, headerValues: [] });
    console.log(`Created new sheet: ${title}`);
  }
  return sheet;
}

// Helper function to format date
function formatDate(date = new Date()) {
  return date.toISOString().split('T')[0];
}

// Property Information Commands
async function getPropertyInfo(propertyName) {
  const sheet = await getOrCreateSheet('Properties');
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  
  const property = rows.find(row => 
    row.get('Name')?.toLowerCase() === propertyName.toLowerCase()
  );
  
  return property;
}

async function addPropertyInfo(name, data) {
  const sheet = await getOrCreateSheet('Properties');
  
  // Ensure headers exist
  if (!sheet.headerValues || sheet.headerValues.length === 0) {
    await sheet.setHeaderRow(['Name', 'Description', 'Location', 'Owner', 'LastUpdated']);
  }
  
  await sheet.addRow({
    Name: name,
    Description: data.description || '',
    Location: data.location || '',
    Owner: data.owner || '',
    LastUpdated: formatDate(),
  });
}

// People Information Commands
async function getPersonInfo(personName) {
  const sheet = await getOrCreateSheet('People');
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  
  const person = rows.find(row => 
    row.get('Name')?.toLowerCase() === personName.toLowerCase()
  );
  
  return person;
}

async function addPersonInfo(name, data) {
  const sheet = await getOrCreateSheet('People');
  
  // Ensure headers exist
  if (!sheet.headerValues || sheet.headerValues.length === 0) {
    await sheet.setHeaderRow(['Name', 'Faction', 'Role', 'Description', 'LastUpdated']);
  }
  
  await sheet.addRow({
    Name: name,
    Faction: data.faction || '',
    Role: data.role || '',
    Description: data.description || '',
    LastUpdated: formatDate(),
  });
}

// Faction Notes Commands
async function addFactionNote(faction, note, author) {
  const sheet = await getOrCreateSheet('FactionNotes');
  
  // Ensure headers exist
  if (!sheet.headerValues || sheet.headerValues.length === 0) {
    await sheet.setHeaderRow(['Faction', 'Note', 'Author', 'Date']);
  }
  
  await sheet.addRow({
    Faction: faction,
    Note: note,
    Author: author,
    Date: new Date().toISOString(),
  });
}

async function getFactionNotes(faction, daysBack = 30, getAll = false) {
  const sheet = await getOrCreateSheet('FactionNotes');
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  
  let notes = rows.filter(row => 
    row.get('Faction')?.toLowerCase() === faction.toLowerCase()
  );
  
  if (!getAll && daysBack) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    
    notes = notes.filter(row => {
      const noteDate = new Date(row.get('Date'));
      return noteDate >= cutoffDate;
    });
  }
  
  return notes;
}

// Scene Management Commands
async function addScene(sceneData) {
  const sheet = await getOrCreateSheet('Scenes');
  
  // Ensure headers exist
  if (!sheet.headerValues || sheet.headerValues.length === 0) {
    await sheet.setHeaderRow(['Title', 'Description', 'Participants', 'Location', 'Date', 'AddedBy']);
  }
  
  await sheet.addRow({
    Title: sceneData.title,
    Description: sceneData.description || '',
    Participants: sceneData.participants || '',
    Location: sceneData.location || '',
    Date: new Date().toISOString(),
    AddedBy: sceneData.addedBy,
  });
}

async function logScene(sceneInfo) {
  const sheet = await getOrCreateSheet('SceneLogs');
  
  // Ensure headers exist
  if (!sheet.headerValues || sheet.headerValues.length === 0) {
    await sheet.setHeaderRow(['SceneName', 'LogEntry', 'LoggedBy', 'Timestamp']);
  }
  
  await sheet.addRow({
    SceneName: sceneInfo.sceneName,
    LogEntry: sceneInfo.logEntry,
    LoggedBy: sceneInfo.loggedBy,
    Timestamp: new Date().toISOString(),
  });
}

async function getSceneCount() {
  const sheet = await getOrCreateSheet('Scenes');
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  return rows.length;
}

// Reminder Management
const reminders = new Map(); // In-memory storage for reminders

async function setReminder(userId, reminderData) {
  const reminderId = `${Date.now()}_${userId}`;
  const reminderTime = new Date(reminderData.time);
  
  const reminder = {
    id: reminderId,
    userId,
    message: reminderData.message,
    time: reminderTime,
    channelId: reminderData.channelId,
  };
  
  reminders.set(reminderId, reminder);
  
  // Schedule the reminder
  const delay = reminderTime.getTime() - Date.now();
  if (delay > 0) {
    setTimeout(async () => {
      const channel = await client.channels.fetch(reminder.channelId);
      if (channel) {
        await channel.send(`<@${userId}> Reminder: ${reminder.message}`);
      }
      reminders.delete(reminderId);
    }, delay);
  }
  
  return reminderId;
}

function listReminders(userId = null) {
  const userReminders = [];
  for (const [id, reminder] of reminders.entries()) {
    if (!userId || reminder.userId === userId) {
      userReminders.push({
        id,
        message: reminder.message,
        time: reminder.time.toISOString(),
      });
    }
  }
  return userReminders;
}

function deleteReminder(reminderId, userId) {
  const reminder = reminders.get(reminderId);
  if (reminder && reminder.userId === userId) {
    reminders.delete(reminderId);
    return true;
  }
  return false;
}

// Define slash commands
const commands = [
  // Property commands
  new SlashCommandBuilder()
    .setName('addproperty')
    .setDescription('Add property information')
    .addStringOption(option => 
      option.setName('name')
        .setDescription('Property name')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('description')
        .setDescription('Property description')
        .setRequired(false))
    .addStringOption(option => 
      option.setName('location')
        .setDescription('Property location')
        .setRequired(false))
    .addStringOption(option => 
      option.setName('owner')
        .setDescription('Property owner')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('getproperty')
    .setDescription('Get property information')
    .addStringOption(option => 
      option.setName('name')
        .setDescription('Property name')
        .setRequired(true)),
  
  // People commands
  new SlashCommandBuilder()
    .setName('addperson')
    .setDescription('Add person information')
    .addStringOption(option => 
      option.setName('name')
        .setDescription('Person name')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('faction')
        .setDescription('Faction affiliation')
        .setRequired(false))
    .addStringOption(option => 
      option.setName('role')
        .setDescription('Role or title')
        .setRequired(false))
    .addStringOption(option => 
      option.setName('description')
        .setDescription('Person description')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('getperson')
    .setDescription('Get person information')
    .addStringOption(option => 
      option.setName('name')
        .setDescription('Person name')
        .setRequired(true)),
  
  // Faction Notes commands
  new SlashCommandBuilder()
    .setName('addnote')
    .setDescription('Add a notable interaction for a faction')
    .addStringOption(option => 
      option.setName('faction')
        .setDescription('Faction name')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('note')
        .setDescription('Note content')
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('getnotes')
    .setDescription('Retrieve notable interactions for a faction')
    .addStringOption(option => 
      option.setName('faction')
        .setDescription('Faction name')
        .setRequired(true))
    .addIntegerOption(option => 
      option.setName('days')
        .setDescription('Number of days to look back (default: 30)')
        .setRequired(false))
    .addBooleanOption(option => 
      option.setName('all')
        .setDescription('Retrieve all notes regardless of date')
        .setRequired(false)),
  
  // Scene Management commands
  new SlashCommandBuilder()
    .setName('addscene')
    .setDescription('Add scene data')
    .addStringOption(option => 
      option.setName('title')
        .setDescription('Scene title')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('description')
        .setDescription('Scene description')
        .setRequired(false))
    .addStringOption(option => 
      option.setName('participants')
        .setDescription('Participants (comma-separated)')
        .setRequired(false))
    .addStringOption(option => 
      option.setName('location')
        .setDescription('Scene location')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('logscene')
    .setDescription('Log information about a specific scene')
    .addStringOption(option => 
      option.setName('scenename')
        .setDescription('Scene name')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('logentry')
        .setDescription('Log entry')
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('getscenecount')
    .setDescription('Retrieve the count of scenes'),
  
  // Reminder Management commands
  new SlashCommandBuilder()
    .setName('setreminder')
    .setDescription('Set a reminder for an event')
    .addStringOption(option => 
      option.setName('message')
        .setDescription('Reminder message')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('time')
        .setDescription('Time (e.g., "2024-12-25 10:00" or "in 2 hours")')
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('listreminders')
    .setDescription('List all active reminders'),
  
  new SlashCommandBuilder()
    .setName('deletereminder')
    .setDescription('Delete a specific reminder')
    .addStringOption(option => 
      option.setName('reminderid')
        .setDescription('Reminder ID')
        .setRequired(true)),
].map(command => command.toJSON());

// Register slash commands
async function registerCommands() {
  try {
    console.log('Started refreshing application (/) commands.');
    
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    
    if (GUILD_ID) {
      // Register commands for a specific guild (faster for development)
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands },
      );
      console.log('Successfully reloaded guild application (/) commands.');
    } else {
      // Register commands globally
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands },
      );
      console.log('Successfully reloaded global application (/) commands.');
    }
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// Parse time string to Date
function parseTimeString(timeStr) {
  // Try to parse as ISO date
  let date = new Date(timeStr);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  // Parse relative time like "in 2 hours", "in 30 minutes"
  const relativeMatch = timeStr.match(/in (\d+) (minute|minutes|hour|hours|day|days)/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const now = new Date();
    
    if (unit.startsWith('minute')) {
      now.setMinutes(now.getMinutes() + amount);
    } else if (unit.startsWith('hour')) {
      now.setHours(now.getHours() + amount);
    } else if (unit.startsWith('day')) {
      now.setDate(now.getDate() + amount);
    }
    
    return now;
  }
  
  return null;
}

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  
  try {
    await interaction.deferReply();
    
    const { commandName } = interaction;
    
    // Property commands
    if (commandName === 'addproperty') {
      const name = interaction.options.getString('name');
      const description = interaction.options.getString('description');
      const location = interaction.options.getString('location');
      const owner = interaction.options.getString('owner');
      
      await addPropertyInfo(name, { description, location, owner });
      await interaction.editReply(`✅ Property "${name}" has been added.`);
    }
    
    else if (commandName === 'getproperty') {
      const name = interaction.options.getString('name');
      const property = await getPropertyInfo(name);
      
      if (property) {
        const embed = new EmbedBuilder()
          .setTitle(`Property: ${property.get('Name')}`)
          .setColor(0x0099ff)
          .addFields(
            { name: 'Description', value: property.get('Description') || 'N/A', inline: false },
            { name: 'Location', value: property.get('Location') || 'N/A', inline: true },
            { name: 'Owner', value: property.get('Owner') || 'N/A', inline: true },
            { name: 'Last Updated', value: property.get('LastUpdated') || 'N/A', inline: true }
          );
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply(`❌ Property "${name}" not found.`);
      }
    }
    
    // People commands
    else if (commandName === 'addperson') {
      const name = interaction.options.getString('name');
      const faction = interaction.options.getString('faction');
      const role = interaction.options.getString('role');
      const description = interaction.options.getString('description');
      
      await addPersonInfo(name, { faction, role, description });
      await interaction.editReply(`✅ Person "${name}" has been added.`);
    }
    
    else if (commandName === 'getperson') {
      const name = interaction.options.getString('name');
      const person = await getPersonInfo(name);
      
      if (person) {
        const embed = new EmbedBuilder()
          .setTitle(`Person: ${person.get('Name')}`)
          .setColor(0x00ff99)
          .addFields(
            { name: 'Faction', value: person.get('Faction') || 'N/A', inline: true },
            { name: 'Role', value: person.get('Role') || 'N/A', inline: true },
            { name: 'Description', value: person.get('Description') || 'N/A', inline: false },
            { name: 'Last Updated', value: person.get('LastUpdated') || 'N/A', inline: true }
          );
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply(`❌ Person "${name}" not found.`);
      }
    }
    
    // Faction Notes commands
    else if (commandName === 'addnote') {
      const faction = interaction.options.getString('faction');
      const note = interaction.options.getString('note');
      const author = interaction.user.tag;
      
      await addFactionNote(faction, note, author);
      await interaction.editReply(`✅ Note added for faction "${faction}".`);
    }
    
    else if (commandName === 'getnotes') {
      const faction = interaction.options.getString('faction');
      const days = interaction.options.getInteger('days') || 30;
      const getAll = interaction.options.getBoolean('all') || false;
      
      const notes = await getFactionNotes(faction, days, getAll);
      
      if (notes.length > 0) {
        const embed = new EmbedBuilder()
          .setTitle(`Notes for Faction: ${faction}`)
          .setColor(0xff9900)
          .setDescription(getAll ? 'Showing all notes' : `Showing notes from the last ${days} days`);
        
        notes.slice(0, 10).forEach((note, index) => {
          const date = new Date(note.get('Date')).toLocaleDateString();
          embed.addFields({
            name: `${index + 1}. ${date} - ${note.get('Author')}`,
            value: note.get('Note') || 'N/A',
            inline: false
          });
        });
        
        if (notes.length > 10) {
          embed.setFooter({ text: `Showing 10 of ${notes.length} notes` });
        }
        
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply(`❌ No notes found for faction "${faction}".`);
      }
    }
    
    // Scene Management commands
    else if (commandName === 'addscene') {
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const participants = interaction.options.getString('participants');
      const location = interaction.options.getString('location');
      const addedBy = interaction.user.tag;
      
      await addScene({ title, description, participants, location, addedBy });
      await interaction.editReply(`✅ Scene "${title}" has been added.`);
    }
    
    else if (commandName === 'logscene') {
      const sceneName = interaction.options.getString('scenename');
      const logEntry = interaction.options.getString('logentry');
      const loggedBy = interaction.user.tag;
      
      await logScene({ sceneName, logEntry, loggedBy });
      await interaction.editReply(`✅ Log entry added for scene "${sceneName}".`);
    }
    
    else if (commandName === 'getscenecount') {
      const count = await getSceneCount();
      await interaction.editReply(`📊 Total scenes: ${count}`);
    }
    
    // Reminder Management commands
    else if (commandName === 'setreminder') {
      const message = interaction.options.getString('message');
      const timeStr = interaction.options.getString('time');
      const time = parseTimeString(timeStr);
      
      if (!time || time < new Date()) {
        await interaction.editReply('❌ Invalid time format or time is in the past. Use formats like "2024-12-25 10:00" or "in 2 hours".');
        return;
      }
      
      const reminderId = await setReminder(interaction.user.id, {
        message,
        time,
        channelId: interaction.channelId,
      });
      
      await interaction.editReply(`✅ Reminder set for ${time.toLocaleString()}. Reminder ID: ${reminderId}`);
    }
    
    else if (commandName === 'listreminders') {
      const userReminders = listReminders(interaction.user.id);
      
      if (userReminders.length > 0) {
        const embed = new EmbedBuilder()
          .setTitle('Your Active Reminders')
          .setColor(0x9900ff);
        
        userReminders.forEach((reminder, index) => {
          const time = new Date(reminder.time).toLocaleString();
          embed.addFields({
            name: `${index + 1}. ${time}`,
            value: `${reminder.message}\nID: ${reminder.id}`,
            inline: false
          });
        });
        
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply('📭 You have no active reminders.');
      }
    }
    
    else if (commandName === 'deletereminder') {
      const reminderId = interaction.options.getString('reminderid');
      const deleted = deleteReminder(reminderId, interaction.user.id);
      
      if (deleted) {
        await interaction.editReply('✅ Reminder deleted successfully.');
      } else {
        await interaction.editReply('❌ Reminder not found or you do not have permission to delete it.');
      }
    }
    
  } catch (error) {
    console.error('Error handling command:', error);
    try {
      await interaction.editReply('❌ An error occurred while processing your command.');
    } catch (e) {
      console.error('Error sending error message:', e);
    }
  }
});

// Bot ready event
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  try {
    await initializeSheet();
    await registerCommands();
    console.log('Bot is ready!');
  } catch (error) {
    console.error('Error during initialization:', error);
  }
});

// Login to Discord
if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is required');
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error('CLIENT_ID is required');
  process.exit(1);
}

if (!SPREADSHEET_ID) {
  console.error('SPREADSHEET_ID is required');
  process.exit(1);
}

client.login(DISCORD_TOKEN);