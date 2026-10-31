const express = require('express');
const { Op } = require('sequelize');
const { Table, Customer, Order, OrderItem, Product, User } = require('../models');
const { required } = require('../middleware/auth');

const router = express.Router();
router.use(required());

// Lista todas as mesas com status em tempo real, pedidos abertos, tempo de permanência e valor acumulado (estilo EiChefe)
router.get('/tables', async (req, res) => {
  try {
    const tables = await Table.findAll({ order: [['number', 'ASC']] });

    // Busca pedidos de mesa abertos (não pagos e não cancelados)
    const openOrders = await Order.findAll({
      where: {
        type: 'mesa',
        paid: false,
        status: { [Op.ne]: 'cancelado' },
        TableId: { [Op.ne]: null },
      },
      include: [
        { model: Customer, attributes: ['id', 'name', 'phone'] },
        { model: User, attributes: ['id', 'name', 'username'] },
        {
          model: OrderItem,
          as: 'items',
          attributes: ['id', 'quantity', 'unitPrice', 'description', 'status', 'kind', 'observations'],
          include: [{ model: Product, attributes: ['id', 'name'] }],
        },
      ],
      order: [['id', 'DESC']],
    });

    const orderByTable = new Map();
    for (const ord of openOrders) {
      if (!orderByTable.has(ord.TableId)) {
        orderByTable.set(ord.TableId, ord);
      }
    }

    const now = Date.now();
    const result = tables.map(t => {
      const ord = orderByTable.get(t.id);
      if (!ord) {
        return {
          id: t.id,
          number: t.number,
          status: 'livre',
          isOpen: false,
          order: null,
        };
      }

      const total = Number(ord.totalAmount || 0);
      const paid = Number(ord.paidAmount || 0);
      const due = Math.max(0, total - paid);
      const ms = now - new Date(ord.createdAt).getTime();
      const minutesOpen = Math.max(0, Math.floor(ms / 60000));
      const hours = Math.floor(minutesOpen / 60);
      const mins = minutesOpen % 60;
      const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      const hasReadyItem = (ord.items || []).some(it => it.status === 'pronto');

      // Status visual idêntico ao EiChefe
      let statusVisual = 'ocupada';
      if (hasReadyItem) {
        statusVisual = 'pronto';
      } else if (paid > 0 && due > 0) {
        statusVisual = 'fechamento';
      }

      return {
        id: t.id,
        number: t.number,
        status: statusVisual,
        isOpen: true,
        order: {
          id: ord.id,
          total,
          paid,
          due,
          splitCount: ord.splitCount || 1,
          createdAt: ord.createdAt,
          timeStr,
          minutesOpen,
          customerName: ord.Customer?.name || null,
          operatorName: ord.User?.name || ord.User?.username || 'Garçom',
          itemsCount: ord.items?.length || 0,
          items: ord.items || [],
          hasReadyItem,
        },
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Transferência / Mudança de Mesa (Mudar Mesa - janelas/mudarMesa.tpl do EiChefe)
router.post('/tables/transfer', async (req, res) => {
  try {
    const { fromTableNumber, toTableNumber } = req.body;
    const fromNum = Number(fromTableNumber);
    const toNum = Number(toTableNumber);

    if (!fromNum || !toNum || fromNum === toNum) {
      return res.status(400).json({ error: 'Informe mesas de origem e destino diferentes' });
    }

    const [fromTable, toTable] = await Promise.all([
      Table.findOne({ where: { number: fromNum } }),
      Table.findOne({ where: { number: toNum } }),
    ]);

    if (!fromTable) return res.status(404).json({ error: `Mesa ${fromNum} não encontrada` });
    if (!toTable) return res.status(404).json({ error: `Mesa ${toNum} não encontrada` });

    // Encontra o pedido aberto na mesa de origem
    const openOrder = await Order.findOne({
      where: {
        type: 'mesa',
        TableId: fromTable.id,
        paid: false,
        status: { [Op.ne]: 'cancelado' },
      },
    });

    if (!openOrder) {
      return res.status(400).json({ error: `A mesa ${fromNum} não possui pedidos em aberto para transferir` });
    }

    // Verifica se a mesa de destino já tem pedido aberto
    const destOrder = await Order.findOne({
      where: {
        type: 'mesa',
        TableId: toTable.id,
        paid: false,
        status: { [Op.ne]: 'cancelado' },
      },
    });

    if (destOrder) {
      // Mescla itens no pedido da mesa de destino
      await OrderItem.update({ OrderId: destOrder.id }, { where: { OrderId: openOrder.id } });
      const newTotal = Number(destOrder.totalAmount || 0) + Number(openOrder.totalAmount || 0);
      await destOrder.update({ totalAmount: newTotal });
      await openOrder.update({ status: 'cancelado', notes: `Mesclado para a mesa ${toNum} (Pedido #${destOrder.id})` });
      await fromTable.update({ status: 'livre' });
      await toTable.update({ status: 'ocupada' });
      return res.json({ ok: true, message: `Mesa ${fromNum} mesclada com a mesa ${toNum} com sucesso!` });
    }

    // Transfere o pedido para a nova mesa
    await openOrder.update({ TableId: toTable.id });
    await fromTable.update({ status: 'livre' });
    await toTable.update({ status: 'ocupada' });

    res.json({ ok: true, message: `Pedido #${openOrder.id} transferido da Mesa ${fromNum} para a Mesa ${toNum} com sucesso!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tables', required(['admin']), async (req, res) => {
  try {
    res.status(201).json(await Table.create({ number: req.body.number }));
  } catch (e) {
    res.status(400).json({ error: 'Mesa ja existe' });
  }
});
router.delete('/tables/:id', required(['admin']), async (req, res) => {
  await Table.destroy({ where: { id: req.params.id } });
  res.sendStatus(204);
});

// Busca por nome ou telefone (a base importada tem milhares de clientes)
router.get('/customers', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const where = q ? { [Op.or]: [{ name: { [Op.like]: `%${q}%` } }, { phone: { [Op.like]: `%${q.replace(/\D/g, '') || q}%` } }] } : {};
  res.json(await Customer.findAll({ where, order: [['name', 'ASC']], limit }));
});
router.post('/customers', async (req, res) => res.status(201).json(await Customer.create(req.body)));
router.put('/customers/:id', async (req, res) => {
  const c = await Customer.findByPk(req.params.id);
  if (!c) return res.sendStatus(404);
  res.json(await c.update(req.body));
});
router.delete('/customers/:id', required(['admin']), async (req, res) => {
  await Customer.destroy({ where: { id: req.params.id } });
  res.sendStatus(204);
});

module.exports = router;
