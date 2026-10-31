const express = require('express');
const { Op, fn, col } = require('sequelize');
const { Order, OrderItem, OrderPayment, Product, Courier } = require('../models');
const { required } = require('../middleware/auth');

const router = express.Router();
router.use(required(['admin', 'caixa']));

const minutes = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : null);
const avg = arr => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);

// /api/reports/sales?from=2026-10-01&to=2026-10-31
router.get('/sales', async (req, res) => {
  const from = req.query.from ? new Date(req.query.from + 'T00:00:00') : new Date(Date.now() - 7 * 864e5);
  const to = req.query.to ? new Date(req.query.to + 'T23:59:59') : new Date();
  const orders = await Order.findAll({
    where: { createdAt: { [Op.between]: [from, to] }, status: { [Op.ne]: 'cancelado' } },
    include: [{ model: OrderItem, as: 'items', include: [Product] }, { model: OrderPayment, as: 'payments' }, Courier],
  });
  const total = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
  const byType = {};
  const byDay = {};
  const byPayment = {};
  const byHour = Array.from({ length: 24 }, () => 0);
  const flavorQty = {}; const drinkQty = {}; const foodQty = {};
  const bump = (m, k, q) => { m[k] = (m[k] || 0) + q; };
  const topOf = m => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }));
  const couriers = {};
  const prep = [];
  const delivery = [];
  for (const o of orders) {
    byHour[o.createdAt.getHours()] += Number(o.totalAmount);
    for (const it of o.items) {
      if (it.kind === 'pizza') it.flavorNames.forEach(n => bump(flavorQty, n, it.quantity / it.flavorNames.length));
      else if (it.Product && it.Product.kitchen === false) bump(drinkQty, it.description, it.quantity);
      else bump(foodQty, it.description, it.quantity);
    }
    byType[o.type] = (byType[o.type] || 0) + Number(o.totalAmount);
    const d = o.createdAt.toISOString().slice(0, 10);
    byDay[d] = (byDay[d] || 0) + Number(o.totalAmount);
    if (o.payments && o.payments.length) {
      for (const p of o.payments) {
        byPayment[p.paymentMethod] = (byPayment[p.paymentMethod] || 0) + Number(p.amount);
      }
    } else if (o.paid) {
      byPayment[o.paymentMethod] = (byPayment[o.paymentMethod] || 0) + Number(o.totalAmount);
    }
    const ready = o.items.map(i => i.readyAt).filter(Boolean).sort().pop();
    const p = minutes(o.createdAt, ready);
    if (p !== null && o.items.some(i => i.startedAt)) prep.push(p);
    if (o.type === 'delivery' && o.Courier) {
      const c = couriers[o.Courier.name] || (couriers[o.Courier.name] = { count: 0, fees: 0 });
      c.count += 1;
      c.fees += Number(o.deliveryFee);
      const dm = minutes(o.departedAt, o.deliveredAt);
      if (dm !== null) delivery.push(dm);
    }
  }
  const top = await OrderItem.findAll({
    attributes: ['description', [fn('SUM', col('quantity')), 'qty']],
    group: ['description'],
    order: [[fn('SUM', col('quantity')), 'DESC']],
    limit: 5,
  });
  res.json({
    count: orders.length,
    total,
    ticketMedio: orders.length ? total / orders.length : 0,
    byType, byDay, byPayment, couriers, byHour,
    topFlavors: topOf(flavorQty), topDrinks: topOf(drinkQty), topFood: topOf(foodQty),
    avgPrepMinutes: avg(prep),
    avgDeliveryMinutes: avg(delivery),
    top: top.map(t => ({ name: t.description || '?', qty: Number(t.get('qty')) })),
  });
});

module.exports = router;
