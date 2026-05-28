<!-- NETTOYAGE 18/05/2026 — petits ajustements -->
# 21 Block Savage — Bot Discord + Dashboard Web

Dashboard web et bot Discord pour le serveur RP GTA 5 français 21 Block Savage, déployé sur Railway via GitHub.

## Stack

Node 24, Discord.js v14, Express 4, better-sqlite3, Socket.IO, Pino, Helmet, multer 2, Supabase Storage (clips + backups).

## Architecture

- `src/bot/` : code Discord (`commands`, `events`, `services`, `utils`)
- `src/web/` : serveur web (`routes`, `services`, `middlewares`)
- `src/shared/` : modules communs (`config`, `logger`, `database`, `auditLog`, Supabase, etc.)
- `public/` : assets publics (JS/CSS/images/login)
- `private/` : pages HTML servies uniquement via routes authentifiées (`/dashboard`, `/admin`)
- `scripts/` : utilitaires CLI (`smoke-test`, `convert-assets`)
- `data/` : SQLite DBs + backups (volume Railway)

## Architecture des permissions

Les rôles d'accès sont centralisés dans `src/shared/permissions.js`.

- `FULL_ACCESS_ROLES` : hauts gradés, accès complet au dashboard et aux fonctions sensibles.
- `LIMITED_CRAFT_ACCESS_ROLES` : accès limité aux onglets Crafts + Vos Armes.
- `MAP_VIEW_ROLES` : accès lecture seule à la carte. Les points sensibles de type `weapon-lab` restent filtrés côté backend selon les règles dédiées.

## Démarrage local

```bash
npm install
cp .env.example .env
npm start
```

Remplis les valeurs Discord et session dans `.env` avant de démarrer.
En CI/prod, utilise `npm ci` pour reconstruire `node_modules` sur la plateforme cible.

## Variables d'environnement requises

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `SESSION_SECRET`
- `DISCORD_REDIRECT_URI`

## Variables optionnelles

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_BACKUP_BUCKET`
- `ERROR_WEBHOOK_URL`
- `LOG_LEVEL`

## Scripts

- `npm start` : démarrer le bot Discord + le serveur web
- `npm run syntax` : vérifier la syntaxe JS avec `node --check`
- `npm test` : lancer les tests Node intégrés
- `npm run audit:high` : audit npm production niveau high
- `npm run smoke:remote -- <url>` : smoke test contre une instance déjà démarrée (Railway ou serveur local lancé à part)
- `npm run smoke -- <url>` : alias explicite de `smoke:remote`, échoue volontairement si aucune URL n’est fournie
- `npm run convert-assets` : générer les `.webp` depuis les images sources

## Déploiement

Push sur `main` → Railway redéploie automatiquement.

Déploiement propre :

- Déployer depuis GitHub/Railway, pas depuis un ZIP brut du dossier local.
- Ne jamais envoyer `node_modules`, `.git`, `.env`, `data/*.db`, `data/*.db-shm`, `data/*.db-wal`.
- Si une archive est nécessaire, utiliser `git archive` depuis un commit propre.
- Pour générer une archive propre localement : `npm run package:clean`.
- Laisser Railway exécuter `npm ci` afin de compiler `better-sqlite3` pour Linux et éviter les erreurs `invalid ELF header`.

- Healthcheck : `/healthz`
- Monitoring admin : `/admin` onglet `Monitoring`
- Historique actions : `/admin` onglet `Historique`

## Fonctionnalités majeures

- Présence OP avec rappels cron + panneau live
- Suivi absences (panneau + alertes)
- Crafts d'armes (catalogue + demandes + workflow validation)
- Suivi commandes/avances (Titane/Chrome/Tungstène + remboursements + édition live message Discord)
- Sanctions
- Carte interactive (Los Santos GTA 5)
- Audit log complet
- Monitoring runtime
- Backups locaux quotidiens + backups Supabase hebdomadaires si configurés

## Notes prod

- Le volume Railway `/data` doit rester persistant pour `crafts.db`, sessions SQLite, états bot et backups.
- `SESSION_SECRET` est obligatoire en production.
- Les assets WebP sont générés depuis les sources PNG/JPG et gardent les fichiers originaux en fallback.
