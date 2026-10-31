const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

// Registro de recebimento parcial ou total do pedido (EiChefe: contareceber + contareceberitem)
const OrderPayment = sequelize.define('OrderPayment', {
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  paymentMethod: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Dinheiro' },
  payerName: { type: DataTypes.STRING },
  itemsJson: {
    type: DataTypes.TEXT,
    get() { const v = this.getDataValue('itemsJson'); return v ? JSON.parse(v) : []; },
    set(v) { this.setDataValue('itemsJson', JSON.stringify(v || [])); },
  },
});

module.exports = OrderPayment;
