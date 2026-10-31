const express = require('express');
const { Op } = require('sequelize');
const { Order, OrderItem, Product, Table, Customer, Neighborhood, KdsStage, ItemStageLog, Size, Crust } = require('../models');
const { required } = require('../middleware/auth');
const { refreshOrderStatus } = require('../services/orderStatus');

const router = express.Router();
router.use(required());

// Fila da cozinha: pedidos com itens ainda nao prontos, mais antigos primeiro
router.get('/pending', async (req, res) => {
  const [orders, stages] = await Promise.all([
    Order.findAll({
      where: { status: ['pendente', 'preparo'] },
      include: [
        {
          model: OrderItem,
          as: 'items',
          where: { status: { [Op.ne]: 'cancelado' } },
          required: false,
          include: [Product, Size, Crust, { model: KdsStage, as: 'currentStage' }],
        },
        Table, Customer, Neighborhood,
      ],
      order: [['createdAt', 'ASC']],
    }),
    KdsStage.findAll({ where: { active: true }, order: [['position', 'ASC']] }),
  ]);
  res.json({ orders, stages });
});

// Avanca o item: fila -> 1a etapa -> ... -> ultima etapa -> pronto (EiChefe: itemvendakds)
router.post('/items/:id/advance', async (req, res) => {
  const item = await OrderItem.findByPk(req.params.id);
  if (!item) return res.sendStatus(404);
  if (item.status === 'pronto') return res.status(400).json({ error: 'Item ja esta pronto' });
  const stages = await KdsStage.findAll({ where: { active: true }, order: [['position', 'ASC']] });
  const now = new Date();

  if (item.status === 'fila') {
    const first = stages[0];
    if (!first) {
      await item.update({ status: 'pronto', startedAt: now, readyAt: now });
    } else {
      await ItemStageLog.create({ OrderItemId: item.id, KdsStageId: first.id, startedAt: now });
      await item.update({ status: 'preparo', CurrentStageId: first.id, startedAt: now });
    }
  } else {
    const log = await ItemStageLog.findOne({
      where: { OrderItemId: item.id, KdsStageId: item.CurrentStageId, finishedAt: null },
    });
    if (log) await log.update({ finishedAt: now });
    const idx = stages.findIndex(s => s.id === item.CurrentStageId);
    const next = stages[idx + 1];
    if (next) {
      await ItemStageLog.create({ OrderItemId: item.id, KdsStageId: next.id, startedAt: now });
      await item.update({ CurrentStageId: next.id });
    } else {
      await item.update({ status: 'pronto', readyAt: now });
    }
  }
  await refreshOrderStatus(item.OrderId);
  res.json(await OrderItem.findByPk(item.id, { include: [{ model: KdsStage, as: 'currentStage' }] }));
});

module.exports = router;
