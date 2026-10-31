const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Table = sequelize.define('Table', {
  number: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  status: { type: DataTypes.ENUM('livre', 'ocupada'), defaultValue: 'livre' },
});

module.exports = Table;
