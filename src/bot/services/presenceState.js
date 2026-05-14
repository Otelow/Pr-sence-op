// MODIFIE CHANTIER 6 - 14/05/2026 - persistance presence OP externalisee

function createPresenceStatePersistence(deps) {
    const {
        fs,
        stateFile,
        getPresenceData,
        getPresence2Data,
    } = deps;

    function savePresenceState() {
        try {
            const presenceData = getPresenceData();
            const presence2Data = getPresence2Data();
            const state = {
                op1: { messageId: presenceData.messageId, active: presenceData.active },
                op2: { messageId: presence2Data.messageId, active: presence2Data.active },
                savedAt: new Date().toISOString(),
            };
            fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
        } catch (e) {
            console.error('❌ Erreur sauvegarde état présence:', e.message);
        }
    }

    function loadPresenceState() {
        try {
            if (fs.existsSync(stateFile)) {
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                console.log(`📋 État présence chargé (sauvé à ${state.savedAt})`);
                return state;
            }
        } catch (e) {
            console.error('❌ Erreur chargement état présence:', e.message);
        }
        return null;
    }

    function clearPresenceState() {
        try {
            if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
        } catch {}
    }

    return {
        savePresenceState,
        loadPresenceState,
        clearPresenceState,
    };
}

module.exports = {
    createPresenceStatePersistence,
};
