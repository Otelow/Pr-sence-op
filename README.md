# 21 Block Savage — Bot + Dashboard Web

## 📦 Structure

```
.
├── index.js              # Point d'entrée (lance bot + serveur web)
├── bot.js                # Bot Discord
├── server.js             # Serveur Express + OAuth2 + API
├── package.json
├── .env.example          # Variables d'environnement (à copier en .env en local)
└── public/
    ├── index.html        # Page de login
    ├── dashboard.html    # Dashboard principal
    ├── style.css         # Styles
    └── app.js            # JavaScript frontend
```

## 🚀 Déploiement Railway

### 1. Setup OAuth2 Discord

1. Va sur https://discord.com/developers/applications
2. Sélectionne ton bot "21 Block Savage"
3. Dans **OAuth2 → General** :
   - Note ton **Client ID**
   - Génère un **Client Secret** et copie-le
   - Dans **Redirects**, ajoute : `https://TON-DOMAINE-RAILWAY.up.railway.app/auth/callback`

### 2. Variables d'environnement Railway

Dans ton service Railway → **Variables**, ajoute :

```
DISCORD_TOKEN=ton-token
GUILD_ID=1485254310894895282
DISCORD_CLIENT_ID=ton-client-id
DISCORD_CLIENT_SECRET=ton-client-secret
DISCORD_REDIRECT_URI=https://TON-DOMAINE-RAILWAY.up.railway.app/auth/callback
SESSION_SECRET=quelque-chose-de-tres-long-et-aleatoire-genre-50-caracteres
```

### 3. Domaine public Railway

Dans **Settings → Networking** → **Generate Domain** pour avoir ton URL publique.

### 4. Push

Pousse tous les fichiers sur GitHub. Railway redéploie automatiquement.

## 🎯 Accès

- Va sur ton domaine Railway
- Clique sur "CONNEXION DISCORD"
- Autorise l'app
- Si tu as un rôle dans `COMMAND_ROLES`, tu accèdes au dashboard

## 🔒 Sécurité

- **Login Discord OAuth2 obligatoire**
- **Vérification de membre du serveur**
- **Vérification de rôle** (mêmes rôles que pour les commandes slash)
- Sessions de 7 jours

## 📋 Fonctionnalités

### Onglet Présence
- Vue temps réel des 1ère et 2ème OP
- Catégories : Présents / Retards / Absents (justifié + non) / Pas réagi
- Liste des absences posées dans le salon
- Stats globales en haut

### Onglet Commandes
- Toutes les alertes terrain (QG, défense, garage, etc.)
- Radio aléatoire
- Lancer 1ère / 2ème présence OP

### Onglet Statistiques
- Suivi hebdomadaire des absences
- Section dédiée aux alertes KP (2+ jours consécutifs)
- Détail jour par jour

### Onglet Sanctions
- Historique des derniers avertissements

## 🔄 Refresh

- Auto toutes les 15 secondes
- Manuel avec le bouton ↻ en haut à droite
