
require('dotenv').config({ path: __dirname + '/.env' });

const express        = require('express');
const session        = require('express-session');
const bcrypt         = require('bcrypt');
const cors           = require('cors');
const path           = require('path');
const nodemailer     = require('nodemailer');
const { pool, initialiserBaseDeDonnees } = require('./database');

// --- Transporteur email ---
const transporteur = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

function genererOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function envoyerEmailOTP(destinataire, code) {
  await transporteur.sendMail({
    from   : `"MaliXplore" <${process.env.EMAIL_USER}>`,
    to     : destinataire,
    subject: 'Votre code de connexion MaliXplore',
    html   : `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #ddd;border-radius:8px;">
        <h2 style="color:#c8a84b;">MaliXplore</h2>
        <p>Bonjour,</p>
        <p>Voici votre code de connexion à usage unique :</p>
        <div style="font-size:2rem;font-weight:bold;letter-spacing:8px;text-align:center;padding:16px;background:#f5f0e8;border-radius:6px;color:#333;">
          ${code}
        </div>
        <p style="margin-top:16px;color:#666;font-size:0.9rem;">Ce code expire dans <strong>10 minutes</strong>. Ne le partagez avec personne.</p>
        <p style="color:#999;font-size:0.8rem;">Si vous n'avez pas demandé ce code, ignorez cet email.</p>
      </div>
    `
  });
}

// --- Fonction de log ---
function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || null;
}

async function log(type, { userId = null, nom = null, email = null, ip = null, details = null } = {}) {
  try {
    await pool.query(
      `INSERT INTO logs (type, user_id, nom, email, ip, details) VALUES (?, ?, ?, ?, ?, ?)`,
      [type, userId, nom, email, ip, details]
    );
  } catch (e) {
    console.error('Erreur log :', e.message);
  }
}

const app  = express();
const PORT = process.env.PORT || 3000;

const SALT_ROUNDS = 10;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret           : process.env.SESSION_SECRET || 'malixplore_secret',
  resave           : false,
  saveUninitialized: false,
  cookie           : {
    httpOnly: true,
    maxAge  : 30 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, '../frontend')));

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

// Étape 1 inscription : vérifier et envoyer OTP à l'email
app.post('/auth/register/email', async (req, res) => {
  const { email } = req.body;
  const ip = getIP(req);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await log('inscription_echec', { email, ip, details: 'Email invalide' });
    return res.status(400).json({ erreur: 'Adresse email invalide' });
  }

  try {
    const emailNormalise = email.trim().toLowerCase();
    const [existants] = await pool.query('SELECT id FROM users WHERE email = ?', [emailNormalise]);
    if (existants.length > 0) {
      await log('inscription_echec', { email: emailNormalise, ip, details: 'Email déjà utilisé' });
      return res.status(409).json({ erreur: 'Cet email est déjà utilisé' });
    }

    const otp = genererOTP();
    req.session.inscription_email      = emailNormalise;
    req.session.inscription_otp        = otp;
    req.session.inscription_otp_expiry = Date.now() + 10 * 60 * 1000;
    req.session.inscription_email_ok   = false;

    await envoyerEmailOTP(emailNormalise, otp);
    await log('inscription_otp_envoye', { email: emailNormalise, ip });

    return res.json({ succes: true });
  } catch (erreur) {
    console.error('Erreur inscription étape 1 :', erreur);
    await log('inscription_echec', { email, ip, details: erreur.message });
    return res.status(500).json({ erreur: 'Impossible d\'envoyer l\'email' });
  }
});

// Étape 2 inscription : vérifier l'OTP reçu par email
app.post('/auth/register/otp', async (req, res) => {
  const { otp_code } = req.body;
  const ip = getIP(req);
  const email = req.session.inscription_email || null;

  if (!email || !req.session.inscription_otp) {
    return res.status(400).json({ erreur: 'Session expirée. Recommencez.' });
  }
  if (!otp_code) return res.status(400).json({ erreur: 'Code OTP requis' });

  if (Date.now() > req.session.inscription_otp_expiry) {
    delete req.session.inscription_otp;
    delete req.session.inscription_otp_expiry;
    await log('inscription_otp_echec', { email, ip, details: 'OTP expiré' });
    return res.status(401).json({ erreur: 'Code OTP expiré. Relancez l\'envoi.' });
  }

  if (String(otp_code).trim() !== String(req.session.inscription_otp).trim()) {
    await log('inscription_otp_echec', { email, ip, details: 'Code incorrect' });
    return res.status(401).json({ erreur: 'Code OTP incorrect' });
  }

  delete req.session.inscription_otp;
  delete req.session.inscription_otp_expiry;
  req.session.inscription_email_ok = true;
  await log('inscription_otp_succes', { email, ip });
  return res.json({ succes: true });
});

// Renvoyer OTP d'inscription
app.post('/auth/register/renvoyer', async (req, res) => {
  const ip = getIP(req);
  if (!req.session.inscription_email) return res.status(400).json({ erreur: 'Session expirée. Recommencez.' });

  try {
    const otp = genererOTP();
    req.session.inscription_otp        = otp;
    req.session.inscription_otp_expiry = Date.now() + 10 * 60 * 1000;
    await envoyerEmailOTP(req.session.inscription_email, otp);
    await log('inscription_otp_renvoye', { email: req.session.inscription_email, ip });
    return res.json({ succes: true, message: 'Nouveau code envoyé' });
  } catch (erreur) {
    console.error('Erreur renvoi OTP inscription :', erreur);
    return res.status(500).json({ erreur: 'Impossible d\'envoyer l\'email' });
  }
});

// Étape 3 inscription : créer le compte
app.post('/auth/register', async (req, res) => {
  const ip = getIP(req);
  if (!req.session.inscription_email_ok || !req.session.inscription_email) {
    return res.status(403).json({ erreur: 'Email non vérifié. Recommencez l\'inscription.' });
  }

  const { nom, mot_de_passe, confirmer_mot_de_passe, schema_secret } = req.body;
  const email = req.session.inscription_email;

  try {
    if (!nom || !mot_de_passe || !confirmer_mot_de_passe || !schema_secret) {
      await log('inscription_echec', { nom, email, ip, details: 'Champs manquants' });
      return res.status(400).json({ erreur: 'Tous les champs sont obligatoires' });
    }
    if (mot_de_passe !== confirmer_mot_de_passe) {
      await log('inscription_echec', { nom, email, ip, details: 'Mots de passe différents' });
      return res.status(400).json({ erreur: 'Les mots de passe ne correspondent pas' });
    }
    if (!/^[0-8]{4,9}$/.test(schema_secret)) {
      await log('inscription_echec', { nom, email, ip, details: 'Schéma invalide' });
      return res.status(400).json({ erreur: 'Schéma invalide (minimum 4 points)' });
    }

    const [existants] = await pool.query('SELECT id FROM users WHERE nom = ?', [nom]);
    if (existants.length > 0) {
      await log('inscription_echec', { nom, email, ip, details: 'Nom déjà utilisé' });
      return res.status(409).json({ erreur: 'Nom d\'utilisateur déjà utilisé' });
    }

    const motDePasseHashe = await bcrypt.hash(mot_de_passe, SALT_ROUNDS);
    const schemaHashe     = await bcrypt.hash(schema_secret, SALT_ROUNDS);
    await pool.query(
      `INSERT INTO users (nom, email, mot_de_passe, schema_secret) VALUES (?, ?, ?, ?)`,
      [nom, email, motDePasseHashe, schemaHashe]
    );

    delete req.session.inscription_email;
    delete req.session.inscription_email_ok;
    await log('inscription_succes', { nom, email, ip });
    return res.status(201).json({ succes: true, message: 'Compte créé avec succès ! Vous pouvez maintenant vous connecter.' });
  } catch (erreur) {
    console.error('Erreur inscription :', erreur);
    await log('inscription_echec', { nom, email, ip, details: erreur.message });
    return res.status(500).json({ erreur: 'Erreur interne du serveur' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { nom, mot_de_passe } = req.body;
  const ip = getIP(req);

  try {
    if (!nom || !mot_de_passe) {
      return res.status(400).json({ erreur: 'Nom et mot de passe requis' });
    }

    const [utilisateurs] = await pool.query(
      'SELECT id, nom, email, mot_de_passe FROM users WHERE nom = ?', [nom]
    );

    if (utilisateurs.length === 0) {
      await log('connexion_echec', { nom, ip, details: 'Utilisateur inconnu' });
      return res.status(401).json({ erreur: 'Nom ou mot de passe incorrect' });
    }

    const utilisateur = utilisateurs[0];
    const motDePasseCorrect = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe);
    if (!motDePasseCorrect) {
      await log('connexion_echec', { userId: utilisateur.id, nom, ip, details: 'Mot de passe incorrect' });
      return res.status(401).json({ erreur: 'Nom ou mot de passe incorrect' });
    }

    const otp = genererOTP();
    req.session.userId     = utilisateur.id;
    req.session.nom        = utilisateur.nom;
    req.session.step1      = true;
    req.session.otp_temp   = otp;
    req.session.otp_expiry = Date.now() + 10 * 60 * 1000;

    await envoyerEmailOTP(utilisateur.email, otp);
    await log('connexion_succes_etape1', { userId: utilisateur.id, nom, email: utilisateur.email, ip });
    await log('otp_envoye', { userId: utilisateur.id, nom, email: utilisateur.email, ip });

    return res.json({ succes: true, redirect: '/otp.html' });
  } catch (erreur) {
    console.error('Erreur connexion étape 1 :', erreur);
    return res.status(500).json({ erreur: 'Erreur interne du serveur' });
  }
});

app.post('/auth/otp', async (req, res) => {
  const ip = getIP(req);
  if (!req.session.step1) {
    return res.status(401).json({ erreur: 'Session invalide', redirect: '/index.html' });
  }

  const { otp_code } = req.body;
  if (!otp_code) return res.status(400).json({ erreur: 'Code OTP requis' });

  if (!req.session.otp_temp || !req.session.otp_expiry) {
    return res.status(401).json({ erreur: 'Aucun code OTP en attente. Reconnectez-vous.', redirect: '/index.html' });
  }

  if (Date.now() > req.session.otp_expiry) {
    delete req.session.otp_temp;
    delete req.session.otp_expiry;
    await log('otp_echec', { userId: req.session.userId, nom: req.session.nom, ip, details: 'OTP expiré' });
    return res.status(401).json({ erreur: 'Code OTP expiré. Reconnectez-vous.', redirect: '/index.html' });
  }

  if (String(otp_code).trim() !== String(req.session.otp_temp).trim()) {
    await log('otp_echec', { userId: req.session.userId, nom: req.session.nom, ip, details: 'Code incorrect' });
    return res.status(401).json({ erreur: 'Code OTP incorrect' });
  }

  delete req.session.otp_temp;
  delete req.session.otp_expiry;
  req.session.step2 = true;
  await log('otp_succes', { userId: req.session.userId, nom: req.session.nom, ip });
  return res.json({ succes: true, redirect: '/secret.html' });
});

app.post('/auth/otp/renvoyer', async (req, res) => {
  const ip = getIP(req);
  if (!req.session.step1 || !req.session.userId) {
    return res.status(401).json({ erreur: 'Session invalide', redirect: '/index.html' });
  }

  try {
    const [utilisateurs] = await pool.query('SELECT email FROM users WHERE id = ?', [req.session.userId]);
    if (utilisateurs.length === 0) return res.status(401).json({ erreur: 'Session invalide', redirect: '/index.html' });

    const otp = genererOTP();
    req.session.otp_temp   = otp;
    req.session.otp_expiry = Date.now() + 10 * 60 * 1000;
    await envoyerEmailOTP(utilisateurs[0].email, otp);
    await log('otp_renvoye', { userId: req.session.userId, nom: req.session.nom, email: utilisateurs[0].email, ip });
    return res.json({ succes: true, message: 'Nouveau code envoyé par email' });
  } catch (erreur) {
    console.error('Erreur renvoi OTP :', erreur);
    return res.status(500).json({ erreur: 'Impossible d\'envoyer l\'email' });
  }
});

app.post('/auth/secret', async (req, res) => {
  const ip = getIP(req);
  if (!req.session.step2) {
    return res.status(401).json({ erreur: 'Session invalide', redirect: '/index.html' });
  }

  const { schema_secret } = req.body;
  try {
    if (!schema_secret) return res.status(400).json({ erreur: 'Schéma requis' });

    const [utilisateurs] = await pool.query('SELECT schema_secret FROM users WHERE id = ?', [req.session.userId]);
    if (utilisateurs.length === 0) return res.status(401).json({ erreur: 'Session invalide', redirect: '/index.html' });

    const schemaCorrect = await bcrypt.compare(schema_secret, utilisateurs[0].schema_secret);
    if (!schemaCorrect) {
      await log('schema_echec', { userId: req.session.userId, nom: req.session.nom, ip });
      return res.status(401).json({ erreur: 'Schéma incorrect' });
    }

    req.session.authenticated = true;
    await log('connexion_complete', { userId: req.session.userId, nom: req.session.nom, ip });
    return res.json({ succes: true, redirect: '/accueil.html' });
  } catch (erreur) {
    console.error('Erreur connexion étape 3 :', erreur);
    return res.status(500).json({ erreur: 'Erreur interne du serveur' });
  }
});

app.get('/auth/logout', (req, res) => {
  const userId = req.session.userId || null;
  const nom    = req.session.nom    || null;
  const ip     = getIP(req);
  log('deconnexion', { userId, nom, ip });
  req.session.destroy((erreur) => {
    if (erreur) console.error('Erreur déconnexion :', erreur);
    res.redirect('/index.html');
  });
});

// ============================================================
// BACK OFFICE ADMIN
// ============================================================

function checkAdmin(req, res, next) {
  if (!req.session.admin) return res.status(401).json({ erreur: 'Non autorisé' });
  next();
}

app.post('/admin/login', async (req, res) => {
  const { login, mot_de_passe } = req.body;
  if (
    login       === process.env.ADMIN_USER &&
    mot_de_passe === process.env.ADMIN_PASS
  ) {
    req.session.admin = true;
    return res.json({ succes: true });
  }
  return res.status(401).json({ erreur: 'Identifiants incorrects' });
});

app.get('/admin/logout', (req, res) => {
  req.session.admin = false;
  res.redirect('/admin.html');
});

app.get('/admin/api/stats', checkAdmin, async (req, res) => {
  try {
    const aujourd_hui = new Date().toISOString().slice(0, 10);
    const [totaux] = await pool.query(`
      SELECT type, COUNT(*) AS nb
      FROM logs
      WHERE DATE(created_at) = ?
      GROUP BY type
    `, [aujourd_hui]);

    const [total_users] = await pool.query('SELECT COUNT(*) AS nb FROM users');
    const [total_logs]  = await pool.query('SELECT COUNT(*) AS nb FROM logs');

    const stats = {};
    totaux.forEach(r => { stats[r.type] = r.nb; });

    return res.json({
      today: stats,
      total_users: total_users[0].nb,
      total_logs : total_logs[0].nb
    });
  } catch (e) {
    return res.status(500).json({ erreur: e.message });
  }
});

app.get('/admin/api/logs', checkAdmin, async (req, res) => {
  try {
    const { type, nom, date_debut, date_fin, page = 1, limite = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limite);

    let where = 'WHERE 1=1';
    const params = [];

    if (type)       { where += ' AND type = ?';               params.push(type); }
    if (nom)        { where += ' AND nom LIKE ?';             params.push(`%${nom}%`); }
    if (date_debut) { where += ' AND DATE(created_at) >= ?';  params.push(date_debut); }
    if (date_fin)   { where += ' AND DATE(created_at) <= ?';  params.push(date_fin); }

    const [rows]  = await pool.query(`SELECT * FROM logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limite), offset]);
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM logs ${where}`, params);

    return res.json({ logs: rows, total, page: parseInt(page), limite: parseInt(limite) });
  } catch (e) {
    return res.status(500).json({ erreur: e.message });
  }
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});


app.get('/api/session/nom', (req, res) => {
  if (!req.session.nom) {
    return res.status(401).json({ erreur: 'Non connecté' });
  }
  return res.json({ nom: req.session.nom });
});

app.get('/api/session/check', (req, res) => {
  return res.json({
    step1        : !!req.session.step1,
    step2        : !!req.session.step2,
    authenticated: !!req.session.authenticated,
    nom          : req.session.nom || null
  });
});

app.get('/otp.html', checkAuth('step1'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/otp.html'));
});

app.get('/secret.html', checkAuth('step2'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/secret.html'));
});

app.get('/accueil.html', checkAuth('authenticated'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/accueil.html'));
});

app.get('/mali.html', checkAuth('authenticated'), (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/mali.html'));
});

async function demarrerServeur() {
  try {
    await initialiserBaseDeDonnees();

    app.listen(PORT, () => {
      console.log(` MaliXplore démarré sur http://localhost:${PORT}`);
      console.log(` Page de connexion : http://localhost:${PORT}/index.html`);
      console.log(` Inscription      : http://localhost:${PORT}/inscription.html`);
      console.log(` Back Office Admin : http://localhost:${PORT}/admin.html`);
    });
  } catch (erreur) {
    console.error(' Impossible de démarrer le serveur :', erreur.message);
    process.exit(1);
  }
}

demarrerServeur();
