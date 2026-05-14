// MODIFIÉ CHANTIER 6 — 14/05/2026 — validateur messages absence isolé
function registerAbsenceValidatorEvent(client, { CONFIG }) {
    client.on('messageCreate', async message => {
        if (message.channelId !== CONFIG.CHANNELS.ABSENCE) return;
        if (message.author.bot) return;

        const c = message.content;
        const hasNom = /Nom\s*:/i.test(c);
        const hasPrenom = /Pr[ée]nom\s*:/i.test(c);
        const hasDate = /Date\(?s?\)?\s*:/i.test(c);
        const hasRaison = /Raison\s*:/i.test(c);
        const isValid = hasNom && hasPrenom && hasDate && hasRaison;

        if (!isValid) {
            const missing = [];
            if (!hasNom) missing.push('**Nom**');
            if (!hasPrenom) missing.push('**Prénom**');
            if (!hasDate) missing.push('**Date(s)**');
            if (!hasRaison) missing.push('**Raison**');

            try {
                const warn = await message.channel.send(
                    `${message.author} ${CONFIG.EMOJIS.ATTENTION} Ton absence n'est **pas conforme** au format demandé.\n` +
                    `\n📋 Élément(s) manquant(s) ou mal formaté(s) : ${missing.join(', ')}\n` +
                    `\n**Format à respecter :**\n` +
                    `\`\`\`\n` +
                    `Nom : Fayy\n` +
                    `Prénom : Nino\n` +
                    `Date(s) : 05/04 - 07/04\n` +
                    `Raison : En weekend\n` +
                    `\`\`\`\n` +
                    `Merci de **refaire un message** en respectant ce format. ${CONFIG.EMOJIS.BS21}`
                );
                setTimeout(() => warn.delete().catch(() => {}), 60_000);
            } catch (e) {
                console.error('❌ Erreur warn absence:', e.message);
            }
            return;
        }

        const dm = c.match(/Date\(?s?\)?\s*:\s*(.+)/i);
        if (dm) {
            const ds = dm[1].trim();
            const hasRange = /(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/.test(ds);
            const hasSingle = /(\d{1,2})\/(\d{1,2})/.test(ds);

            if (!hasRange && !hasSingle) {
                try {
                    const warn = await message.channel.send(
                        `${message.author} ${CONFIG.EMOJIS.ATTENTION} Ton format de **date** n'est pas reconnu.\n` +
                        `\n**Exemples acceptés :**\n` +
                        `• \`Date(s) : 05/04\` (un seul jour)\n` +
                        `• \`Date(s) : 05/04 - 07/04\` (plage de jours)\n` +
                        `\nMerci de corriger ton message ${CONFIG.EMOJIS.BS21}`
                    );
                    setTimeout(() => warn.delete().catch(() => {}), 60_000);
                } catch {}
            }
        }
    });
}

module.exports = { registerAbsenceValidatorEvent };
