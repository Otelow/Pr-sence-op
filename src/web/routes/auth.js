// FINAL D1 16/05/2026 — fallback picture WebP blackmarket
// MODIFIE CHANTIER 6 - 14/05/2026 - routes OAuth Discord externalisees

function registerAuthRoutes(app, deps) {
    const {
        authLimiter,
        axios,
        DISCORD_CLIENT_ID,
        DISCORD_CLIENT_SECRET,
        DISCORD_REDIRECT_URI,
        getBotClient,
        getBotState,
    } = deps;

    app.use('/auth', authLimiter);

    app.get('/auth/login', (req, res) => {
        const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
        res.redirect(url);
    });

    app.get('/auth/callback', async (req, res) => {
        const code = req.query.code;
        if (!code) return res.redirect('/');

        const errorPage = (msg, opts = {}) => {
            const title = opts.title || 'ACCÈS REFUSÉ';
            const subtitle = opts.subtitle || 'PASSERELLE BLOQUÉE';
            const image = opts.image || null;
            return `
<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Accès refusé — 21 Block Savage</title>
<link rel="stylesheet" href="/style.css">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
body.login-body { overflow: hidden; }
.darknet-denial {
    width: min(92vw, 760px);
    min-height: 620px;
    margin: 7vh auto;
    padding: 34px;
    border: 1px solid rgba(255, 138, 0, .32);
    background:
        radial-gradient(circle at 50% 0%, rgba(255, 138, 0, .22), transparent 42%),
        linear-gradient(180deg, rgba(19, 15, 10, .96), rgba(3, 3, 3, .98));
    box-shadow: 0 0 80px rgba(255, 138, 0, .16), inset 0 1px 0 rgba(255,255,255,.08);
}
.denial-scan {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: 1px solid rgba(255, 138, 0, .28);
    color: #ffb84d;
    background: rgba(255, 138, 0, .08);
    font: 700 12px/1 "JetBrains Mono", monospace;
    letter-spacing: .18em;
}
.denial-art {
    width: min(340px, 66vw);
    aspect-ratio: 1;
    display: block;
    margin: 26px auto 22px;
    object-fit: cover;
    border-radius: 28px;
    border: 1px solid rgba(255, 184, 77, .25);
    box-shadow: 0 22px 70px rgba(255, 138, 0, .22);
}
.denial-title {
    position: relative;
    margin: 0;
    color: #fff3d6;
    font-family: "Bebas Neue", sans-serif;
    font-size: clamp(54px, 10vw, 96px);
    line-height: .9;
    text-align: center;
    letter-spacing: 0;
    text-shadow: 0 0 28px rgba(255, 138, 0, .42);
    animation: deniedShake .22s infinite steps(2, end);
}
.denial-subtitle {
    margin: 12px 0 0;
    color: #ff8a00;
    font: 700 13px/1.5 "JetBrains Mono", monospace;
    text-align: center;
    letter-spacing: .2em;
}
.denial-message {
    margin: 28px auto 0;
    max-width: 540px;
    padding: 20px 22px;
    border-left: 4px solid #ff8a00;
    color: #f8f0df;
    background: rgba(0, 0, 0, .62);
    font: 500 18px/1.65 "JetBrains Mono", monospace;
}
.btn-back.denial-back {
    display: flex;
    width: fit-content;
    margin: 28px auto 0;
}
@keyframes deniedShake {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(2px, -1px); }
}
</style>
</head>
<body class="login-body">
<div class="grain"></div>
<div class="darknet-denial">
    <div class="denial-scan">ACCÈS BLOQUÉ</div>
    ${image === '/blackmarket-denied.png'
        ? '<picture><source srcset="/blackmarket-denied.webp" type="image/webp"><img class="denial-art" src="/blackmarket-denied.png" alt=""></picture>'
        : (image ? `<img class="denial-art" src="${image}" alt="">` : '<div class="error-icon">⚠</div>')}
    <h1 class="denial-title">${title}</h1>
    <p class="denial-subtitle">${subtitle}</p>
    <p class="denial-message">${msg}</p>
    <a href="/" class="btn-back denial-back">← Retour</a>
    </div>
</body></html>`;
        };

        try {
            const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
                new URLSearchParams({
                    client_id: DISCORD_CLIENT_ID,
                    client_secret: DISCORD_CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: DISCORD_REDIRECT_URI,
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const userRes = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
            });

            const user = userRes.data;
            const state = getBotState();
            const guild = getBotClient().guilds.cache.get(state.CONFIG.GUILD_ID);
            if (!guild) return res.send(errorPage('Bot non connecté au serveur Discord'));

            const member = await guild.members.fetch(user.id).catch(() => null);
            if (!member) return res.send(errorPage('Tu n\'es pas membre du serveur Discord 21 Block Savage'));

            const blackMarketRole = state.CONFIG.ROLES.VIP_ROLE || '1489336767097208922';
            if (member.roles.cache.has(blackMarketRole)) {
                return res.send(errorPage(
                    'Le BlackMarket n\'a pas les autorisations d\'accès sur le Darknet des 21BS.',
                    {
                        title: 'BLACKMARKET',
                        subtitle: 'ACCÈS DARKNET BLOQUÉ',
                        image: '/blackmarket-denied.png',
                    }
                ));
            }

            req.session.user = {
                id: user.id,
                username: member.nickname || user.username,
                avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
                roles: [...member.roles.cache.keys()],
            };

            res.redirect('/dashboard#presence');
        } catch (e) {
            console.error('❌ OAuth erreur:', e.message);
            res.send(errorPage('Erreur de connexion. Réessaie.'));
        }
    });

    app.get('/auth/logout', (req, res) => {
        const isTimeout = req.query.timeout === '1';
        req.session.destroy(() => {
            res.redirect(isTimeout ? '/?timeout=1' : '/?logout=1');
        });
    });


}

module.exports = {
    registerAuthRoutes,
};
