// FINAL D1 16/05/2026 — conversion WebP des assets lourds
const sharp = require('sharp');
const fs = require('fs');

const targets = [
    { src: 'public/logo.png', dest: 'public/logo.webp', q: 85 },
    { src: 'public/map-optimized.jpg', dest: 'public/map-optimized.webp', q: 80 },
    { src: 'public/blackmarket-denied.png', dest: 'public/blackmarket-denied.webp', q: 85 },
];

(async () => {
    for (const t of targets) {
        if (!fs.existsSync(t.src)) {
            console.log(`⚠️ skip ${t.src}`);
            continue;
        }
        await sharp(t.src).webp({ quality: t.q }).toFile(t.dest);
        const b = fs.statSync(t.src).size;
        const a = fs.statSync(t.dest).size;
        console.log(`✅ ${t.dest} : ${(b / 1024 / 1024).toFixed(1)}MB → ${(a / 1024 / 1024).toFixed(1)}MB`);
    }
})();
