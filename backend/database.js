// ============================================================
// database.js — Connexion MySQL et initialisation des tables
// ============================================================

require('dotenv').config({ path: __dirname + '/.env' });
const mysql = require('mysql2/promise');

// --- Pool de connexions MySQL ---
const pool = mysql.createPool({
  host     : process.env.DB_HOST || 'localhost',
  port     : parseInt(process.env.DB_PORT) || 3306,
  user     : process.env.DB_USER || 'root',
  password : process.env.DB_PASSWORD || '',
  database : process.env.DB_NAME || 'malixplore',
  waitForConnections: true,
  connectionLimit   : 10,
  queueLimit        : 0
});

// --- Création automatique de la table users au démarrage ---
async function initialiserBaseDeDonnees() {
  const requeteCreationTable = `
    CREATE TABLE IF NOT EXISTS users (
      id                INTEGER PRIMARY KEY AUTO_INCREMENT,
      nom               VARCHAR(100) NOT NULL UNIQUE,
      mot_de_passe      VARCHAR(255) NOT NULL,
      otp_code          VARCHAR(6)   NOT NULL,
      question_secrete  TEXT         NOT NULL,
      reponse_secrete   VARCHAR(255) NOT NULL,
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  try {
    const connexion = await pool.getConnection();
    await connexion.query(requeteCreationTable);
    connexion.release();
    console.log('✅ Base de données initialisée — table users prête');
  } catch (erreur) {
    console.error('❌ Erreur initialisation BDD :', erreur.message);
    throw erreur;
  }
}

module.exports = { pool, initialiserBaseDeDonnees };
