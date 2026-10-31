const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

// Taxa de entrega por bairro (EiChefe: bairro + taxaentregaporbairro)
const Neighborhood = sequelize.define('Neighborhood', {
  name: { type: DataTypes.STRING, allowNull: false },
  fee: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

// Entregador (EiChefe: entregador)
const Courier = sequelize.define('Courier', {
  name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING },
  moto: { type: DataTypes.BOOLEAN, defaultValue: true },
  commissionPct: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

module.exports = { Neighborhood, Courier };
