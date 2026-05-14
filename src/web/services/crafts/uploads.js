// MODIFIE CHANTIER 6 - 14/05/2026 - upload images craft extrait de crafts.js

const path = require('path');
const multer = require('multer');

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
            const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
            const ext = path.extname(file.originalname).toLowerCase();
            if (allowed.includes(ext)) cb(null, true);
            else cb(new Error('Format non supporté'));
        },
    });
}

module.exports = {
    createCraftUploadMiddleware,
};
