import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

// --- AUTHENTICATION & SETUP ---
// Initialize Auth using Railway Environment Variables
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Fixes newlines in Railway env vars
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function getDoc() {
  const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

export default {
  data: new SlashCommandBuilder()
    .setName('matrix')
    .setDescription('Faction Management System')
    // 1. CREATE FACTION
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Initialize a new faction in the matrix.')
        .addStringOption(option => option.setName('name').setDescription('Faction Name').setRequired(true))
    )
    // 2. VIEW MATRIX
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View the status card for a faction.')
        .addStringOption(option => option.setName('name').setDescription('Faction Name').setRequired(true))
    )
    // 3. SET TIER
    .addSubcommand(subcommand =>
      subcommand
        .setName('settier')
        .setDescription('Update the tier and promotion date.')
        .addStringOption(option => option.setName('name').setDescription('Faction Name').setRequired(true))
        .addIntegerOption(option => option.setName('tier').setDescription('New Tier (1-9)').setMinValue(1).setMaxValue(9).setRequired(true))
    )
    // 4. SET LEAD
    .addSubcommand(subcommand =>
      subcommand
        .setName('setlead')
        .setDescription('Assign a Team Lead.')
        .addStringOption(option => option.setName('name').setDescription('Faction Name').setRequired(true))
        .addUserOption(option => option.setName('user').setDescription('The Team Lead').setRequired(true))
    ),

  async execute(interaction) {
    // --- PERMISSION CHECK ---
    const requiredRole = "[ECRP] Faction Management";
    if (!interaction.member.roles.cache.some(role => role.name === requiredRole)) {
      return interaction.reply({ content: `❌ Restricted to **${requiredRole}** only.`, ephemeral: true });
    }

    await interaction.deferReply();
    const subcommand = interaction.options.getSubcommand();
    const factionName = interaction.options.getString('name');

    try {
      const doc = await getDoc();
      const sheetData = doc.sheetsByTitle['FactionData']; // The new tab
      const sheetMaster = doc.sheetsByTitle['Sheet1'];    // The master list

      // Load all rows so we can search them
      const rows = await sheetData.getRows();

      // --- LOGIC: CREATE ---
      if (subcommand === 'create') {
        const masterRows = await sheetMaster.getRows();
        const existsInMaster = masterRows.some(row => row.get('Faction Name') === factionName);
        
        if (!existsInMaster) {
          await sheetMaster.addRow({ 'Faction Name': factionName });
        }

        const existingRow = rows.find(row => row.get('Faction Name') === factionName);
        if (existingRow) {
          return interaction.editReply(`❌ **${factionName}** already exists in the Matrix.`);
        }

        const today = new Date().toLocaleDateString('en-GB');
        await sheetData.addRow({
          'Faction Name': factionName,
          'Team Lead ID': 'None',
          'Current Tier': '0',
          'Last Promotion Date': today
        });

        return interaction.editReply(`✅ **${factionName}** initialized in Sheet1 and FactionData.`);
      }

      // --- LOGIC: VIEW ---
      if (subcommand === 'view') {
        const row = rows.find(r => r.get('Faction Name') === factionName);
        if (!row) return interaction.editReply(`❌ Could not find **${factionName}** in FactionData.`);

        const leadId = row.get('Team Lead ID');
        const leadDisplay = leadId === 'None' || !leadId ? 'None Assigned' : `<@${leadId}>`;

        const embed = new EmbedBuilder()
          .setTitle(`📂 Faction Matrix: ${factionName}`)
          .setColor(0x0099FF)
          .addFields(
            { name: 'Faction Name', value: row.get('Faction Name') || 'N/A', inline: false },
            { name: 'Faction Team Lead', value: leadDisplay, inline: false },
            { name: 'Current Tier', value: row.get('Current Tier') || '0', inline: false },
            { name: 'Last Promotion Date', value: row.get('Last Promotion Date') || 'N/A', inline: false }
          )
          .setFooter({ text: '[ECRP] Faction Management System' });

        return interaction.editReply({ embeds: [embed] });
      }

      // --- LOGIC: SET TIER ---
      if (subcommand === 'settier') {
        const tier = interaction.options.getInteger('tier');
        const row = rows.find(r => r.get('Faction Name') === factionName);
        
        if (!row) return interaction.editReply(`❌ Could not find **${factionName}**.`);

        const today = new Date().toLocaleDateString('en-GB');
        row.assign({ 'Current Tier': String(tier), 'Last Promotion Date': today });
        await row.save();

        return interaction.editReply(`✅ **${factionName}** promoted to **Tier ${tier}** on ${today}.`);
      }

      // --- LOGIC: SET LEAD ---
      if (subcommand === 'setlead') {
        const user = interaction.options.getUser('user');
        const row = rows.find(r => r.get('Faction Name') === factionName);

        if (!row) return interaction.editReply(`❌ Could not find **${factionName}**.`);

        row.assign({ 'Team Lead ID': user.id });
        await row.save();

        return interaction.editReply(`✅ **${factionName}** is now led by ${user}.`);
      }

    } catch (error) {
      console.error(error);
      return interaction.editReply('❌ An error occurred while communicating with Google Sheets. Check logs.');
    }
  },
};
