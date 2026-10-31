const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

// Forma de pagamento (EiChefe: formapagamento)
const PaymentMethod = sequelize.define('PaymentMethod', {
  name: { type: DataTypes.STRING, allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

module.exports = PaymentMethod;
