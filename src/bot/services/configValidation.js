// AUDIT HARDENING 21/05/2026 - validation lisible des IDs Discord critiques
function collectRoleIds(rolesConfig = {}) {
    const ids = [];
    for (const value of Object.values(rolesConfig)) {
        if (Array.isArray(value)) ids.push(...value);
        else if (typeof value === 'string') ids.push(value);
    }
    return [...new Set(ids.filter(Boolean))];
}

function validateDiscordConfig(client, config, log) {
    const missing = [];
    const guild = client.guilds.cache.get(config.GUILD_ID);
    if (!guild) {
        log.error(`Configuration Discord invalide : serveur ${config.GUILD_ID || '(vide)'} introuvable`);
        return false;
    }

    for (const [name, channelId] of Object.entries(config.CHANNELS || {})) {
        if (!channelId) missing.push(`salon ${name}: ID vide`);
        else if (!guild.channels.cache.has(channelId)) missing.push(`salon ${name}: ${channelId} introuvable`);
    }

    for (const roleId of collectRoleIds(config.ROLES)) {
        if (!guild.roles.cache.has(roleId)) missing.push(`rôle ${roleId} introuvable`);
    }

    for (const [userId, roleId] of Object.entries(config.AUTO_ROLE_USERS || {})) {
        if (!guild.roles.cache.has(roleId)) missing.push(`auto-role ${userId}: rôle ${roleId} introuvable`);
    }

    if (missing.length) {
        log.warn({ missing }, `Configuration Discord à vérifier : ${missing.length} ID(s) introuvable(s)`);
        return false;
    }

    log.info('Configuration Discord validée : salons/rôles critiques trouvés');
    return true;
}

module.exports = {
    validateDiscordConfig,
};
