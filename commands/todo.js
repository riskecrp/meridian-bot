import { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ComponentType
} from "discord.js";
import { sheets, GOOGLE_SHEET_ID } from "../utils/googleClient.js";

// --- CONFIGURATION ---
const NOTIFICATION_CHANNEL_ID = "1457201300583485491"; // Channel for pings
const ADMIN_ROLE_ID = "1457229857749729363"; // Who can ADD tasks
const TODO_TAB_ID = 1834789009; // The specific Sheet ID for the "ToDoList" tab

// --- HELPER: Get Date ---
function getTodayDate() {
    return new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

export default {
    data: new SlashCommandBuilder()
        .setName("todo")
        .setDescription("Task Management System")
        .addSubcommand(sub => sub.setName("view").setDescription("View and manage your tasks (User & Role based)."))
        .addSubcommand(sub => sub.setName("add").setDescription("Add a new task to the list.")
            .addStringOption(o => o.setName("description").setDescription("What needs to be done?").setRequired(true))
            .addUserOption(o => o.setName("target_user").setDescription("Assign to a specific User").setRequired(false))
            .addRoleOption(o => o.setName("target_role").setDescription("Assign to a specific Role").setRequired(false))
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        // -----------------------------
        // 1. ADD TASK LOGIC
        // -----------------------------
        if (sub === "add") {
            // Permission Check
            if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
                return interaction.reply({ content: "❌ You do not have permission to add tasks.", ephemeral: true });
            }

            const desc = interaction.options.getString("description");
            const targetUser = interaction.options.getUser("target_user");
            const targetRole = interaction.options.getRole("target_role");

            await interaction.deferReply({ ephemeral: true });

            try {
                // Prepare Data
                const id = Date.now().toString(); // Simple unique ID
                const createdDate = getTodayDate();
                
                let targetId, targetType, targetName;

                // LOGIC: Determine Target (User -> Role -> Default to Private)
                if (targetUser) {
                    targetId = targetUser.id;
                    targetType = "User";
                    targetName = targetUser.username;
                } else if (targetRole) {
                    targetId = targetRole.id;
                    targetType = "Role";
                    targetName = targetRole.name;
                } else {
                    // DEFAULT: Private Task
                    targetId = interaction.user.id;
                    targetType = "Private";
                    targetName = "Me (Private)";
                }
                
                // Save to Google Sheets
                // Columns: [ID, Description, TargetID, TargetType, ClaimedByID, CreatedAt]
                await sheets.spreadsheets.values.append({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: "ToDoList!A:F",
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [[id, desc, targetId, targetType, "None", createdDate]] }
                });

                // Send Ping Notification
                const channel = interaction.guild.channels.cache.get(NOTIFICATION_CHANNEL_ID);
                if (channel) {
                    let pingStr = "";
                    if (targetType === "User") pingStr = `<@${targetId}>`;
                    else if (targetType === "Role") pingStr = `<@&${targetId}>`;
                    else pingStr = `<@${interaction.user.id}> (Private)`;

                    await channel.send(`📝 **New Task:** ${pingStr} \n> ${desc}`);
                }

                return interaction.editReply(`✅ Task added for **${targetName}**.`);

            } catch (err) {
                console.error(err);
                return interaction.editReply("❌ Error saving to database.");
            }
        }

        // -----------------------------
        // 2. VIEW / MANAGE LOGIC
        // -----------------------------
        if (sub === "view") {
            await interaction.deferReply({ ephemeral: true });

            try {
                // Fetch All Tasks
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "ToDoList!A:F" });
                const rows = res.data.values || [];

                if (rows.length < 2) return interaction.editReply("✅ No tasks found."); // Row 0 is headers

                // FILTER: Find tasks relevant to this user
                // Match: 
                // 1. ClaimedBy is UserID
                // 2. TargetID is UserID (covers "User" and "Private" types)
                // 3. TargetID is one of User's Roles
                const myTasks = rows.slice(1).filter(row => {
                    const [id, desc, targetId, targetType, claimedBy] = row;
                    
                    if (claimedBy === interaction.user.id) return true; // I claimed it
                    if ((targetType === "User" || targetType === "Private") && targetId === interaction.user.id) return true; // Assigned to me
                    if (targetType === "Role" && interaction.member.roles.cache.has(targetId)) return true; // Assigned to my role
                    
                    return false;
                });

                if (myTasks.length === 0) return interaction.editReply("🎉 You have no pending tasks!");

                // Build Embed
                const embed = new EmbedBuilder()
                    .setTitle(`📋 Your To-Do List (${myTasks.length})`)
                    .setColor(0x00FF00)
                    .setDescription(myTasks.map(t => {
                        const isClaimed = t[4] !== "None" ? "🔒 _Claimed_" : "👐 _Open_";
                        const typeLabel = t[3] === "Private" ? "🔒 [Private]" : "";
                        return `• **${t[1]}** ${typeLabel} (${isClaimed})`;
                    }).join("\n").substring(0, 4096));

                // Build Dropdown
                // Limit to 25 items due to Discord limits
                const options = myTasks.slice(0, 25).map(t => ({
                    label: t[1].substring(0, 100), // Max label length
                    description: `ID: ${t[0]} | Status: ${t[4] !== "None" ? "Claimed" : "Unclaimed"}`,
                    value: t[0] // Passing the Unique ID
                }));

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('select_task')
                        .setPlaceholder('👇 Select a task to Manage')
                        .addOptions(options)
                );

                const msg = await interaction.editReply({ embeds: [embed], components: [row] });

                // -----------------------------
                // 3. INTERACTION COLLECTOR
                // -----------------------------
                const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });

                collector.on('collect', async i => {
                    const selectedId = i.values[0];
                    const taskRow = myTasks.find(t => t[0] === selectedId);

                    if (!taskRow) return i.reply({ content: "❌ Task not found.", ephemeral: true });

                    const [id, desc, targetId, targetType, claimedBy] = taskRow;
                    const isMyClaim = claimedBy === i.user.id;
                    const isUnclaimed = claimedBy === "None";

                    // Buttons logic
                    const btnRow = new ActionRowBuilder();

                    const claimBtn = new ButtonBuilder()
                        .setCustomId(`claim_${id}`)
                        .setLabel(isMyClaim ? "Already Claimed" : "✋ Claim Task")
                        .setStyle(isMyClaim ? ButtonStyle.Secondary : ButtonStyle.Primary)
                        .setDisabled(isMyClaim);

                    const completeBtn = new ButtonBuilder()
                        .setCustomId(`complete_${id}`)
                        .setLabel("✅ Complete & Remove")
                        .setStyle(ButtonStyle.Success);

                    btnRow.addComponents(claimBtn, completeBtn);

                    // Send the "Controls" message
                    const controlMsg = await i.reply({
                        content: `**Task Selected:** ${desc}\n**Status:** ${isUnclaimed ? "Unclaimed" : isMyClaim ? "Claimed by You" : "Claimed by someone else"}`,
                        components: [btnRow],
                        ephemeral: true,
                        fetchReply: true
                    });

                    // Button Collector inside the Dropdown interaction
                    const btnCollector = controlMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

                    btnCollector.on('collect', async b => {
                        await b.deferUpdate(); // Acknowledge click immediately

                        // RE-FETCH sheet to ensure fresh state (avoid race conditions)
                        const freshRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "ToDoList!A:F" });
                        const freshRows = freshRes.data.values || [];
                        const freshIndex = freshRows.findIndex(r => r[0] === id);

                        if (freshIndex === -1) {
                            return b.followUp({ content: "❌ Task no longer exists (might have been completed).", ephemeral: true });
                        }

                        // HANDLE CLAIM
                        if (b.customId.startsWith("claim")) {
                            // Update Column E (index 4)
                            const range = `ToDoList!E${freshIndex + 1}`;
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: GOOGLE_SHEET_ID,
                                range: range,
                                valueInputOption: "USER_ENTERED",
                                requestBody: { values: [[b.user.id]] }
                            });
                            await b.followUp({ content: `✅ You have claimed: **${desc}**`, ephemeral: true });
                        }

                        // HANDLE COMPLETE
                        if (b.customId.startsWith("complete")) {
                            // Delete Row using the hardcoded Tab ID
                            await sheets.spreadsheets.batchUpdate({
                                spreadsheetId: GOOGLE_SHEET_ID,
                                requestBody: {
                                    requests: [{
                                        deleteDimension: {
                                            range: {
                                                sheetId: TODO_TAB_ID,
                                                dimension: "ROWS",
                                                startIndex: freshIndex,
                                                endIndex: freshIndex + 1
                                            }
                                        }
                                    }]
                                }
                            });
                            await b.followUp({ content: `🎉 Task completed: **${desc}**`, ephemeral: true });
                        }
                    });
                });

            } catch (err) {
                console.error(err);
                if (!interaction.replied) interaction.editReply("❌ System Error.");
            }
        }
    }
};
