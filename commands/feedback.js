import { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- HELPER: Get Date as DD/MON/YYYY ---
function getTodayDate() {
    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleString('en-GB', { month: 'short' }).toUpperCase();
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// --- HELPER: Fetch Faction Names ---
async function getFactionNames() {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "FactionData!A2:A999"
        });
        return (res.data.values || []).flat().map(f => f.trim()).filter(f => f);
    } catch (err) {
        console.error("Error fetching names:", err);
        return [];
    }
}

// --- HELPER: Double Lookup (Matrix -> Lead -> Staff Role) ---
async function getFactionRouting(factionName) {
    try {
        // STEP 1: Look up Faction in Matrix
        const matrixRes = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: "FactionData!A:E" // A=Name, B=LeadID, E=ThreadID
        });
        
        const matrixRows = matrixRes.data.values || [];
        const factionRow = matrixRows.find(r => r[0]?.toLowerCase().trim() === factionName.toLowerCase().trim());
        
        if (!factionRow) return { error: `Faction **${factionName}** not found in FactionData.` };

        const leadId = factionRow[1];      // Column B
        const threadId = factionRow[4];    // Column E

        if (!threadId) return { error: `No **Thread ID** found in Column E for **${factionName}**.` };

        // STEP 2: Look up Role in Roster
        let roleId = null;
        if (leadId && leadId !== "None" && /^\d+$/.test(leadId)) {
            const rosterRes = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "StaffRoster!A:B" // A=User ID, B=Role ID
            });
            const staffRow = (rosterRes.data.values || []).find(r => r[0]?.trim() === leadId.trim());
            if (staffRow) roleId = staffRow[1];
        }

        return {
            success: true,
            name: factionRow[0],
            threadId: threadId,
            roleId: roleId
        };

    } catch (err) {
        console.error("Routing Error:", err);
        return { error: "Database connection failed." };
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName("feedback")
        .setDescription("Submit scene feedback & tag the overseeing team.")
        .addStringOption(option => 
            option.setName("faction")
                .setDescription("The faction name")
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = await getFactionNames();
        const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
        await interaction.respond(filtered.map(c => ({ name: c, value: c })));
    },

    async execute(interaction) {
        const factionName = interaction.options.getString("faction");

        // 1. Create Modal
        const modal = new ModalBuilder()
            .setCustomId(`feedback_modal_${interaction.id}`)
            .setTitle(`Feedback: ${factionName.slice(0, 35)}`);

        const rewardsInput = new TextInputBuilder()
            .setCustomId('rewardsInput')
            .setLabel("Rewards / Items Issued")
            .setPlaceholder("e.g. 2x Pistols, $5000 (or None)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const feedbackInput = new TextInputBuilder()
            .setCustomId('feedbackInput')
            .setLabel("Scene Feedback / Notes")
            .setPlaceholder("Describe the scene and any critiques...")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(rewardsInput),
            new ActionRowBuilder().addComponents(feedbackInput)
        );

        await interaction.showModal(modal);

        // 2. Handle Submission
        try {
            const submission = await interaction.awaitModalSubmit({
                time: 600000, 
                filter: i => i.customId === `feedback_modal_${interaction.id}`
            });

            const rewards = submission.fields.getTextInputValue('rewardsInput');
            const feedback = submission.fields.getTextInputValue('feedbackInput');

            await submission.deferReply({ ephemeral: true });

            // 3. Perform Lookup
            const result = await getFactionRouting(factionName);
            if (result.error) {
                return submission.editReply(`❌ ${result.error}`);
            }

            // 4. Log to "Scene Logs" Tab
            const today = getTodayDate(); // DD/MON/YYYY
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: "Scene Logs!A:E",
                valueInputOption: "USER_ENTERED",
                requestBody: { 
                    values: [[today, result.name, rewards, interaction.user.tag, feedback]] 
                }
            });

            // 5. Post to Discord Thread
            const thread = await interaction.client.channels.fetch(result.threadId).catch(() => null);
            if (!thread) {
                return submission.editReply(`✅ Logged to Sheets, but ❌ **Could not find Thread** <#${result.threadId}>.`);
            }

            // Construct the Tag
            const ping = result.roleId ? `cc: <@&${result.roleId}>` : `cc: (No Team Assigned)`;

            // Safety Truncation for Rewards Field (Limit is 1024)
            const safeRewards = rewards.length > 1000 ? rewards.substring(0, 1000) + "..." : rewards;

            const embed = new EmbedBuilder()
                .setTitle(`📝 Scene Feedback: ${result.name}`)
                .setColor(0xFFA500)
                // FEEDBACK IS NOW IN DESCRIPTION (Allows 4096 chars)
                .setDescription(`**Feedback**\n${feedback}`)
                .addFields(
                    { name: "Rewards Issued", value: safeRewards, inline: false }
                )
                .setFooter({ text: `Logged by ${interaction.user.tag}` })
                .setTimestamp();

            await thread.send({ 
                content: `**New Feedback Received** ${ping}`, 
                embeds: [embed] 
            });

            await submission.editReply(`✅ **Success!** Feedback posted in <#${result.threadId}> and logged to sheet.`);

        } catch (err) {
            console.error("Feedback Error:", err);
            if (!interaction.replied) {
               // Silently catch timeout to prevent double reply crashes
            }
        }
    }
};
