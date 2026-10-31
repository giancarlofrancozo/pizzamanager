const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const OrderItem = sequelize.define('OrderItem', {
  kind: { type: DataTypes.ENUM('produto', 'pizza'), defaultValue: 'produto' },
  description: { type: DataTypes.STRING },
  flavorNames: {
    type: DataTypes.TEXT,
    get() { const v = this.getDataValue('flavorNames'); return v ? JSON.parse(v) : []; },
    set(v) { this.setDataValue('flavorNames', JSON.stringify(v || [])); },
  },
  quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  paidQuantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  unitPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  observations: { type: DataTypes.TEXT },
  // Cozinha (EiChefe: itemvendakds)
  status: { type: DataTypes.ENUM('fila', 'preparo', 'pronto', 'cancelado'), defaultValue: 'fila' },
  startedAt: { type: DataTypes.DATE },
  readyAt: { type: DataTypes.DATE },
  // Cancelamento de item (EiChefe: cancelarProdutos.tpl / produtosCancelados)
  cancelledAt: { type: DataTypes.DATE },
  cancelledReason: { type: DataTypes.STRING },
  cancelledBy: { type: DataTypes.STRING },
  // Divisao de item por cotas/pessoas (EiChefe: ModalDivisaoValores / vendadivisao)
  splitInfo: {
    type: DataTypes.TEXT,
    get() {
      const v = this.getDataValue('splitInfo');
      if (!v) return null;
      try { return typeof v === 'object' ? v : JSON.parse(v); } catch (_) { return null; }
    },
    set(v) {
      this.setDataValue('splitInfo', v ? JSON.stringify(v) : null);
    },
  },
});

module.exports = OrderItem;
