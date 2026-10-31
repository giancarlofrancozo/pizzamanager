const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname, 'db');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(dir, 'database.sqlite'),
  logging: false,
  retry: {
    max: 5,
  },
  dialectOptions: {
    busyTimeout: 15000,
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

// Configura modo WAL e timeout estendido no SQLite para evitar travamento sob concorrencia
sequelize.afterConnect((connection) => {
  connection.run('PRAGMA journal_mode = WAL;');
  connection.run('PRAGMA synchronous = NORMAL;');
  connection.run('PRAGMA busy_timeout = 15000;');
});

module.exports = { sequelize };
