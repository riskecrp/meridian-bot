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
const NOTIFICATION_CHANNEL_ID = "1457201300583485491"; 
const ADMIN_ROLE_ID = "1457229857749729363"; 
const TODO_TAB_ID = 1834789009; 

// --- HELPER: Get Date ---
function getTodayDate() {
    return new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

export default {
    data: new SlashCommandBuilder()
        .setName("todo")
        .setDescription("Task Management System")
        .addSubcommand(sub => sub.setName("view").setDescription("View and manage your tasks."))
        .addSubcommand(sub => sub.setName("add").setDescription("Add a new task.")
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
            if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
                return interaction.reply({ content: "You do not have permission to add tasks.", ephemeral: true });
            }

            const desc = interaction.options.getString("description");
            const targetUser = interaction.options.getUser("target_user");
            const targetRole = interaction.options.getRole("target_role");

            await interaction.deferReply({ ephemeral: true });

            try {
                const id = Date.now().toString(); 
                const createdDate = getTodayDate();
                
                let targetId, targetType, targetName;
                let isPrivate = false;

                if (targetUser) {
                    targetId = targetUser.id;
                    targetType = "User";
                    targetName = targetUser.username;
                } else if (targetRole) {
                    targetId = targetRole.id;
                    targetType = "Role";
                    targetName = targetRole.name;
                } else {
                    targetId = interaction.user.id;
                    targetType = "Private";
                    targetName = "Me (Private)";
                    isPrivate = true;
                }
                
                // Save to Google Sheets
                await sheets.spreadsheets.values.append({
                    spreadsheetId: GOOGLE_SHEET_ID,
                    range: "ToDoList!A:G",
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [[id, desc, targetId, targetType, "None", createdDate, ""]] }
                });

                // Notification Logic
                if (!isPrivate) {
                    const channel = interaction.guild.channels.cache.get(NOTIFICATION_CHANNEL_ID);
                    if (channel) {
                        let pingStr = targetType === "User" ? `<@${targetId}>` : `<@&${targetId}>`;
                        await channel.send(`${pingStr} A new task has been added to the To Do list.\n-# Type /todo view to see tasks assigned to you and your roles.`);
                    }
                }

                return interaction.editReply(`Task added for **${targetName}**.`);

            } catch (err) {
                console.error(err);
                return interaction.editReply("Error saving to database.");
            }
        }

        // -----------------------------
        // 2. VIEW / MANAGE LOGIC
        // -----------------------------
        if (sub === "view") {
            await interaction.deferReply({ ephemeral: true });

            try {
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "ToDoList!A:G" });
                const rows = res.data.values || [];

                if (rows.length < 2) return interaction.editReply("No tasks found."); 

                const myTasks = rows.slice(1).filter(row => {
                    const [id, desc, targetId, targetType, claimedBy] = row;
                    if (claimedBy === interaction.user.id) return true; 
                    if ((targetType === "User" || targetType === "Private") && targetId === interaction.user.id) return true; 
                    if (targetType === "Role" && interaction.member.roles.cache.has(targetId)) return true; 
                    return false;
                });

                if (myTasks.length === 0) return interaction.editReply("You have no pending tasks.");

                const embed = new EmbedBuilder()
                    .setTitle(`Your To-Do List (${myTasks.length})`)
                    .setColor(0x00FF00)
                    .setDescription(myTasks.map(t => {
                        const isClaimed = t[4] !== "None" ? "(Claimed)" : "(Open)";
                        const typeLabel = t[3] === "Private" ? "[Private]" : "";
                        return `• **${t[1]}** ${typeLabel} ${isClaimed}`;
                    }).join("\n").substring(0, 4096));

                const options = myTasks.slice(0, 25).map(t => ({
                    label: t[1].substring(0, 100), 
                    description: `ID: ${t[0]} | Status: ${t[4] !== "None" ? "Claimed" : "Unclaimed"}`,
                    value: t[0] 
                }));

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('select_task')
                        .setPlaceholder('Select a task to Manage')
                        .addOptions(options)
                );

                const msg = await interaction.editReply({ embeds: [embed], components: [row] });

                const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });

                collector.on('collect', async i => {
                    const selectedId = i.values[0];
                    const taskRow = myTasks.find(t => t[0] === selectedId);

                    if (!taskRow) return i.reply({ content: "Task not found.", ephemeral: true });

                    const [id, desc, targetId, targetType, claimedBy] = taskRow;
                    const isMyClaim = claimedBy === i.user.id;
                    const isUnclaimed = claimedBy === "None";

                    // Initial Control Buttons
                    const btnRow = new ActionRowBuilder();
                    const claimBtn = new ButtonBuilder().setCustomId(`claim_${id}`).setLabel("Claim Task").setStyle(ButtonStyle.Primary).setDisabled(!isUnclaimed && !isMyClaim);
                    const completeBtn = new ButtonBuilder().setCustomId(`complete_${id}`).setLabel("Complete & Remove").setStyle(ButtonStyle.Success);

                    btnRow.addComponents(claimBtn, completeBtn);

                    const controlMsg = await i.reply({
                        content: `**Task:** ${desc}\n**Status:** ${isUnclaimed ? "Unclaimed" : isMyClaim ? "Claimed by You" : "Claimed by someone else"}`,
                        components: [btnRow],
                        ephemeral: true,
                        fetchReply: true
                    });

                    const btnCollector = controlMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

                    btnCollector.on('collect', async b => {
                        const freshRes = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "ToDoList!A:G" });
                        const freshRows = freshRes.data.values || [];
                        const freshIndex = freshRows.findIndex(r => r[0] === id);
                        if (freshIndex === -1) return b.update({ content: "Task no longer exists.", components: [] });

                        if (b.customId.startsWith("complete")) {
                            await sheets.spreadsheets.batchUpdate({
                                spreadsheetId: GOOGLE_SHEET_ID,
                                requestBody: { requests: [{ deleteDimension: { range: { sheetId: TODO_TAB_ID, dimension: "ROWS", startIndex: freshIndex, endIndex: freshIndex + 1 } } }] }
                            });
                            return b.update({ content: `Task completed: **${desc}**`, components: [] });
                        }

                        if (b.customId.startsWith("claim")) {
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: GOOGLE_SHEET_ID,
                                range: `ToDoList!E${freshIndex + 1}`,
                                valueInputOption: "USER_ENTERED",
                                requestBody: { values: [[b.user.id]] }
                            });

                            const reminderRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`remind_yes_${id}`).setLabel("Yes, DM me reminders").setStyle(ButtonStyle.Success),
                                new ButtonBuilder().setCustomId(`remind_no_${id}`).setLabel("No, thanks").setStyle(ButtonStyle.Secondary)
                            );

                            await b.update({ 
                                content: `You have claimed: **${desc}**.\n\nWould you like a DM reminder of this task every 24 hours of completion?`, 
                                components: [reminderRow] 
                            });
                        }

                        if (b.customId.startsWith("remind_")) {
                            const isYes = b.customId.includes("yes");
                            const nextRemind = isYes ? (Date.now() + 86400000).toString() : ""; 
                            
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: GOOGLE_SHEET_ID,
                                range: `ToDoList!G${freshIndex + 1}`,
                                valueInputOption: "USER_ENTERED",
                                requestBody: { values: [[nextRemind]] }
                            });

                            return b.update({ 
                                content: isYes ? "Reminder set. I will DM you every 24 hours." : "No reminder set.", 
                                components: [] 
                            });
                        }
                    });
                });

            } catch (err) {
                console.error(err);
                if (!interaction.replied) interaction.editReply("System Error.");
            }
        }
    }
};
