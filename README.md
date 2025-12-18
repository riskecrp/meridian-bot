# Meridian Bot

A Discord bot for managing faction information, property data, people records, scenes, and reminders with Google Sheets integration.

## Features

### Property Information
- `/addproperty` - Add property information with name, description, location, and owner
- `/getproperty` - Retrieve property information by name

### People Information
- `/addperson` - Add person information with name, faction, role, and description
- `/getperson` - Retrieve person information by name

### Faction Notes
- `/addnote` - Add a notable interaction for a faction
- `/getnotes` - Retrieve notable interactions for a faction
  - Default: Shows notes from the last 30 days
  - Optional: Use `days` parameter to specify custom time range
  - Optional: Use `all` parameter to retrieve all notes regardless of date

### Scene Management
- `/addscene` - Add scene data with title, description, participants, and location
- `/logscene` - Log information about a specific scene
- `/getscenecount` - Retrieve the total count of scenes

### Reminder Management
- `/setreminder` - Set a reminder for an event
  - Time formats: 
    - ISO format: "2024-12-25 10:00"
    - Relative: "in 2 hours", "in 30 minutes", "in 5 days"
- `/listreminders` - List all your active reminders
- `/deletereminder` - Delete a specific reminder by ID

## Setup

### Prerequisites
- Node.js (v16 or higher)
- A Discord bot token
- A Google Cloud project with Sheets API enabled
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
GUILD_ID=your_discord_guild_id_optional
SPREADSHEET_ID=your_google_spreadsheet_id
```

4. Create a `credentials.json` file with your Google service account credentials:
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "your-private-key-id",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "your-service-account@your-project.iam.gserviceaccount.com",
  "client_id": "your-client-id",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "your-cert-url"
}
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
4. Create a service account and download the credentials JSON
5. Share your Google Sheets document with the service account email
6. Copy the spreadsheet ID from the URL and add it to your `.env` file

## Running the Bot

```bash
node index.js
```

The bot will automatically create the necessary sheets in your Google Spreadsheet:
- `Properties` - Stores property information
- `People` - Stores people information
- `FactionNotes` - Stores faction notes
- `Scenes` - Stores scene data
- `SceneLogs` - Stores scene logs

## Data Structure

### Properties Sheet
- Name
- Description
- Location
- Owner
- LastUpdated

### People Sheet
- Name
- Faction
- Role
- Description
- LastUpdated

### FactionNotes Sheet
- Faction
- Note
- Author
- Date

### Scenes Sheet
- Title
- Description
- Participants
- Location
- Date
- AddedBy

### SceneLogs Sheet
- SceneName
- LogEntry
- LoggedBy
- Timestamp

## Notes

- Reminders are stored in memory and will be lost if the bot restarts
- All timestamps are stored in ISO 8601 format
- The bot uses slash commands which may take up to 1 hour to register globally (instant for guild commands)
- If using `GUILD_ID` in `.env`, commands will only be available in that specific guild but will register instantly

## License

MIT
