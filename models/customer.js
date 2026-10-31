const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Customer = sequelize.define('Customer', {
  name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING },
  address: { type: DataTypes.STRING },
  neighborhood: { type: DataTypes.STRING },
});

module.exports = Customer;
