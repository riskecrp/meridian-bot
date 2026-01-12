import { AttachmentBuilder, EmbedBuilder } from "discord.js";

export function chunkLinesToFieldValues(lines, maxLen = 1024) {
    const chunks = [];
    let current = "";

    for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > maxLen) {
            if (current) {
                chunks.push(current);
                current = line;
                // If single line longer than maxLen, force-split
                if (current.length > maxLen) {
                    let start = 0;
                    while (start < current.length) {
                        const piece = current.slice(start, start + maxLen);
                        chunks.push(piece);
                        start += maxLen;
                    }
                    current = "";
                }
            } else {
                let start = 0;
                while (start < line.length) {
                    const piece = line.slice(start, start + maxLen);
                    chunks.push(piece);
                    start += maxLen;
                }
                current = "";
            }
        } else {
            current = next;
        }
    }

    if (current) chunks.push(current);
    return chunks;
}

// A helper to handle sending large lists as embeds or file attachments
export async function replyWithPaginatedEmbed(interaction, lines, title) {
    // 1. If empty
    if (lines.length === 0) {
        const embed = new EmbedBuilder()
            .setColor(0x2b6cb0)
            .setTitle(title)
            .addFields({ name: "⠀", value: "_No records found._" });
        return interaction.reply({ embeds: [embed] });
    }

    // 2. Chunk Data
    const fieldValues = chunkLinesToFieldValues(lines, 1024);
    const fields = fieldValues.map((v) => ({ name: "⠀", value: v }));

    const MAX_FIELDS_PER_EMBED = 25;
    const MAX_EMBEDS = 10;

    // 3. Simple Case: Fits in one embed
    if (fields.length <= MAX_FIELDS_PER_EMBED) {
        const embed = new EmbedBuilder()
            .setColor(0x2b6cb0)
            .setTitle(title)
            .addFields(fields);
        return interaction.reply({ embeds: [embed] });
    }

    // 4. Complex Case: Multiple Embeds
    if (fields.length <= MAX_FIELDS_PER_EMBED * MAX_EMBEDS) {
        const embeds = [];
        for (let i = 0; i < fields.length; i += MAX_FIELDS_PER_EMBED) {
            const slice = fields.slice(i, i + MAX_FIELDS_PER_EMBED);
            const embed = new EmbedBuilder()
                .setColor(0x2b6cb0)
                .setTitle(i === 0 ? title : `${title} (Cont.)`)
                .addFields(slice);
            embeds.push(embed);
        }
        return interaction.reply({ embeds });
    }

    // 5. Overflow Case: Send as Text File
    const fullText = lines.join("\n");
    const buffer = Buffer.from(fullText, "utf8");
    const attachment = new AttachmentBuilder(buffer, { name: "list.txt" });
    
    const fallbackEmbed = new EmbedBuilder()
        .setColor(0x2b6cb0)
        .setTitle(title)
        .setDescription("The list is too long to display here. See attached file.");

    return interaction.reply({ embeds: [fallbackEmbed], files: [attachment] });
}

/**
 * Resolves a target string into a mention.
 * Detects if the string is ALREADY a ping (<@...>) and returns it as-is.
 */
export async function resolvePing(guild, type, value) {
    if (!value) return "@Unknown";
    const raw = value.trim();

    // 1. If it looks like <@12345...> or <@&12345...>, IT IS ALREADY A PING.
    if (raw.startsWith('<') && raw.endsWith('>')) {
        return raw;
    }

    // 2. Clean the input for searching (remove @ temporarily)
    const cleanValue = raw.replace(/^@+/, '').toLowerCase();
    
    try {
        if (type === "role") {
            const roles = await guild.roles.fetch();
            const role = roles.find(r => r.name.toLowerCase() === cleanValue);
            if (role) return `<@&${role.id}>`;
        } else {
            const members = await guild.members.fetch();
            const member = members.find(m => m.user.username.toLowerCase() === cleanValue);
            if (member) return `<@${member.id}>`;
        }
    } catch (e) { 
        console.error("Ping Resolution Error:", e.message);
    }

    // 3. Fallback: If search failed, just assume user wants text.
    return raw.startsWith('@') ? raw : `@${raw}`;
}
