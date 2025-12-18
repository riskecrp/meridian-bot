# Meridian Bot

A comprehensive Discord bot for managing faction information, property data, people records, scenes, and reminders with Google Sheets integration.

## Features

### Original Faction Management Commands

- `/factioninfo` - Look up faction information from the Meridian database (with autocomplete)
- `/addproperty` - Add a property reward and update the faction database (Management only)
- `/listproperties` - List all properties recorded on the PropertyRewards sheet (Management only)
- `/confiscateproperty` - Mark a property as confiscated with date tracking (Management only)
- `/adddossier person` - Add a person dossier entry to Sheet1 (Team Lead or Management)
- `/adddossier location` - Add a location dossier entry to Sheet1 (Team Lead or Management)

### New Property Information Commands

- `/getproperty` - Retrieve property information by name from the Properties sheet
- *Property addition is handled by `/addproperty` command above*

### New People Information Commands

- `/addperson` - Add person information with name, faction, role, and description
- `/getperson` - Retrieve person information by name from the People sheet

### New Faction Notes Commands

- `/addnote` - Add a notable interaction for a faction
- `/getnotes` - Retrieve notable interactions for a faction
  - Default: Shows notes from the last 30 days
  - Optional: Use `days` parameter to specify custom time range
  - Optional: Use `all` parameter to retrieve all notes regardless of date

### New Scene Management Commands

- `/addscene` - Add scene data with title, description, participants, and location
- `/logscene` - Log information about a specific scene
- `/getscenecount` - Retrieve the total count of scenes

### New Reminder Management Commands

- `/setreminder` - Set a reminder for an event
  - Time formats: 
    - ISO format: "2024-12-25 10:00"
    - Relative: "in 2 hours", "in 30 minutes", "in 5 days"
  - Maximum: ~24 days in advance
- `/listreminders` - List all your active reminders
- `/deletereminder` - Delete a specific reminder by ID

## Google Sheets Structure

The bot uses the following sheets in your Google Spreadsheet:

### Original Sheets

- **Sheet1** - Main faction database
  - Columns A-E: Person dossiers (Faction, Character, Phone, Personal Address, Leader)
  - Columns F-H: Location dossiers (Faction, Address, IsHQ)
- **PropertyRewards** - Property tracking
  - Columns A-F: Date Given, Faction, Address, Type, Confiscated, Date Confiscated

### New Sheets (Auto-created)

- **Properties** - Extended property information
  - Columns: Name, Description, Location, Owner, LastUpdated
- **People** - Extended people information
  - Columns: Name, Faction, Role, Description, LastUpdated
- **FactionNotes** - Faction interaction notes
  - Columns: Faction, Note, Author, Date
- **Scenes** - Scene records
  - Columns: Title, Description, Participants, Location, Date, AddedBy
- **SceneLogs** - Scene log entries
  - Columns: SceneName, LogEntry, LoggedBy, Timestamp

## Setup

### Prerequisites

- Node.js (v16 or higher)
- A Discord bot token
- A Google Cloud project with Sheets API enabled
- A Google service account with credentials
- A Google Sheets document

### Installation

1. Clone the repository:
```bash
git clone https://github.com/riskecrp/meridian-bot.git
cd meridian-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with the following variables:
```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_client_id
GUILD_ID=your_discord_guild_id
GOOGLE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=your_google_spreadsheet_id
```

### Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" section and create a bot
4. Copy the bot token and add it to your `.env` file
5. Go to the "OAuth2" section and copy the client ID
6. Generate an invite URL with the following scopes and permissions:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Use Slash Commands`
7. Use the invite URL to add the bot to your server

### Google Sheets Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Sheets API
4. Create a service account:
   - Go to "IAM & Admin" > "Service Accounts"
   - Create a new service account
   - Create a key (JSON format) for the service account
   - Copy the `client_email` and `private_key` from the JSON file
5. Share your Google Sheets document with the service account email (give it Editor permissions)
6. Copy the spreadsheet ID from the URL and add it to your `.env` file
   - The ID is the long string in the URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

### Important Notes on Google Private Key

When setting the `GOOGLE_PRIVATE_KEY` in your `.env` file:
- Keep the quotes around the value
- The `\n` characters represent newlines and should stay as `\n` in the .env file
- Example: `GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQI...\n-----END PRIVATE KEY-----\n"`

## Running the Bot

```bash
node index.js
```

The bot will automatically:
- Connect to Discord
- Register all slash commands
- Create necessary sheets in your Google Spreadsheet (if they don't exist)
- Set presence status

## Role Permissions

- **Management Role**: Required for `/addproperty`, `/listproperties`, `/confiscateproperty`
- **Team Lead or Management Role**: Required for `/adddossier`
- **Everyone**: Can use `/factioninfo` and all new commands (`/getproperty`, `/addperson`, `/getperson`, `/addnote`, `/getnotes`, `/addscene`, `/logscene`, `/getscenecount`, `/setreminder`, `/listreminders`, `/deletereminder`)

## Data Features

### Autocomplete

The `/factioninfo`, `/addproperty`, `/adddossier`, and `/confiscateproperty` commands support autocomplete for faction names, pulling data from Sheet1.

### Reminder Limitations

- Reminders are stored in memory and will be lost if the bot restarts
- Maximum reminder delay: approximately 24 days
- For longer-term reminders, consider external calendar solutions

### Timestamps

- All timestamps are stored in ISO 8601 format
- Dates in PropertyRewards use YYYY-MM-DD format
- Scene and note dates include full timestamps with time information

## Troubleshooting

### Commands not appearing
- Wait up to 1 hour for global commands to register (or use GUILD_ID for instant registration)
- Ensure the bot has the `applications.commands` scope

### Google Sheets errors
- Verify the service account email has Editor access to the spreadsheet
- Check that the GOOGLE_PRIVATE_KEY is properly formatted in .env
- Ensure the Google Sheets API is enabled in your Google Cloud project

### Permission errors
- Verify role names match exactly: "Management" and "Team Lead"
- Check that your Discord server has these roles created

## License

MIT
