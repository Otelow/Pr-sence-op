// MODIFIE CHANTIER 6 - 14/05/2026 - upload images craft extrait de crafts.js

const path = require('path');
const multer = require('multer');

const ALLOWED_IMAGES = new Map([
    ['.jpg', new Set(['image/jpeg'])],
    ['.jpeg', new Set(['image/jpeg'])],
    ['.png', new Set(['image/png'])],
    ['.webp', new Set(['image/webp'])],
    ['.gif', new Set(['image/gif'])],
]);

function createCraftUploadMiddleware(uploadsDir) {
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadsDir),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            cb(null, `weapon_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`);
        },
    });

    return multer({
        storage,
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            const allowedMimes = ALLOWED_IMAGES.get(ext);
            if (!allowedMimes) return cb(new Error('Format non supporté'));
            if (!allowedMimes.has(String(file.mimetype || '').toLowerCase())) {
                return cb(new Error('Type MIME incohérent'));
            }
            return cb(null, true);
        },
    });
}

module.exports = {
    createCraftUploadMiddleware,
};
