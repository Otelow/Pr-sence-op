// MODIFIE CHANTIER 6 - 14/05/2026 - persistance suivi absences externalisee

function createAbsenceTrackingPersistence(deps) {
    const {
        fs,
        trackingFile,
        loadState,
        saveState,
        emitRealtime,
        getAbsenceTracking,
    } = deps;

    function loadAbsenceTracking() {
        try {
            const persisted = loadState('absence_tracking', null);
            if (persisted && typeof persisted === 'object') return new Map(Object.entries(persisted));
            if (fs.existsSync(trackingFile)) {
                const data = JSON.parse(fs.readFileSync(trackingFile, 'utf8'));
                saveState('absence_tracking', data);
                return new Map(Object.entries(data));
            }
        } catch (e) {
            console.error('❌ Erreur chargement suivi absences:', e);
        }
        return new Map();
    }

    function saveAbsenceTracking() {
        try {
            const absenceTracking = getAbsenceTracking();
            const data = {};
            for (const [key, value] of absenceTracking) {
                data[key] = value;
            }
            fs.writeFileSync(trackingFile, JSON.stringify(data, null, 2));
            saveState('absence_tracking', data);
            emitRealtime('absence:posted', { total: absenceTracking.size });
        } catch (e) {
            console.error('❌ Erreur sauvegarde suivi absences:', e);
        }
    }

    return {
        loadAbsenceTracking,
        saveAbsenceTracking,
    };
}

module.exports = {
    createAbsenceTrackingPersistence,
};
