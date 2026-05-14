// MODIFIE CHANTIER 6 - 14/05/2026 - events membres Discord externalises

function registerGuildMemberEvents(client, deps) {
    const {
        CONFIG,
        hasProtectedRole,
        startWelcomeFlow,
    } = deps;

    client.on('guildMemberAdd', async (member) => {
        if (member.user.bot) return;

        // Auto-attribution de rôles spécifiques (pour des utilisateurs précis listés dans AUTO_ROLE_USERS)
        const autoRoleId = CONFIG.AUTO_ROLE_USERS[member.id];
        if (autoRoleId) {
            try {
                const role = member.guild.roles.cache.get(autoRoleId);
                if (role) {
                    await member.roles.add(role);
                    console.log(`🎯 Auto-rôle attribué à ${member.user.tag} : ${role.name}`);
                }
            } catch (e) {
                console.error(`❌ Erreur auto-rôle ${member.user.tag}:`, e.message);
            }
            return;
        }

        // VIP → rôle direct
        if (CONFIG.VIP_USERS.includes(member.id)) {
            try {
                const role = member.guild.roles.cache.get(CONFIG.ROLES.VIP_ROLE);
                if (role) await member.roles.add(role);
            } catch {}
            return;
        }

        if (hasProtectedRole(member)) {
            console.log(`ROLE PROTEGE: ${member.user.tag} a rejoint - accueil ignore`);
            return;
        }

        console.log(`WELCOME: ${member.user.tag} a rejoint - lancement de la procedure d'accueil`);
        await startWelcomeFlow(member);
    });
}

module.exports = {
    registerGuildMemberEvents,
};
