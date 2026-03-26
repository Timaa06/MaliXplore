require('dotenv').config({ path: __dirname + '/.env' });
const mysql = require('mysql2/promise');

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

async function initialiserBaseDeDonnees() {
  const requeteCreationTable = `
    CREATE TABLE IF NOT EXISTS users (
      id               INTEGER PRIMARY KEY AUTO_INCREMENT,
      nom              VARCHAR(100) NOT NULL UNIQUE,
      email            VARCHAR(255) NOT NULL DEFAULT '',
      mot_de_passe     VARCHAR(255) NOT NULL,
      schema_secret    VARCHAR(255) NOT NULL DEFAULT '',
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  try {
    const connexion = await pool.getConnection();
    await connexion.query(requeteCreationTable);

    // Migration : ajouter email si absent
    const [colsEmail] = await connexion.query(`SHOW COLUMNS FROM users LIKE 'email'`);
    if (colsEmail.length === 0) {
      await connexion.query(`ALTER TABLE users ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT '' AFTER nom`);
      console.log('Migration : colonne email ajoutée');
    }

    // Migration : supprimer otp_code si encore présent
    const [colsOtp] = await connexion.query(`SHOW COLUMNS FROM users LIKE 'otp_code'`);
    if (colsOtp.length > 0) {
      await connexion.query(`ALTER TABLE users DROP COLUMN otp_code`);
      console.log('Migration : colonne otp_code supprimée');
    }

    // Migration : ajouter schema_secret si absent
    const [colsSchema] = await connexion.query(`SHOW COLUMNS FROM users LIKE 'schema_secret'`);
    if (colsSchema.length === 0) {
      await connexion.query(`ALTER TABLE users ADD COLUMN schema_secret VARCHAR(255) NOT NULL DEFAULT ''`);
      console.log('Migration : colonne schema_secret ajoutée');
    }

    // Migration : supprimer question_secrete si encore présente
    const [colsQ] = await connexion.query(`SHOW COLUMNS FROM users LIKE 'question_secrete'`);
    if (colsQ.length > 0) {
      await connexion.query(`ALTER TABLE users DROP COLUMN question_secrete`);
      console.log('Migration : colonne question_secrete supprimée');
    }

    // Migration : supprimer reponse_secrete si encore présente
    const [colsR] = await connexion.query(`SHOW COLUMNS FROM users LIKE 'reponse_secrete'`);
    if (colsR.length > 0) {
      await connexion.query(`ALTER TABLE users DROP COLUMN reponse_secrete`);
      console.log('Migration : colonne reponse_secrete supprimée');
    }

    // Table des logs
    await connexion.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id         INTEGER PRIMARY KEY AUTO_INCREMENT,
        type       VARCHAR(60)  NOT NULL,
        user_id    INTEGER      DEFAULT NULL,
        nom        VARCHAR(100) DEFAULT NULL,
        email      VARCHAR(255) DEFAULT NULL,
        ip         VARCHAR(45)  DEFAULT NULL,
        details    TEXT         DEFAULT NULL,
        created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    connexion.release();
    console.log('Base de données initialisée — table users prête');
  } catch (erreur) {
    console.error('Erreur initialisation BDD :', erreur.message);
    throw erreur;
  }
}

module.exports = { pool, initialiserBaseDeDonnees };
