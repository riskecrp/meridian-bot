import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import OpenAI from "openai";

export default {
    data: new SlashCommandBuilder()
        .setName("summarize")
        .setDescription("Uses AI to summarize this channel's recent storyline and needs."),

    async execute(interaction) {
        // 1. Check for Key NOW (not at startup)
        if (!process.env.OPENAI_API_KEY) {
            return interaction.reply({ 
                content: "❌ **System Error:** No `OPENAI_API_KEY` found in Railway variables.\nPlease create an API key at https://platform.openai.com and add it to your Railway variables.", 
                ephemeral: true 
            });
        }

        // 2. Initialize OpenAI ONLY when command is run
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY, 
        });

        // PERMISSION CHECK
        const ROLE_LEADERSHIP_ID = "1457670376745074730";
        if (!interaction.member.roles.cache.has(ROLE_LEADERSHIP_ID)) {
            return interaction.reply({ content: "❌ Restricted to FM Leadership.", ephemeral: true });
        }

        await interaction.deferReply();

        try {
            // 3. Fetch last 100 messages
            const messages = await interaction.channel.messages.fetch({ limit: 100 });
            
            // 4. Format messages
            const conversation = messages.reverse().map(m => {
                let entry = `[${m.author.username}]: ${m.content}`;

                if (m.embeds.length > 0) {
                    m.embeds.forEach((embed, i) => {
                        entry += `\n   [Embed ${i+1}]: ${embed.title || "No Title"}`;
                        if (embed.description) entry += `\n   Description: ${embed.description}`;
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

            // 5. Send to AI
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
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

            if (summary.length > 4096) {
                const buffer = Buffer.from(summary, 'utf-8');
                return interaction.editReply({ 
                    content: "📝 **Summary generated** (See attached).",
                    files: [{ attachment: buffer, name: 'channel-summary.txt' }] 
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(`📝 Storyline Summary: #${interaction.channel.name}`)
                .setColor(0x00FF00)
                .setDescription(summary)
                .setFooter({ text: "Generated via OpenAI • Analyzed Content & Embeds" })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error("Summarize Error:", err);
            if (err.status === 429) {
                return interaction.editReply("❌ Error: OpenAI API Quota Exceeded. Check billing at platform.openai.com.");
            }
            return interaction.editReply("❌ Error generating summary. Check console logs.");
        }
    }
};
