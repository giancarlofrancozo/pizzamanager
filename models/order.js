const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Order = sequelize.define('Order', {
  status: {
    type: DataTypes.ENUM('pendente', 'preparo', 'pronto', 'saiu', 'entregue', 'cancelado'),
    defaultValue: 'pendente',
  },
  type: { type: DataTypes.ENUM('mesa', 'balcao', 'delivery'), defaultValue: 'mesa' },
  deliveryFee: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  totalAmount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  paidAmount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  splitCount: { type: DataTypes.INTEGER, defaultValue: 1 },
  paymentMethod: { type: DataTypes.STRING },
  paid: { type: DataTypes.BOOLEAN, defaultValue: false },
  notes: { type: DataTypes.TEXT },
  // Delivery (EiChefe: diskentrega)
  address: { type: DataTypes.STRING },
  addressNumber: { type: DataTypes.STRING },
  complement: { type: DataTypes.STRING },
  reference: { type: DataTypes.STRING },
  deliveryMode: { type: DataTypes.STRING, defaultValue: 'e' },
  discount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  isNewCustomer: { type: DataTypes.BOOLEAN, defaultValue: false },
  changeFor: { type: DataTypes.DECIMAL(10, 2) },
  departedAt: { type: DataTypes.DATE },
  deliveredAt: { type: DataTypes.DATE },
  // Fiscal / NFC-e (Projeto Nf-e)
  nfeStatus: { type: DataTypes.STRING, defaultValue: 'nao_emitida' },
  nfeKey: { type: DataTypes.STRING },
  nfeProtocol: { type: DataTypes.STRING },
  nfeFile: { type: DataTypes.STRING },
  customerCpf: { type: DataTypes.STRING },
  customerName: { type: DataTypes.STRING },
});

module.exports = Order;
