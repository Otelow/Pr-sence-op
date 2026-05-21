// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes pages dashboard isolées
const path = require('path');

function registerPageRoutes(app, { publicDir, privateDir, isUserAdmin }) {
    app.get('/', (req, res) => {
        if (req.session.user) return res.redirect('/dashboard#presence');
        res.sendFile(path.join(publicDir, 'index.html'));
    });

    app.get('/dashboard', (req, res) => {
        if (!req.session.user) return res.redirect('/');
        res.sendFile(path.join(privateDir, 'dashboard.html'));
    });

    app.get('/admin', (req, res) => {
        if (!req.session.user) return res.redirect('/');
        if (!isUserAdmin(req.session.user)) return res.redirect('/dashboard');
        res.sendFile(path.join(privateDir, 'admin.html'));
    });
}

module.exports = { registerPageRoutes };
