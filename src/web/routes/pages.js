// MODIFIÉ CHANTIER 6 — 14/05/2026 — routes pages dashboard isolées
const path = require('path');

function registerPageRoutes(app, { publicDir, privateDir, isUserAdmin }) {
    function sendPrivatePage(res, filePath) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.sendFile(filePath);
    }

    app.get('/', (req, res) => {
        if (req.session.user) return res.redirect('/dashboard#presence');
        res.sendFile(path.join(publicDir, 'index.html'));
    });

    app.get('/dashboard', (req, res) => {
        if (!req.session.user) return res.redirect('/');
        return sendPrivatePage(res, path.join(privateDir, 'dashboard.html'));
    });

    app.get('/admin', (req, res) => {
        if (!req.session.user) return res.redirect('/');
        if (!isUserAdmin(req.session.user)) return res.redirect('/dashboard');
        return sendPrivatePage(res, path.join(privateDir, 'admin.html'));
    });
}

module.exports = { registerPageRoutes };
