// MODIFIÉ CHANTIER 6 — 14/05/2026 — commandes slash clips isolées

function createClipCommandHandlers(deps) {
    const {
        client,
        backfillClipForum,
        getBackfillStatus,
    } = deps;

    async function handleClipsBackfill(interaction) {
        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply('Scan historique des clips lance. Utilise `/clips-backfill-status` pour suivre l avancement.');

        backfillClipForum(client)
            .then(summary => {
                console.log(`[clips] backfill slash termine: threads=${summary.threadsScanned || 0} messages=${summary.messagesScanned || 0} uploads=${summary.filesUploaded || 0} erreurs=${summary.errors || 0}`);
            })
            .catch(error => {
                console.error(`[clips] backfill slash echoue: ${error.message}`);
            });
    }

    async function handleClipsBackfillStatus(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const status = getBackfillStatus();
        const lines = [
            '**Backfill clips**',
            `Etat : ${status.running ? 'en cours' : 'inactif / termine'}`,
            `Threads scannes : ${status.threadsScanned || 0}`,
            `Messages scannes : ${status.messagesScanned || 0}`,
            `Liens trouves : ${status.linksFound || 0}`,
            `Fichiers uploades : ${status.filesUploaded || 0}`,
            `Doublons ignores : ${status.duplicatesIgnored || 0}`,
            `Erreurs : ${status.errors || 0}`,
        ];
        if (status.startedAt) lines.push(`Demarre : ${status.startedAt}`);
        if (status.completedAt) lines.push(`Termine : ${status.completedAt}`);
        if (status.error) lines.push(`Derniere erreur : ${status.error}`);
        return interaction.editReply(lines.join('\n'));
    }

    return {
        handleClipsBackfill,
        handleClipsBackfillStatus,
    };
}

module.exports = {
    createClipCommandHandlers,
};
