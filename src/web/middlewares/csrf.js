// SECURITY HARDENING 28/05/2026 - CSRF session token
const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ensureCsrfToken(req) {
    if (!req.session) return null;
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
}

function attachCsrfToken(req, res, next) {
    ensureCsrfToken(req);
    next();
}

function requireCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const expected = req.session?.csrfToken;
    const provided = req.get('x-csrf-token');
    if (!expected || !provided || provided !== expected) {
        return res.status(403).json({ error: 'CSRF token invalide' });
    }

    next();
}

module.exports = {
    SAFE_METHODS,
    ensureCsrfToken,
    attachCsrfToken,
    requireCsrf,
};
