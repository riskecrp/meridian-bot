# Meridian Bot

A Discord bot that pulls faction information from Google Sheets and provides various management commands.

## Features

- Faction information lookup
- Property management
- Dossier management (people and locations)
- One-off scenes tracking
- Notable interactions logging
- **Automated reminder notifications**

## Environment Variables

The following environment variables must be configured:

- `DISCORD_TOKEN` - Your Discord bot token
- `CLIENT_ID` - Discord application client ID
- `GUILD_ID` - Discord server (guild) ID where commands will be registered
- `GOOGLE_CLIENT_EMAIL` - Google service account email
- `GOOGLE_PRIVATE_KEY` - Google service account private key
- `GOOGLE_SHEET_ID` - ID of the Google Sheet to use as database
- `REMINDER_CHANNEL_ID` - (Optional) Discord channel ID where reminder notifications will be posted

## Reminder System

The bot includes an automated reminder notification system that checks for due reminders every minute.

### Setting up Reminders

1. **Configure the reminder channel**: Set the `REMINDER_CHANNEL_ID` environment variable to the Discord channel ID where you want reminders to be posted.
   - To get a channel ID: Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
   - Right-click on the channel and select "Copy ID"

2. **Create reminders**: Use the `/setreminder` command (requires Team Leader, Management, or Team Guide role)
   - Specify the reminder text, time (HH:MM in 24-hour format), and date (YYYY-MM-DD)
   - Optional: Set recurrence (none, daily, weekly, monthly)
   - Optional: Set timezone (default: UTC)
   - Optional: Set visibility (private, role, public)

3. **Reminder notifications**: When a reminder is due, the bot will:
   - Send a notification in the configured reminder channel
   - Include an embed with the reminder text and metadata
   - Mention users based on visibility setting:
     - **Private**: Mentions the creator by name
     - **Role**: Mentions everyone with the creator's role
     - **Public**: Uses @here to notify all online users
   - For recurring reminders, automatically schedule the next occurrence
   - For one-time reminders, remove them after sending

### Visibility Settings

- **Private**: Only the creator will be notified (by username mention)
- **Role**: All users with the same role as the creator will be mentioned
- **Public**: All online users in the channel will be notified with @here

## Commands

- `/factioninfo` - Look up faction information
- `/addproperty` - Add a property reward (Management only)
- `/listproperties` - List all properties (Management only)
- `/confiscateproperty` - Mark property as confiscated (Management only)
- `/adddossier` - Add person or location dossier (Team Lead or Management)
- `/addscene` - Create a new one-off scene (Team Leader or Management)
- `/logscene` - Log scene execution (Team Leader, Management, or Team Guide)
- `/scenecount` - View faction's scene history (Everyone)
- `/listscenes` - List all available scenes (Everyone)
- `/addnote` - Log a notable interaction (Team Leader, Management, or Team Guide)
- `/getnotes` - View faction notes (Everyone)
- `/setreminder` - Create a reminder (Team Leader, Management, or Team Guide)
- `/listreminders` - View your reminders (Everyone)
- `/help` - Display help information

## Deployment

This bot is designed to run on Railway or similar platforms. Ensure all environment variables are properly configured in your deployment environment.

## Google Sheets Structure

The bot uses the following sheets/tabs:

- **Sheet1**: Main faction database (columns A-H for people and properties)
- **PropertyRewards**: Property reward tracking
- **One Off Scenes**: Scene tracking with metadata
- **Notable Interactions**: Faction interaction logs
- **Reminders**: Reminder schedule and settings

The bot will automatically create these sheets if they don't exist when first used.
