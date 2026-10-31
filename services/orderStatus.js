const { Order, OrderItem } = require('../models');

// Recalcula o status do pedido a partir do estado dos itens na cozinha.
async function refreshOrderStatus(orderId, transaction) {
  const order = await Order.findByPk(orderId, { transaction });
  if (!order || !['pendente', 'preparo'].includes(order.status)) return order;
  const items = await OrderItem.findAll({ where: { OrderId: orderId }, transaction });
  let status = order.status;
  if (items.length && items.every(i => i.status === 'pronto')) status = 'pronto';
  else if (items.some(i => i.status !== 'fila')) status = 'preparo';
  if (status !== order.status) await order.update({ status }, { transaction });
  return order;
}

module.exports = { refreshOrderStatus };
