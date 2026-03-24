// ============================================================
// server.js — Serveur Express principal de MaliXplore
// ============================================================

require('dotenv').config({ path: __dirname + '/.env' });

const express        = require('express');
const session        = require('express-session');
const bcrypt         = require('bcrypt');
const cors           = require('cors');
const path           = require('path');
const { pool, initialiserBaseDeDonnees } = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Nombre de tours pour le hashage bcrypt ──────────────────
const SALT_ROUNDS = 10;

// ============================================================
// MIDDLEWARES GLOBAUX
// ============================================================

// Autoriser les requêtes cross-origin (utile en développement)
app.use(cors());

// Parser le corps des requêtes en JSON et en form-data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Gestion des sessions utilisateur
app.use(session({
  secret           : process.env.SESSION_SECRET || 'malixplore_secret',
  resave           : false,
  saveUninitialized: false,
  cookie           : {
    httpOnly: true,   // Inaccessible depuis JavaScript côté client
    maxAge  : 30 * 60 * 1000  // Session de 30 minutes
  }
}));

// Servir les fichiers statiques du dossier frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// ============================================================
// MIDDLEWARE DE PROTECTION — vérifie l'état MFA de la session
// ============================================================

/**
 * checkAuth(etape) — Middleware de vérification d'authentification
 * etape : 'step1' | 'step2' | 'authenticated'
 * Redirige vers la bonne page si la session est invalide
 */
function checkAuth(etape) {
  return (req, res, next) => {
    if (etape === 'step1' && !req.session.step1) {
      return res.redirect('/index.html');
    }
    if (etape === 'step2' && (!req.session.step1 || !req.session.step2)) {
      return res.redirect('/index.html');
    }
    if (etape === 'authenticated' && !req.session.authenticated) {
      return res.redirect('/index.html');
    }
    next();
  };
}

// ============================================================
// ROUTES D'AUTHENTIFICATION
// ============================================================

// ── Inscription ─────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { nom, mot_de_passe, confirmer_mot_de_passe, otp_code, question_secrete, reponse_secrete } = req.body;

  try {
    // Vérifier que tous les champs sont remplis
    if (!nom || !mot_de_passe || !confirmer_mot_de_passe || !otp_code || !question_secrete || !reponse_secrete) {
      return res.status(400).json({ erreur: 'Tous les champs sont obligatoires' });
    }

    // Vérifier que les mots de passe correspondent
    if (mot_de_passe !== confirmer_mot_de_passe) {
      return res.status(400).json({ erreur: 'Les mots de passe ne correspondent pas' });
    }

    // Vérifier que le code OTP fait exactement 6 chiffres
    const regexOTP = /^\d{6}$/;
    if (!regexOTP.test(String(otp_code))) {
      return res.status(400).json({ erreur: 'Le code OTP doit contenir exactement 6 chiffres' });
    }

    // Vérifier que le nom d'utilisateur n'est pas déjà utilisé
    const [utilisateursExistants] = await pool.query(
      'SELECT id FROM users WHERE nom = ?',
      [nom]
    );
    if (utilisateursExistants.length > 0) {
      return res.status(409).json({ erreur: 'Nom d\'utilisateur déjà utilisé' });
    }

    // Hasher le mot de passe et la réponse secrète
    const motDePasseHashe    = await bcrypt.hash(mot_de_passe, SALT_ROUNDS);
    const reponseSecreteHashe = await bcrypt.hash(reponse_secrete.trim().toLowerCase(), SALT_ROUNDS);

    // Insérer l'utilisateur en base de données
    await pool.query(
      `INSERT INTO users (nom, mot_de_passe, otp_code, question_secrete, reponse_secrete)
       VALUES (?, ?, ?, ?, ?)`,
      [nom, motDePasseHashe, String(otp_code), question_secrete, reponseSecreteHashe]
    );

    // Rediriger vers la page de connexion avec un message de succès
    return res.status(201).json({ succes: true, message: 'Compte créé avec succès ! Vous pouvez maintenant vous connecter.' });

  } catch (erreur) {
    console.error('Erreur inscription :', erreur);
    return res.status(500).json({ erreur: 'Erreur interne du serveur' });
  }
});

// ── Connexion MFA — Étape 1 : nom + mot de passe ───────────
app.post('/auth/login', async (req, res) => {
  const { nom, mot_de_passe } = req.body;

  try {
    if (!nom || !mot_de_passe) {
      return res.status(400).json({ erreur: 'Nom et mot de passe requis' });
    }

    // Chercher l'utilisateur en BDD
    const [utilisateurs] = await pool.query(
      'SELECT id, nom, mot_de_passe FROM users WHERE nom = ?',
      [nom]
    );

    if (utilisateurs.length === 0) {
      return res.status(401).json({ erreur: 'Nom ou mot de passe incorrect' });
    }

    const utilisateur = utilisateurs[0];

    // Comparer le mot de passe avec le hash bcrypt
    const motDePasseCorrect = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe);
    if (!motDePasseCorrect) {
      return res.status(401).json({ erreur: 'Nom ou mot de passe incorrect' });
    }

    // Étape 1 validée — enregistrer en session
    req.session.userId = utilisateur.id;
    req.session.nom    = utilisateur.nom;
    req.session.step1  = true;

    return res.json({ succes: true, redirect: '/otp.html' });

  } catch (erreur) {
    console.error('Erreur connexion étape 1 :', erreur);
    return res.status(500).json({ erreur: 'Erreur interne du serveur' });
  }
});

// ── Connexion MFA — Étape 2 : code OTP ─────────────────────
app.post('/auth/otp', async (req, res) => {
  // Vérifier que l'étape 1 a bien été validée
  if (!req.session.step1) {
    return res.status(401).json({ erreur: 'Session invalide', redirect: '/index.html' });
  }

  const { otp_code } = req.body;

  try {
    if (!otp_code) {
      return res.status(400).json({ erreur: 'Code OTP requis' });
    }

    // Récupérer le code OTP de l'utilisateur depuis la BDD
    const [utilisateurs] = await pool.query(
      'SELECT otp_code FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (utilisateurs.length === 0) {
      return res.status(401).json({ erreur: 'Session invalide', redirect: '/index.html' });
    }

    const otpEnBDD = utilisateurs[0].otp_code;

    // Comparer le code saisi avec celui en BDD (comparaison en string)
    if (String(otp_code).trim() !== String(otpEnBDD).trim()) {
      return res.status(401).json({ erreur: 'Code OTP incorrect' });
    }

    // Étape 2 validée — enregistrer en session
    req.session.step2 = true;

    return res.json({ succes: true, redirect: '/secret.html' });

  } catch (erreur) {
    console.error('Erreur connexion étape 2 :', erreur);
    return res.status(500).json({ erreur: 'Erreur interne du serveur' });
  }
});

// ── Connexion MFA — Étape 3 : question secrète ─────────────
app.post('/auth/secret', async (req, res) => {
  // Vérifier que les étapes 1 et 2 ont été validées
  if (!req.session.step2) {
    return res.status(401).json({ erreur: 'Session invalide', redirect: '/index.html' });
  }

  const { reponse_secrete } = req.body;

  try {
    if (!reponse_secrete) {
      return res.status(400).json({ erreur: 'Réponse requise' });
    }

    // Récupérer la réponse secrète hashée de l'utilisateur
    const [utilisateurs] = await pool.query(
      'SELECT reponse_secrete FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (utilisateurs.length === 0) {
      return res.status(401).json({ erreur: 'Session invalide', redirect: '/index.html' });
    }

    const reponseHashee = utilisateurs[0].reponse_secrete;

    // Comparer la réponse saisie (normalisée) avec le hash bcrypt
    const reponseCorrecte = await bcrypt.compare(
      reponse_secrete.trim().toLowerCase(),
      reponseHashee
    );

    if (!reponseCorrecte) {
      return res.status(401).json({ erreur: 'Réponse incorrecte' });
    }

    // Authentification complète — session fully authenticated
    req.session.authenticated = true;

    return res.json({ succes: true, redirect: '/accueil.html' });

  } catch (erreur) {
    console.error('Erreur connexion étape 3 :', erreur);
    return res.status(500).json({ erreur: 'Erreur interne du serveur' });
  }
});

// ── Déconnexion ─────────────────────────────────────────────
app.get('/auth/logout', (req, res) => {
  req.session.destroy((erreur) => {
    if (erreur) {
      console.error('Erreur déconnexion :', erreur);
    }
    res.redirect('/index.html');
  });
});

// ============================================================
// ROUTES API
// ============================================================

// ── Récupérer la question secrète d'un utilisateur ─────────
app.get('/api/question/:nom', async (req, res) => {
  const { nom } = req.params;

  try {
    const [utilisateurs] = await pool.query(
      'SELECT question_secrete FROM users WHERE nom = ?',
      [nom]
    );

    if (utilisateurs.length === 0) {
      return res.status(404).json({ erreur: 'Utilisateur non trouvé' });
    }

    return res.json({ question: utilisateurs[0].question_secrete });

  } catch (erreur) {
    console.error('Erreur récupération question :', erreur);
    return res.status(500).json({ erreur: 'Erreur interne du serveur' });
  }
});

// ── Récupérer le nom de l'utilisateur en session ────────────
app.get('/api/session/nom', (req, res) => {
  if (!req.session.nom) {
    return res.status(401).json({ erreur: 'Non connecté' });
  }
  return res.json({ nom: req.session.nom });
});

// ── Vérifier l'état d'authentification de la session ────────
app.get('/api/session/check', (req, res) => {
  return res.json({
    step1        : !!req.session.step1,
    step2        : !!req.session.step2,
    authenticated: !!req.session.authenticated,
    nom          : req.session.nom || null
  });
});

// ============================================================
// ROUTES PROTÉGÉES — pages HTML sécurisées
// ============================================================

// Page OTP — nécessite étape 1 validée
app.get('/otp.html', checkAuth('step1'), (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/otp.html'));
});

// Page question secrète — nécessite étape 2 validée
app.get('/secret.html', checkAuth('step2'), (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/secret.html'));
});

// Page d'accueil — nécessite authentification complète
app.get('/accueil.html', checkAuth('authenticated'), (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/accueil.html'));
});

// Page Mali — nécessite authentification complète
app.get('/mali.html', checkAuth('authenticated'), (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/mali.html'));
});

// ============================================================
// DÉMARRAGE DU SERVEUR
// ============================================================

async function demarrerServeur() {
  try {
    // Initialiser la base de données avant de démarrer
    await initialiserBaseDeDonnees();

    app.listen(PORT, () => {
      console.log(`🌍 MaliXplore démarré sur http://localhost:${PORT}`);
      console.log(`📄 Page de connexion : http://localhost:${PORT}/index.html`);
      console.log(`📝 Inscription      : http://localhost:${PORT}/inscription.html`);
    });
  } catch (erreur) {
    console.error('❌ Impossible de démarrer le serveur :', erreur.message);
    process.exit(1);
  }
}

demarrerServeur();
