const express = require('express');
const { Op } = require('sequelize');
const {
  sequelize, Order, OrderItem, OrderPayment, Product, Table, Customer, Size, Flavor, FlavorPrice, Crust,
  Neighborhood, Courier, KdsStage,
} = require('../models');
const { required } = require('../middleware/auth');
const { refreshOrderStatus } = require('../services/orderStatus');

const router = express.Router();
router.use(required());

const include = [
  { model: OrderItem, as: 'items', include: [Product, Size, Crust, { model: KdsStage, as: 'currentStage' }] },
  { model: OrderPayment, as: 'payments' },
  Table, Customer, Neighborhood, Courier,
];

router.get('/', async (req, res) => {
  const where = {};
  if (req.query.status) where.status = req.query.status.split(',');
  res.json(await Order.findAll({ where, include, order: [['createdAt', 'DESC']], limit: 200 }));
});

router.get('/:id', async (req, res) => {
  const o = await Order.findByPk(req.params.id, { include });
  if (!o) return res.sendStatus(404);
  res.json(o);
});

// Monta uma linha de pizza (preco = sabor mais caro no tamanho + borda, como no EiChefe)
async function buildPizza(it, t) {
  const size = await Size.findByPk(it.sizeId, { transaction: t });
  if (!size || !size.active) throw new Error('Tamanho invalido');
  const ids = [...new Set((it.flavorIds || []).map(Number))];
  if (!ids.length) throw new Error('Escolha ao menos um sabor');
  if (ids.length > size.maxFlavors) throw new Error(`${size.name} aceita no maximo ${size.maxFlavors} sabor(es)`);
  const flavors = await Flavor.findAll({
    where: { id: ids, active: true },
    include: [{ model: FlavorPrice, as: 'prices', where: { SizeId: size.id }, required: false }],
    transaction: t,
  });
  if (flavors.length !== ids.length) throw new Error('Sabor invalido');
  const prices = flavors.map(f => {
    const p = f.prices[0];
    if (!p) throw new Error(`${f.name} nao tem preco para ${size.name}`);
    return Number(p.price);
  });
  let crust = null;
  if (it.crustId) {
    crust = await Crust.findByPk(it.crustId, { transaction: t });
    if (!crust || !crust.active) throw new Error('Borda invalida');
  }
  const names = flavors.map(f => f.name);
  const unit = Math.max(...prices) + (crust ? Number(crust.price) : 0);
  const frac = names.length > 1 ? `${names.length} sabores: ` : '';
  return {
    kind: 'pizza', SizeId: size.id, CrustId: crust ? crust.id : null, flavorNames: names,
    description: `Pizza ${size.name} - ${frac}${names.join(' / ')}${crust ? ` - Borda ${crust.name}` : ''}`,
    unitPrice: unit, kitchen: true,
  };
}

router.post('/', async (req, res) => {
  const {
    orderId,
    type = 'mesa', tableId, customerId, customerName, customerPhone,
    neighborhoodId, neighborhoodName, items = [], notes, address,
    addressNumber, complement, reference, deliveryMode, isNewCustomer,
    changeFor, freeDelivery, customDeliveryFee, paymentMethod, discount,
  } = req.body;
  if (!items.length) return res.status(400).json({ error: 'Pedido sem itens' });
  try {
    const result = await sequelize.transaction(async (t) => {
      let subtotal = 0;
      const rows = [];
      for (const it of items) {
        const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
        let row;
        if (it.kind === 'pizza') {
          row = await buildPizza(it, t);
        } else {
          const p = await Product.findByPk(it.productId, { transaction: t });
          if (!p || !p.active) throw new Error('Produto invalido');
          if (p.stockControl) {
            if (p.stock < qty) throw new Error(`Estoque insuficiente: ${p.name}`);
            await p.update({ stock: p.stock - qty }, { transaction: t });
          }
          row = { kind: 'produto', ProductId: p.id, description: p.name, unitPrice: p.price, kitchen: p.kitchen };
        }
        subtotal += Number(row.unitPrice) * qty;
        rows.push({ ...row, quantity: qty, observations: it.observations });
      }

      // Taxa de entrega vem do bairro (EiChefe: taxaentregaporbairro) ou taxa customizada / grátis
      let fee = 0;
      let resolvedNeighborhood = null;
      if (type === 'delivery' && neighborhoodId) {
        const n = await Neighborhood.findByPk(neighborhoodId, { transaction: t });
        if (!n || !n.active) throw new Error('Bairro invalido');
        resolvedNeighborhood = n;
        fee = Number(n.fee);
      }
      if (type === 'delivery') {
        if (freeDelivery) {
          fee = 0;
        } else if (customDeliveryFee !== undefined && customDeliveryFee !== null && customDeliveryFee !== '') {
          fee = Math.max(0, Number(customDeliveryFee) || 0);
        }
      }

      // Se digitou cliente novo ou alterou dados no formulário de Delivery estilo EiChefe
      let resolvedCustomerId = customerId || null;

      // Se for acréscimo de itens em comanda/pedido aberto ou mesa
      let order = null;
      if (orderId) {
        order = await Order.findOne({
          where: { id: orderId, paid: false },
          include: [Customer],
          transaction: t,
        });
        if (order && order.status === 'cancelado') order = null;
      } else if (type === 'mesa' && tableId) {
        order = await Order.findOne({
          where: { TableId: tableId, paid: false },
          order: [['createdAt', 'DESC']],
          include: [Customer],
          transaction: t,
        });
        if (order && order.status === 'cancelado') order = null;
      }

      if (order && order.CustomerId && !resolvedCustomerId) {
        resolvedCustomerId = order.CustomerId;
      }

      if (type === 'delivery' && !resolvedCustomerId && (customerName || customerPhone)) {
        const newCust = await Customer.create({
          name: (customerName || 'Cliente Delivery').trim(),
          phone: (customerPhone || '').trim(),
          address: (address || '').trim(),
          neighborhood: resolvedNeighborhood ? resolvedNeighborhood.name : (neighborhoodName || ''),
        }, { transaction: t });
        resolvedCustomerId = newCust.id;
      } else if (type === 'delivery' && resolvedCustomerId && (customerName || customerPhone || address)) {
        const existingCust = await Customer.findByPk(resolvedCustomerId, { transaction: t });
        if (existingCust) {
          await existingCust.update({
            name: customerName ? customerName.trim() : existingCust.name,
            phone: customerPhone ? customerPhone.trim() : existingCust.phone,
            address: address ? address.trim() : existingCust.address,
            neighborhood: resolvedNeighborhood ? resolvedNeighborhood.name : existingCust.neighborhood,
          }, { transaction: t });
        }
      } else if (type === 'balcao') {
        const trimmedName = (customerName || (order && order.Customer ? order.Customer.name : '') || (order ? `Balcão #${order.id}` : '')).trim();
        if (!trimmedName && !order) {
          const err = new Error('Nome do cliente é obrigatório para pedidos de balcão');
          err.status = 400;
          throw err;
        }
        if (!resolvedCustomerId && trimmedName) {
          let existingCust = null;
          if (customerPhone && customerPhone.trim()) {
            existingCust = await Customer.findOne({ where: { phone: customerPhone.trim() }, transaction: t });
          }
          if (!existingCust) {
            existingCust = await Customer.findOne({ where: { name: trimmedName }, transaction: t });
          }
          if (existingCust) {
            resolvedCustomerId = existingCust.id;
            if (customerPhone && customerPhone.trim() && !existingCust.phone) {
              await existingCust.update({ phone: customerPhone.trim() }, { transaction: t });
            }
          } else {
            const newCust = await Customer.create({
              name: trimmedName,
              phone: (customerPhone || '').trim(),
            }, { transaction: t });
            resolvedCustomerId = newCust.id;
          }
        }
      }

      const disc = Math.max(0, Number(discount) || 0);
      const stage = await KdsStage.findOne({ where: { active: true }, order: [['position', 'ASC']], transaction: t });

      if (order) {
        const newTotal = Math.max(0, Number(order.totalAmount) + subtotal - disc).toFixed(2);
        const hasKitchen = rows.some(r => r.kitchen);
        const patch = {
          totalAmount: newTotal,
          status: hasKitchen ? 'preparo' : order.status,
        };
        if (type === 'balcao' && resolvedCustomerId && !order.CustomerId) {
          patch.CustomerId = resolvedCustomerId;
        }
        if (notes && notes.trim()) {
          patch.notes = order.notes ? `${order.notes} | ${notes.trim()}` : notes.trim();
        }
        if (order.nfeStatus === 'emitida') {
          patch.nfeStatus = 'nao_emitida';
        }
        await order.update(patch, { transaction: t });
      } else {
        order = await Order.create({
          type, TableId: type === 'mesa' ? tableId || null : null, CustomerId: resolvedCustomerId,
          NeighborhoodId: type === 'delivery' ? neighborhoodId || null : null,
          UserId: req.user.id, deliveryFee: fee,
          totalAmount: Math.max(0, subtotal + fee - disc).toFixed(2),
          paymentMethod: paymentMethod || null,
          notes,
          address: type === 'delivery' ? address : null,
          addressNumber: type === 'delivery' ? (addressNumber || null) : null,
          complement: type === 'delivery' ? (complement || null) : null,
          reference: type === 'delivery' ? (reference || null) : null,
          deliveryMode: type === 'delivery' ? (deliveryMode || 'DISK-ENTREGA') : null,
          discount: disc,
          isNewCustomer: isNewCustomer !== undefined ? Boolean(isNewCustomer) : (!customerId),
          changeFor: type === 'delivery' && changeFor ? changeFor : null,
        }, { transaction: t });
      }

      const now = new Date();
      const newItemIds = [];
      for (const r of rows) {
        const { kitchen, ...data } = r;
        const item = await OrderItem.create({
          ...data, OrderId: order.id,
          status: kitchen ? 'fila' : 'pronto', readyAt: kitchen ? null : now,
        }, { transaction: t });
        if (kitchen && stage) await item.update({ CurrentStageId: stage.id }, { transaction: t });
        newItemIds.push(item.id);
      }
      if (type === 'mesa' && tableId) await Table.update({ status: 'ocupada' }, { where: { id: tableId }, transaction: t });
      await refreshOrderStatus(order.id, t);
      return { order, newItemIds };
    });
    // Imprime e corta automaticamente cada pedido enviado para a impressora Bematech da cozinha
    // E no Delivery, imprime a Conta / Cupom de Entrega no Caixa (EPSON CAIXA) idêntico ao EiChefe
    try {
      const printersRouter = require('./printers');
      if (printersRouter) {
        if (typeof printersRouter.printOrderComanda === 'function') {
          printersRouter.printOrderComanda(result.order.id, req.user?.username || 'ADMIN', { onlyItemIds: result.newItemIds }).catch(() => {});
        }
        if (type === 'delivery' && typeof printersRouter.printOrderConta === 'function') {
          printersRouter.printOrderConta(result.order.id, req.user?.username || 'STEPHANY').catch(() => {});
        }
      }
    } catch (_) {}
    res.status(201).json(await Order.findByPk(result.order.id, { include }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  const o = await Order.findByPk(req.params.id, { include: [{ model: OrderItem, as: 'items' }] });
  if (!o) return res.sendStatus(404);
  const next = req.body.status;
  // Cancelar devolve o estoque dos produtos controlados
  if (next === 'cancelado' && o.status !== 'cancelado') {
    for (const it of o.items) {
      if (!it.ProductId) continue;
      const p = await Product.findByPk(it.ProductId);
      if (p && p.stockControl) await p.update({ stock: p.stock + it.quantity });
    }
    if (o.TableId) await Table.update({ status: 'livre' }, { where: { id: o.TableId } });
  }
  const patch = { status: next };
  if (next === 'entregue' && o.type === 'delivery' && !o.deliveredAt) patch.deliveredAt = new Date();
  await o.update(patch);
  if (next === 'entregue' && o.TableId && o.paid) {
    await Table.update({ status: 'livre' }, { where: { id: o.TableId } });
  }
  res.json(o);
});

// Saiu para entrega com entregador (EiChefe: diskentrega.entregador / saida)
router.post('/:id/dispatch', async (req, res) => {
  const o = await Order.findByPk(req.params.id, { include: [{ model: OrderItem, as: 'items' }] });
  if (!o || o.type !== 'delivery') return res.status(400).json({ error: 'Pedido de delivery invalido' });
  const c = await Courier.findByPk(req.body.courierId);
  if (!c) return res.status(400).json({ error: 'Escolha um entregador' });
  const now = new Date();
  for (const it of o.items || []) {
    if (it.status !== 'pronto') await it.update({ status: 'pronto', readyAt: now });
  }
  await o.update({ status: 'saiu', CourierId: c.id, departedAt: o.departedAt || now });
  res.json(await Order.findByPk(o.id, { include }));
});

// Atualiza Troco Para no card de Disk-Entrega (EiChefe: abrirJanelaTroco)
router.patch('/:id/troco', async (req, res) => {
  const o = await Order.findByPk(req.params.id);
  if (!o) return res.sendStatus(404);
  const changeFor = req.body.changeFor ? Number(req.body.changeFor) : null;
  await o.update({ changeFor });
  res.json(await Order.findByPk(o.id, { include }));
});

router.post('/:id/delivered', async (req, res) => {
  const o = await Order.findByPk(req.params.id, { include });
  if (!o) return res.sendStatus(404);
  const patch = { status: 'entregue', deliveredAt: o.deliveredAt || new Date() };
  if (!o.paid) {
    patch.paid = true;
    patch.paidAmount = o.totalAmount;
  }
  await o.update(patch);
  if (o.TableId && o.paid) await Table.update({ status: 'livre' }, { where: { id: o.TableId } });

  // Emissão Automática de NFC-e na finalização da entrega
  if ((patch.paid || o.paid) && o.nfeStatus !== 'emitida') {
    try {
      const nfeService = require('../services/nfe');
      const updated = await Order.findByPk(o.id, { include });
      const nfeResult = await nfeService.emitNfeFile(updated, {
        customerCpf: updated.customerCpf,
        customerName: updated.customerName || updated.Customer?.name,
      });
      await updated.update({
        nfeStatus: 'emitida',
        nfeFile: nfeResult.filename,
      });
      console.log(`[Fiscal Auto] NFC-e emitida automaticamente na entrega #${updated.id} (${nfeResult.filename})`);
    } catch (nfeErr) {
      console.error(`[Fiscal Auto] Erro ao emitir NFC-e na entrega #${o.id}:`, nfeErr.message);
    }
  }

  res.json(await Order.findByPk(o.id, { include }));
});

// Salva numero de pessoas na divisao da mesa (EiChefe: vendadivisao.dividirPor)
router.patch('/:id/split', async (req, res) => {
  const o = await Order.findByPk(req.params.id);
  if (!o) return res.sendStatus(404);
  const splitCount = Math.max(1, parseInt(req.body.splitCount, 10) || 1);
  await o.update({ splitCount });
  res.json(await Order.findByPk(o.id, { include }));
});

// Divisao de item especifico por cotas/pessoas (EiChefe: ModalDivisaoValores / vendadivisao.dividirItem)
router.post('/:id/items/:itemId/split', required(['admin', 'caixa', 'garcom']), async (req, res) => {
  try {
    const o = await Order.findByPk(req.params.id, {
      include: [{ model: OrderItem, as: 'items' }],
    });
    if (!o) return res.status(404).json({ error: 'Pedido nao encontrado' });
    const item = (o.items || []).find(x => x.id === Number(req.params.itemId));
    if (!item) return res.status(404).json({ error: 'Item nao encontrado' });

    const avail = +(Number(item.quantity) - Number(item.paidQuantity || 0)).toFixed(2);
    if (avail <= 0.009) return res.status(400).json({ error: 'Item ja esta totalmente pago' });

    const rawSplitQty = parseInt(req.body.splitQty, 10);
    const splitQty = Math.max(1, Math.min(avail, isNaN(rawSplitQty) ? 1 : rawSplitQty));
    const rawSplitPeople = parseInt(req.body.splitPeople, 10);
    const splitPeople = Math.max(2, Math.min(99, isNaN(rawSplitPeople) ? 2 : rawSplitPeople));

    const unitPrice = Number(item.unitPrice);
    const partAmount = +((unitPrice * splitQty) / splitPeople).toFixed(2);
    const partQty = +(splitQty / splitPeople).toFixed(4);

    item.splitInfo = {
      splitQty,
      splitPeople,
      unitPrice,
      partAmount,
      partQty,
      createdAt: new Date().toISOString(),
    };
    await item.save();

    res.json(await Order.findByPk(o.id, { include }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancelar divisao de item especifico (EiChefe: cancelarDivisao)
router.delete('/:id/items/:itemId/split', required(['admin', 'caixa', 'garcom']), async (req, res) => {
  try {
    const o = await Order.findByPk(req.params.id, {
      include: [{ model: OrderItem, as: 'items' }],
    });
    if (!o) return res.status(404).json({ error: 'Pedido nao encontrado' });
    const item = (o.items || []).find(x => x.id === Number(req.params.itemId));
    if (!item) return res.status(404).json({ error: 'Item nao encontrado' });

    item.splitInfo = null;
    await item.save();

    res.json(await Order.findByPk(o.id, { include }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancelar item especifico da mesa/pedido (EiChefe: cancelarProdutos.tpl / alterarProdutos.tpl)
router.post('/:id/items/:itemId/cancel', required(['admin', 'caixa', 'garcom']), async (req, res) => {
  try {
    const o = await Order.findByPk(req.params.id, {
      include: [
        { model: OrderItem, as: 'items', include: [Product] },
        Table, Customer,
      ],
    });
    if (!o) return res.status(404).json({ error: 'Pedido nao encontrado' });
    if (o.status === 'cancelado') return res.status(400).json({ error: 'Pedido ja esta cancelado' });

    const item = (o.items || []).find(x => x.id === Number(req.params.itemId));
    if (!item) return res.status(404).json({ error: 'Item nao encontrado neste pedido' });
    if (item.status === 'cancelado') return res.status(400).json({ error: 'Item ja esta cancelado' });

    const totalQty = Number(item.quantity);
    const paidQty = Number(item.paidQuantity || 0);
    const maxCancelable = Math.max(0, +(totalQty - paidQty).toFixed(2));
    if (maxCancelable <= 0.009) {
      return res.status(400).json({ error: 'Nao e possivel cancelar um item que ja foi 100% pago. Estorne o pagamento primeiro.' });
    }

    const rawQty = parseInt(req.body.quantity, 10);
    const qtyToCancel = Math.max(1, Math.min(maxCancelable, isNaN(rawQty) ? 1 : rawQty));

    const reason = (req.body.reason ? String(req.body.reason).trim() : 'Cliente desistiu');
    const notes = req.body.notes ? String(req.body.notes).trim() : '';
    const fullReason = notes ? `${reason} (${notes})` : reason;
    const cancelledBy = req.user ? (req.user.name || req.user.username) : 'Operador';
    const now = new Date();

    await sequelize.transaction(async (t) => {
      // Devolve estoque se for produto controlado
      if (item.ProductId) {
        const prod = await Product.findByPk(item.ProductId, { transaction: t });
        if (prod && prod.stockControl) {
          await prod.update({ stock: prod.stock + qtyToCancel }, { transaction: t });
        }
      }

      if (qtyToCancel === totalQty) {
        // Cancelamento total da linha
        await item.update({
          status: 'cancelado',
          cancelledAt: now,
          cancelledReason: fullReason,
          cancelledBy,
        }, { transaction: t });
      } else {
        // Cancelamento parcial (reduz a quantidade do item ativo e registra cota cancelada)
        await item.update({
          quantity: totalQty - qtyToCancel,
        }, { transaction: t });

        await OrderItem.create({
          OrderId: o.id,
          kind: item.kind,
          ProductId: item.ProductId,
          SizeId: item.SizeId,
          CrustId: item.CrustId,
          description: item.description,
          flavorNames: item.flavorNames,
          quantity: qtyToCancel,
          unitPrice: item.unitPrice,
          observations: item.observations,
          status: 'cancelado',
          cancelledAt: now,
          cancelledReason: fullReason,
          cancelledBy,
        }, { transaction: t });
      }

      // Recalcula totalAmount do pedido com base nos itens ativos
      const allItems = await OrderItem.findAll({ where: { OrderId: o.id }, transaction: t });
      const activeItems = allItems.filter(x => x.status !== 'cancelado');
      const newSubtotal = activeItems.reduce((acc, x) => acc + (Number(x.quantity) * Number(x.unitPrice)), 0);
      const deliveryFee = (o.type === 'delivery' && !o.freeDelivery) ? Number(o.deliveryFee || 0) : 0;
      const discount = Number(o.discount || 0);
      const newTotal = Math.max(0, +(newSubtotal + deliveryFee - discount).toFixed(2));

      const patch = { totalAmount: newTotal };

      // Se nao restar nenhum item ativo e nao tiver saldo pago, cancela pedido e libera mesa
      if (activeItems.length === 0 && Number(o.paidAmount || 0) <= 0.01) {
        patch.status = 'cancelado';
        if (o.TableId) {
          await Table.update({ status: 'livre' }, { where: { id: o.TableId }, transaction: t });
        }
      }
      await o.update(patch, { transaction: t });
    });

    let printJobs = [];
    if (req.body.printCancellation) {
      try {
        const printersRouter = require('./printers');
        if (typeof printersRouter.printOrderCancelamento === 'function') {
          printJobs = await printersRouter.printOrderCancelamento(o.id, item.id, qtyToCancel, fullReason, cancelledBy);
        }
      } catch (printErr) {
        console.warn('Aviso: falha ao imprimir comanda de cancelamento:', printErr.message);
      }
    }

    const updatedOrder = await Order.findByPk(o.id, { include });
    res.json({
      ok: true,
      message: `Item "${item.description}" (${qtyToCancel}x) cancelado com sucesso!`,
      order: updatedOrder,
      printJobs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recebimento parcial (por itens selecionados, por divisao de pessoas ou valor avulso) ou total
router.post('/:id/pay', required(['admin', 'caixa', 'garcom']), async (req, res) => {
  try {
    await sequelize.transaction(async (t) => {
      const o = await Order.findByPk(req.params.id, {
        include: [{ model: OrderItem, as: 'items' }, { model: OrderPayment, as: 'payments' }],
        transaction: t,
      });
      if (!o) { const err = new Error('Pedido nao encontrado'); err.status = 404; throw err; }
      if (o.status === 'cancelado') throw new Error('Pedido cancelado');

      const total = Number(o.totalAmount);
      const alreadyPaid = Number(o.paidAmount || 0);
      const remaining = Math.max(0, +(total - alreadyPaid).toFixed(2));
      if (remaining <= 0.009) throw new Error('Pedido ja esta totalmente pago');

      const payerName = req.body.payerName ? String(req.body.payerName).trim() : null;
      const selItems = Array.isArray(req.body.items) ? req.body.items : [];

      // Suporta mltiplas formas de pagamento simultneas (EiChefe fechaVenda/pagar.tpl) ou forma nica
      const paymentList = Array.isArray(req.body.payments) && req.body.payments.length > 0
        ? req.body.payments.map(p => ({
            paymentMethod: p.paymentMethod || 'Dinheiro',
            amount: +Number(p.amount || 0).toFixed(2),
          })).filter(p => p.amount > 0)
        : null;

      let amount = req.body.amount !== undefined && req.body.amount !== null && req.body.amount !== ''
        ? Number(req.body.amount)
        : null;

      const paidItemsSummary = [];
      if (selItems.length > 0) {
        let calc = 0;
        for (const sel of selItems) {
          const item = o.items.find(x => x.id === Number(sel.orderItemId));
          if (!item) throw new Error('Item invalido na selecao');
          const qtyToPay = Number(sel.quantity);
          if (!qtyToPay || qtyToPay <= 0) continue;
          const avail = +(Number(item.quantity) - Number(item.paidQuantity || 0)).toFixed(4);
          if (qtyToPay - avail > 0.02) {
            throw new Error(`Quantidade selecionada excede o pendente em "${item.description}"`);
          }
          const sub = (sel.amount !== undefined && sel.amount !== null && !isNaN(Number(sel.amount)))
            ? +Number(sel.amount).toFixed(2)
            : +(qtyToPay * Number(item.unitPrice)).toFixed(2);
          calc += sub;
          const newPaidQty = +(Number(item.paidQuantity || 0) + qtyToPay).toFixed(4);
          const finalPaidQty = (Number(item.quantity) - newPaidQty <= 0.02) ? Number(item.quantity) : +newPaidQty.toFixed(2);
          await item.update({
            paidQuantity: finalPaidQty,
          }, { transaction: t });
          paidItemsSummary.push({
            orderItemId: item.id,
            description: item.description,
            quantity: qtyToPay,
            unitPrice: Number(item.unitPrice),
            subtotal: sub,
          });
        }
        if (amount === null && !paymentList) amount = +calc.toFixed(2);
      }

      if (paymentList && paymentList.length > 0) {
        const totalBatch = +paymentList.reduce((acc, p) => acc + p.amount, 0).toFixed(2);
        if (totalBatch - remaining > 0.05) {
          throw new Error(`Valor total informado (R$ ${totalBatch.toFixed(2)}) maior que o saldo restante (R$ ${remaining.toFixed(2)})`);
        }
        for (let i = 0; i < paymentList.length; i++) {
          const p = paymentList[i];
          await OrderPayment.create({
            OrderId: o.id,
            amount: p.amount,
            paymentMethod: p.paymentMethod,
            payerName,
            itemsJson: i === 0 ? paidItemsSummary : [],
          }, { transaction: t });
        }
        amount = totalBatch;
      } else {
        const method = req.body.paymentMethod || 'Dinheiro';
        if (amount === null) {
          // Sem itens e sem valor explicito: quita o restante inteiro e marca todos os itens como pagos
          amount = remaining;
          for (const item of o.items) {
            const avail = +(Number(item.quantity) - Number(item.paidQuantity || 0)).toFixed(2);
            if (avail > 0) {
              await item.update({ paidQuantity: item.quantity }, { transaction: t });
              paidItemsSummary.push({
                orderItemId: item.id,
                description: item.description,
                quantity: avail,
                unitPrice: Number(item.unitPrice),
                subtotal: +(avail * Number(item.unitPrice)).toFixed(2),
              });
            }
          }
        }

        amount = +Number(amount).toFixed(2);
        if (isNaN(amount) || amount <= 0) throw new Error('Informe um valor valido para receber');
        if (amount - remaining > 0.05) {
          throw new Error(`Valor (R$ ${amount.toFixed(2)}) maior que o saldo restante (R$ ${remaining.toFixed(2)})`);
        }
        if (amount > remaining) amount = remaining;

        await OrderPayment.create({
          OrderId: o.id,
          amount,
          paymentMethod: method,
          payerName,
          itemsJson: paidItemsSummary,
        }, { transaction: t });
      }

      const newPaid = +(alreadyPaid + amount).toFixed(2);
      const isFullyPaid = total - newPaid <= 0.02;

      if (isFullyPaid) {
        for (const item of o.items) {
          if (Number(item.paidQuantity || 0) < Number(item.quantity)) {
            await item.update({ paidQuantity: item.quantity }, { transaction: t });
          }
        }
      }

      const allPayments = await OrderPayment.findAll({ where: { OrderId: o.id }, transaction: t });
      const methodsUsed = [...new Set(allPayments.map(p => p.paymentMethod))];
      const patch = {
        paidAmount: isFullyPaid ? total : newPaid,
        paid: isFullyPaid,
        paymentMethod: methodsUsed.join(' + '),
      };
      if (isFullyPaid) {
        if (o.type !== 'delivery' && o.status !== 'cancelado') {
          patch.status = 'entregue';
        }
        for (const item of (o.items || [])) {
          if (Number(item.paidQuantity || 0) < Number(item.quantity)) {
            await item.update({ paidQuantity: item.quantity }, { transaction: t });
          }
        }
        if (o.TableId) {
          await Table.update({ status: 'livre' }, { where: { id: o.TableId }, transaction: t });
        }
      }
      await o.update(patch, { transaction: t });
    });

    const updatedOrder = await Order.findByPk(req.params.id, { include });

    // Emissão Automática de NFC-e após o pagamento total da conta / pedido / mesa
    if (updatedOrder && updatedOrder.paid) {
      const autoNfe = req.body.autoNfe !== false; // Padrão: automático
      if (autoNfe && updatedOrder.nfeStatus !== 'emitida') {
        try {
          const nfeService = require('../services/nfe');
          const customerCpf = req.body.cpf || req.body.customerCpf || updatedOrder.customerCpf || null;
          const customerName = req.body.name || req.body.customerName || req.body.payerName || updatedOrder.customerName || updatedOrder.Customer?.name || null;

          const nfeResult = await nfeService.emitNfeFile(updatedOrder, {
            customerCpf,
            customerName,
          });

          await updatedOrder.update({
            nfeStatus: 'emitida',
            nfeFile: nfeResult.filename,
            ...(customerCpf ? { customerCpf } : {}),
            ...(customerName ? { customerName } : {}),
          });
          console.log(`[Fiscal Auto] NFC-e emitida automaticamente para Pedido #${updatedOrder.id} (${nfeResult.filename})`);
        } catch (nfeErr) {
          console.error(`[Fiscal Auto] Erro ao emitir NFC-e automática para Pedido #${updatedOrder.id}:`, nfeErr.message);
        }
      }
    }

    res.json(updatedOrder);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// Remover pagamento parcial / estorno (EiChefe valoresPagos.tpl apagarFormaPagamento)
router.delete('/:id/payments/:paymentId', required(['admin', 'caixa']), async (req, res) => {
  try {
    const o = await Order.findByPk(req.params.id, {
      include: [
        { model: OrderItem, as: 'items' },
        { model: OrderPayment, as: 'payments' },
        Table, Customer,
      ],
    });
    if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
    const p = await OrderPayment.findOne({ where: { id: req.params.paymentId, OrderId: o.id } });
    if (!p) return res.status(404).json({ error: 'Pagamento no encontrado' });

    await sequelize.transaction(async (t) => {
      const itemsJson = p.itemsJson || [];
      for (const itData of itemsJson) {
        const it = (o.items || []).find(x => x.id === itData.orderItemId);
        if (it) {
          const newQty = Math.max(0, +(Number(it.paidQuantity || 0) - Number(itData.quantity)).toFixed(2));
          await it.update({ paidQuantity: newQty }, { transaction: t });
        }
      }

      const pAmount = Number(p.amount || 0);
      const newPaid = Math.max(0, +(Number(o.paidAmount || 0) - pAmount).toFixed(2));
      const remainingPayments = (o.payments || []).filter(x => x.id !== p.id);
      const methodsUsed = [...new Set(remainingPayments.map(x => x.paymentMethod))];

      await p.destroy({ transaction: t });

      await o.update({
        paidAmount: newPaid,
        paid: false,
        paymentMethod: methodsUsed.length ? methodsUsed.join(' + ') : null,
      }, { transaction: t });

      if (o.TableId) {
        await Table.update({ status: 'ocupada' }, { where: { id: o.TableId }, transaction: t });
      }
    });

    const updated = await Order.findByPk(o.id, { include });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reabrir Mesa / Venda Fechada (estilo reabrirVenda do EiChefe)
router.post('/:id/reopen', required(['admin', 'caixa', 'garcom']), async (req, res) => {
  try {
    const o = await Order.findByPk(req.params.id, {
      include: [
        { model: OrderItem, as: 'items' },
        { model: OrderPayment, as: 'payments' },
        Table, Customer,
      ],
    });
    if (!o) return res.status(404).json({ error: 'Pedido não encontrado' });

    let targetTableId = req.body.tableId ? Number(req.body.tableId) : o.TableId;

    if (o.type === 'mesa') {
      if (!targetTableId) {
        return res.status(400).json({ error: 'Informe a mesa para reabrir este atendimento' });
      }
      const targetTable = await Table.findByPk(targetTableId);
      if (!targetTable) return res.status(404).json({ error: 'Mesa não encontrada' });

      // Verifica se a mesa está ocupada por OUTRO pedido aberto
      const otherActiveOrder = await Order.findOne({
        where: {
          type: 'mesa',
          TableId: targetTable.id,
          paid: false,
          status: { [Op.ne]: 'cancelado' },
          id: { [Op.ne]: o.id },
        },
      });

      if (otherActiveOrder) {
        return res.status(400).json({
          error: `A Mesa #${targetTable.number} já está ocupada pelo Pedido #${otherActiveOrder.id}. Escolha outra mesa livre para reabrir este pedido.`,
          occupied: true,
          currentTableNumber: targetTable.number,
        });
      }

      await targetTable.update({ status: 'ocupada' });
      targetTableId = targetTable.id;
    }

    // Se o pedido estava cancelado, re-reserva o estoque
    if (o.status === 'cancelado') {
      for (const it of o.items || []) {
        if (!it.ProductId) continue;
        const p = await Product.findByPk(it.ProductId);
        if (p && p.stockControl) {
          await p.update({ stock: Math.max(0, p.stock - it.quantity) });
        }
      }
    }

    const resetPayments = req.body.resetPayments === true;
    if (resetPayments) {
      await OrderPayment.destroy({ where: { OrderId: o.id } });
      for (const it of o.items || []) {
        await it.update({ paidQuantity: 0 });
      }
      await o.update({
        paid: false,
        paidAmount: 0,
        paymentMethod: null,
        status: 'em_preparo',
        TableId: o.type === 'mesa' ? targetTableId : null,
      });
    } else {
      // Mantém os pagamentos anteriores registrados, mas reabre a comanda para novos lançamentos
      await o.update({
        paid: false,
        status: 'em_preparo',
        TableId: o.type === 'mesa' ? targetTableId : null,
      });
    }

    const updated = await Order.findByPk(o.id, { include });
    res.json({ ok: true, message: `Pedido #${o.id} reaberto com sucesso!`, order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excluir / Remover Pedido permanentemente
router.delete('/:id', required(['admin', 'caixa']), async (req, res) => {
  try {
    const o = await Order.findByPk(req.params.id, {
      include: [{ model: OrderItem, as: 'items' }],
    });
    if (!o) return res.status(404).json({ error: 'Pedido não encontrado' });

    const orderId = o.id;
    const tableId = o.TableId;
    const orderStatus = o.status;

    // Se o pedido não estava cancelado, devolve o estoque dos produtos
    if (orderStatus !== 'cancelado') {
      for (const it of o.items || []) {
        if (!it.ProductId) continue;
        const p = await Product.findByPk(it.ProductId);
        if (p && p.stockControl) {
          await p.update({ stock: p.stock + it.quantity });
        }
      }
    }

    // Exclui impressões vinculadas
    try {
      const { PrintJob } = require('../models');
      if (PrintJob) await PrintJob.destroy({ where: { order_id: orderId } });
    } catch (_) {}

    // Exclui pedido
    await o.destroy();

    // Se tinha mesa, atualiza para livre se não houver outro pedido aberto
    if (tableId) {
      const otherActive = await Order.findOne({
        where: {
          TableId: tableId,
          paid: false,
          status: { [Op.ne]: 'cancelado' },
        },
      });
      if (!otherActive) {
        await Table.update({ status: 'livre' }, { where: { id: tableId } });
      }
    }

    res.json({ ok: true, message: `Pedido #${orderId} excluído com sucesso!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
