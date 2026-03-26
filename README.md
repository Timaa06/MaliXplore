# MaliXplore

Plateforme web de découverte culturelle du Mali, dotée d'un système d'authentification multi-facteurs (MFA) à trois étapes : mot de passe, code OTP par email, et schéma de déverrouillage. L'application comprend un back office d'administration pour la supervision des événements de connexion.

---

## Prérequis

Les outils suivants doivent être installés sur la machine avant de démarrer le projet.

**Option A — Démarrage local (sans Docker)**

- [Node.js](https://nodejs.org/) version 18 ou supérieure
- [npm](https://www.npmjs.com/) version 9 ou supérieure (inclus avec Node.js)
- [MySQL](https://dev.mysql.com/downloads/mysql/) version 8.0 ou supérieure
- Un compte Gmail avec un [mot de passe d'application](https://myaccount.google.com/apppasswords) activé (authentification à deux facteurs requise sur le compte Google)

**Option B — Démarrage via Docker**

- [Docker](https://docs.docker.com/get-docker/) version 24 ou supérieure
- [Docker Compose](https://docs.docker.com/compose/) version 2.20 ou supérieure
- Un compte Gmail avec un mot de passe d'application (même exigence que ci-dessus)

---

## Structure du projet

```
Ba Maliba/
├── backend/
│   ├── server.js          # Serveur Express — routes et logique métier
│   ├── database.js        # Connexion MySQL et initialisation des tables
│   └── .env               # Variables d'environnement (non versionné)
├── frontend/
│   ├── index.html         # Page d'accueil / connexion
│   ├── inscription.html   # Formulaire d'inscription en 3 étapes
│   ├── otp.html           # Saisie du code OTP (étape 2 de connexion)
│   ├── secret.html        # Schéma de déverrouillage (étape 3 de connexion)
│   ├── accueil.html       # Page principale (accès authentifié)
│   ├── mali.html          # Contenu culturel (accès authentifié)
│   ├── admin.html         # Back office d'administration
│   └── css/
│       └── style.css      # Feuille de style globale
├── package.json
├── docker-compose.yml
└── README.md
```

---

## Installation

### Option A — Démarrage local

**1. Cloner le dépôt**

```bash
git clone <url-du-depot>
cd "Ba Maliba"
```

**2. Installer les dépendances Node.js**

```bash
npm install
```

**3. Créer la base de données MySQL**

Connectez-vous à votre instance MySQL et exécutez :

```sql
CREATE DATABASE malixplore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Les tables sont créées automatiquement au démarrage du serveur (migrations incluses).

**4. Configurer les variables d'environnement**

Créez le fichier `backend/.env` en vous basant sur le modèle ci-dessous (voir section Configuration).

**5. Démarrer le serveur**

```bash
npm start
```

Le serveur démarre sur `http://localhost:3000` par défaut.

---

### Option B — Démarrage via Docker Compose

**1. Cloner le dépôt**

```bash
git clone <url-du-depot>
cd "Ba Maliba"
```

**2. Configurer les variables d'environnement**

Créez le fichier `backend/.env` (voir section Configuration). La variable `DB_HOST` doit valoir `db` lorsque Docker Compose est utilisé.

**3. Lancer la stack complète**

```bash
docker compose up --build
```

L'application est accessible sur `http://localhost:3000`. MySQL démarre en interne et les tables sont créées automatiquement.

Pour arrêter :

```bash
docker compose down
```

Pour supprimer également les données persistées :

```bash
docker compose down -v
```

---

## Configuration

Créez le fichier `backend/.env` avec le contenu suivant. Ce fichier ne doit jamais être versionné.

```env
# Serveur
PORT=3000
SESSION_SECRET=remplacez_par_une_chaine_aleatoire_longue

# Base de données MySQL
DB_HOST=localhost       # Remplacer par "db" si Docker Compose est utilisé
DB_PORT=3306
DB_USER=root
DB_PASSWORD=votre_mot_de_passe_mysql
DB_NAME=malixplore

# Email (Gmail SMTP)
# Utiliser un mot de passe d'application Google, pas le mot de passe du compte
EMAIL_USER=votre.adresse@gmail.com
EMAIL_PASS=xxxx_xxxx_xxxx_xxxx

# Back office admin
ADMIN_USER=admin
ADMIN_PASS=votre_mot_de_passe_admin
```

**Obtenir un mot de passe d'application Google :**

1. Activer la validation en deux étapes sur le compte Google concerné.
2. Aller dans Compte Google > Securite > Mots de passe des applications.
3. Creer une application nommee "MaliXplore" et copier le mot de passe de 16 caracteres genere.
4. Saisir ce mot de passe dans la variable `EMAIL_PASS`.

---

## Fonctionnement de l'authentification

La connexion est decoupee en trois etapes sequentielles :

| Etape | Page | Mecanique |
|-------|------|-----------|
| 1 | `index.html` | Nom d'utilisateur + mot de passe (verifie par bcrypt) |
| 2 | `otp.html` | Code OTP a 6 chiffres envoye par email (valide 10 minutes) |
| 3 | `secret.html` | Schema de deverrouillage dessiné sur une grille 3x3 (minimum 4 points, verifie par bcrypt) |

L'inscription suit egalement trois etapes : verification de l'email par OTP, puis creation du compte avec nom, mot de passe et schema secret.

---

## Back Office d'administration

Accessible sur `/admin.html`, le back office necessite des identifiants distincts des comptes utilisateurs (definis dans `.env` via `ADMIN_USER` et `ADMIN_PASS`).

Fonctionnalites disponibles :

- Tableau de bord avec compteurs journaliers (connexions, echecs, OTP envoyes, inscriptions, deconnexions)
- Journal complet des evenements avec filtres par type, nom d'utilisateur, et plage de dates
- Pagination des resultats (50 entrees par page par defaut)
- Actualisation automatique toutes les 30 secondes

Types d'evenements enregistres : `connexion_succes_etape1`, `connexion_echec`, `connexion_complete`, `otp_envoye`, `otp_echec`, `otp_succes`, `otp_renvoye`, `schema_echec`, `deconnexion`, `inscription_succes`, `inscription_echec`, `inscription_otp_envoye`, `inscription_otp_echec`, `inscription_otp_succes`.

---

## Tests

Le projet ne dispose pas encore de suite de tests automatises. Les procedures de validation ci-dessous permettent de verifier le bon fonctionnement de chaque composant.

### Verification de la connexion a la base de donnees

Demarrer le serveur et observer les logs de la console :

```
Base de données initialisée — table users prête
MaliXplore démarré sur http://localhost:3000
```

Toute erreur de connexion MySQL apparait dans la console et bloque le demarrage.

### Verification de l'envoi d'email

1. Creer un compte depuis `/inscription.html`.
2. Verifier la reception du code OTP dans la boite email renseignee.
3. Saisir le code pour valider l'etape 2 de l'inscription.

En cas d'erreur SMTP, le serveur renvoie `"Impossible d'envoyer l'email"` et une entree `inscription_echec` est ajoutee dans les logs.

### Verification du flux MFA complet

| Action | Resultat attendu |
|--------|-----------------|
| Connexion avec mauvais mot de passe | Message d'erreur, evenement `connexion_echec` logue |
| Connexion valide (etape 1) | Redirection vers `/otp.html`, email OTP recu |
| OTP incorrect ou expire | Message d'erreur, evenement `otp_echec` logue |
| OTP correct | Redirection vers `/secret.html` |
| Schema incorrect | Message d'erreur, evenement `schema_echec` logue |
| Schema correct | Redirection vers `/accueil.html`, evenement `connexion_complete` logue |
| Acces direct a `/accueil.html` sans authentification | Redirection vers `/index.html` |

### Verification du back office

1. Acceder a `/admin.html`.
2. Se connecter avec les identifiants `ADMIN_USER` / `ADMIN_PASS` definis dans `.env`.
3. Verifier que les statistiques et les logs correspondent aux actions effectuees.

---

## Variables d'environnement — recapitulatif

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `PORT` | Non | Port d'ecoute du serveur (defaut : 3000) |
| `SESSION_SECRET` | Oui | Cle secrete pour les sessions Express |
| `DB_HOST` | Oui | Hote MySQL (`localhost` ou `db` sous Docker) |
| `DB_PORT` | Non | Port MySQL (defaut : 3306) |
| `DB_USER` | Oui | Utilisateur MySQL |
| `DB_PASSWORD` | Oui | Mot de passe MySQL |
| `DB_NAME` | Oui | Nom de la base de donnees (defaut : `malixplore`) |
| `EMAIL_USER` | Oui | Adresse Gmail pour l'envoi des OTP |
| `EMAIL_PASS` | Oui | Mot de passe d'application Google (16 caracteres) |
| `ADMIN_USER` | Oui | Identifiant du compte administrateur |
| `ADMIN_PASS` | Oui | Mot de passe du compte administrateur |

---

## Dependances principales

| Paquet | Version | Role |
|--------|---------|------|
| express | ^4.18.2 | Serveur HTTP et routage |
| express-session | ^1.18.0 | Gestion des sessions utilisateur |
| mysql2 | ^3.9.7 | Client MySQL avec support des promesses |
| bcrypt | ^5.1.1 | Hachage des mots de passe et schemas secrets |
| nodemailer | ^6.10.1 | Envoi des emails OTP via Gmail SMTP |
| dotenv | ^16.4.5 | Chargement des variables d'environnement |
| cors | ^2.8.5 | Gestion des en-tetes CORS |

---

## Securite

- Les mots de passe et schemas secrets sont haches avec bcrypt (10 rounds).
- Les sessions expirent apres 30 minutes d'inactivite.
- Les pages protegees (`/otp.html`, `/secret.html`, `/accueil.html`, `/mali.html`) sont servies cote serveur uniquement apres verification de l'etape MFA correspondante.
- Le fichier `.env` est exclu du versionnement (ajouter `.env` au `.gitignore`).
- Les codes OTP expirent apres 10 minutes.

---

## Licence

Projet universitaire — MaliXplore, 2026.
