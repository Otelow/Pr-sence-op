// MODIFIE CHANTIER 6 - 14/05/2026 - persistance welcome externalisee

function createWelcomeStatePersistence(deps) {
    const {
        fs,
        welcomeStateFile,
        welcomeState,
        loadState,
        saveState,
    } = deps;

    function saveWelcomeState() {
        try {
            const data = {};
            for (const [userId, state] of welcomeState) {
                data[userId] = {
                    step: state.step,
                    messageId: state.messageId,
                    guildId: state.guildId,
                    createdAt: state.createdAt || Date.now(),
                };
            }
            fs.writeFileSync(welcomeStateFile, JSON.stringify(data, null, 2));
            saveState('welcome', data);
        } catch (e) {
            console.error('❌ Erreur sauvegarde welcome:', e.message);
        }
    }

    function loadWelcomeStateData() {
        try {
            const persisted = loadState('welcome', null);
            if (persisted && typeof persisted === 'object') return persisted;
            if (fs.existsSync(welcomeStateFile)) {
                const data = JSON.parse(fs.readFileSync(welcomeStateFile, 'utf8'));
                saveState('welcome', data);
                return data;
            }
        } catch (e) {
            console.error('❌ Erreur chargement welcome:', e.message);
        }
        return {};
    }

    function deleteWelcomeState(userId) {
        welcomeState.delete(userId);
        saveWelcomeState();
    }

    return {
        saveWelcomeState,
        loadWelcomeStateData,
        deleteWelcomeState,
    };
}

module.exports = {
    createWelcomeStatePersistence,
};
