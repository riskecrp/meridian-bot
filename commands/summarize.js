import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import OpenAI from "openai";

// Initialize OpenAI
// Ensure OPENAI_API_KEY is set in Railway Variables
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, 
});

export default {
    data: new SlashCommandBuilder()
        .setName("summarize")
        .setDescription("Uses AI to summarize this channel's recent storyline and needs."),

    async execute(interaction) {
        // PERMISSION CHECK
        const ROLE_LEADERSHIP_ID = "1457670376745074730";
        if (!interaction.member.roles.cache.has(ROLE_LEADERSHIP_ID)) {
            return interaction.reply({ content: "❌ Restricted to FM Leadership.", ephemeral: true });
        }

        if (!process.env.OPENAI_API_KEY) {
            return interaction.reply({ content: "❌ System Error: No `OPENAI_API_KEY` found in environment variables.", ephemeral: true });
        }

        await interaction.deferReply();

        try {
            // 1. Fetch last 100 messages
            const messages = await interaction.channel.messages.fetch({ limit: 100 });
            
            // 2. Format messages (Content + Embeds)
            // We read Oldest -> Newest to make sense of the timeline
            const conversation = messages.reverse().map(m => {
                let entry = `[${m.author.username}]: ${m.content}`;

                // Process Embeds (Crucial for Bot Logs/Apps)
                if (m.embeds.length > 0) {
                    m.embeds.forEach((embed, i) => {
                        entry += `\n   [Embed ${i+1}]: ${embed.title || "No Title"}`;
                        if (embed.description) entry += `\n   Description: ${embed.description}`;
                        
                        // Process Fields (common in applications/logs)
                        if (embed.fields && embed.fields.length > 0) {
                            embed.fields.forEach(f => {
                                entry += `\n   - ${f.name}: ${f.value}`;
                            });
                        }
                    });
                }
                return entry;
            }).join("\n\n");

            if (conversation.length < 50) {
                return interaction.editReply("❌ Not enough recent conversation or data to summarize.");
            }

            // 3. Send to AI
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // Very cheap, very fast, smart enough for summaries
                messages: [
                    { 
                        role: "system", 
                        content: `You are a Faction Management Assistant for a GTA V Roleplay server. 
                        Analyze the provided channel transcript (which includes user chat and bot logs).
                        
                        Provide a clean, professional report with these exact headers:
                        
                        ### 1. The Situation
                        (Summarize the narrative. Who is involved? What major events, scenes, or applications happened recently?)
                        
                        ### 2. Missing Information / Plot Holes
                        (Are there vague details? Did a bot log mention rewards but no specific items? Is a motive unclear?)
                        
                        ### 3. Action Items
                        (What does Faction Management or the players need to do next? e.g., "Approve application", "Issue rewards", "Follow up on thread".)` 
                    },
                    { role: "user", content: conversation }
                ],
                max_tokens: 1200,
            });

            const summary = completion.choices[0].message.content;

            // 4. Output Result
            // If the summary is huge, send as a file. Otherwise, embed it.
            if (summary.length > 4096) {
                const buffer = Buffer.from(summary, 'utf-8');
                return interaction.editReply({ 
                    content: "📝 **Summary generated** (See attached).",
                    files: [{ attachment: buffer, name: 'channel-summary.txt' }] 
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(`📝 Storyline Summary: #${interaction.channel.name}`)
                .setColor(0x00FF00) // Green
                .setDescription(summary)
                .setFooter({ text: "Generated via OpenAI • Analyzed Content & Embeds" })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error("Summarize Error:", err);
            // Handle specific OpenAI errors (like Quota exceeded)
            if (err.status === 429) {
                return interaction.editReply("❌ Error: OpenAI API Quota Exceeded. Check billing at platform.openai.com.");
            }
            return interaction.editReply("❌ Error generating summary. Check console logs.");
        }
    }
};
