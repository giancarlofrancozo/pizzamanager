const express = require('express');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const {
  sequelize, User, Category, Product, Table, Size, Flavor, FlavorPrice, Crust,
  Order, OrderItem,
} = require('../models');
const { sign } = require('../middleware/auth');
const printersRouter = require('./printers');

const router = express.Router();

// Helper para ler parâmetros tanto de body (JSON ou form-urlencoded) quanto de query
function getParams(req) {
  return { ...(req.query || {}), ...(req.body || {}) };
}

// -------------------------------------------------------------
// ROTA 1: ConfigAndroid.php
// -------------------------------------------------------------
async function handleConfigAndroid(req, res) {
  const p = getParams(req);
  const action = p.action || req.params.action;

  console.log(`[APK COMPAT] ConfigAndroid -> action: ${action}`, p);

  switch (action) {
    case 'getStatusIpService':
    case 'validaIp':
      return res.json({ status: 'OK', codigo: 1, mensagem: 'Conectado com sucesso ao EiChefe Gestão' });

    case 'getConfigEiChefeApp':
    case 'getConfigValorPizza':
    case 'getConfigValorBorda':
    case 'getConfigValorAcrescimoPizza':
    case 'getConfigAtendimentoRapido':
    case 'getConfigCardapios':
    case 'getConfigTipoVenda':
    case 'getConfigVenderSemEstoque':
    case 'getConfigNumeroPessoasMesa':
      return res.json({ status: 'OK', codigo: 1, valor: 'maior', ativo: true });

    case 'getBalcaoNoEichefeGarcom':
      return res.send('s');

    case 'getAtualizacao':
      return res.json({ status: 'OK', versao: '2.0.0', atualizado: true });

    case 'recebeErros':
      return res.json({ status: 'OK', codigo: 1 });

    case 'atualizaDados': {
      try {
        const [categories, products, sizes, flavors, crusts] = await Promise.all([
          Category.findAll({ order: [['name', 'ASC']] }),
          Product.findAll({ where: { active: true }, order: [['name', 'ASC']] }),
          Size.findAll({ where: { active: true }, order: [['maxFlavors', 'ASC']] }),
          Flavor.findAll({
            where: { active: true },
            include: [{ model: FlavorPrice, as: 'prices' }],
            order: [['name', 'ASC']],
          }),
          Crust.findAll({ where: { active: true }, order: [['price', 'ASC']] }),
        ]);

        return res.json({
          status: 'OK',
          codigo: 1,
          categorias: categories.map(c => ({ id: c.id, nome: c.name })),
          produtos: products.map(p => ({
            id: p.id,
            nome: p.name,
            preco: Number(p.price),
            idCategoria: p.CategoryId,
            controlaEstoque: p.stockControl ? 1 : 0,
            estoque: p.stock,
          })),
          tamanhosPizza: sizes.map(s => ({
            id: s.id,
            nome: s.name,
            maxSabores: s.maxFlavors,
          })),
          sabores: flavors.map(f => ({
            id: f.id,
            nome: f.name,
            descricao: f.description,
            tipo: f.kind,
            precos: (f.prices || []).map(pr => ({ idTamanho: pr.SizeId, preco: Number(pr.price) })),
          })),
          bordas: crusts.map(c => ({
            id: c.id,
            nome: c.name,
            preco: Number(c.price),
          })),
        });
      } catch (err) {
        return res.status(500).json({ status: 'ERRO', mensagem: err.message });
      }
    }

    default:
      return res.json({ status: 'OK', codigo: 1 });
  }
}

// -------------------------------------------------------------
// ROTA 2: PedidoWorker.php
// -------------------------------------------------------------
async function handlePedidoWorker(req, res) {
  const p = getParams(req);
  const action = p.action || req.params.action;

  console.log(`[APK COMPAT] PedidoWorker -> action: ${action}`, p);

  switch (action) {
    case 'login': {
      const username = (p.usuario || '').toLowerCase().trim();
      const password = p.senha || '';

      const user = await User.findOne({ where: { username } });
      if (!user) {
        return res.status(401).json({ status: 'ERRO', codigo: 0, mensagem: 'Usuário não encontrado' });
      }

      let valid = false;
      if (password && (await bcrypt.compare(String(password), user.passwordHash))) {
        valid = true;
      } else if (user.pin && String(password).trim() === user.pin.trim()) {
        valid = true;
      }

      if (!valid) {
        return res.status(401).json({ status: 'ERRO', codigo: 0, mensagem: 'Senha / PIN incorreto' });
      }

      const token = sign(user);
      return res.json({
        status: 'OK',
        codigo: 1,
        id: user.id,
        idFuncionario: user.id,
        codigoFuncionario: user.id,
        nome: user.name || user.username,
        cargo: user.cargoNome || user.role,
        token,
      });
    }

    case 'getStatusMesas':
    case 'getMesasOcupadas': {
      try {
        const tables = await Table.findAll({ order: [['number', 'ASC']] });
        const openOrders = await Order.findAll({
          where: { type: 'mesa', paid: false, status: { [Op.ne]: 'cancelado' } },
        });

        const orderMap = new Map();
        for (const ord of openOrders) {
          if (ord.TableId) orderMap.set(ord.TableId, ord);
        }

        const list = tables.map(t => {
          const ord = orderMap.get(t.id);
          const isOcupada = Boolean(ord);
          return {
            id: t.id,
            mesa: t.number,
            numero: t.number,
            status: isOcupada ? 'O' : 'L', // O = Ocupada, L = Livre
            situacao: isOcupada ? 'ocupada' : 'livre',
            codigoVenda: ord ? ord.id : null,
            total: ord ? Number(ord.totalAmount) : 0,
          };
        });

        return res.json(list);
      } catch (err) {
        return res.status(500).json({ status: 'ERRO', mensagem: err.message });
      }
    }

    case 'getStatusMesa':
    case 'getDetalhesVendaMesa': {
      const mesaNum = parseInt(p.mesa || p.numeroMesa, 10);
      const table = await Table.findOne({ where: { number: mesaNum } });
      if (!table) return res.status(404).json({ status: 'ERRO', mensagem: 'Mesa não encontrada' });

      const ord = await Order.findOne({
        where: { TableId: table.id, paid: false, status: { [Op.ne]: 'cancelado' } },
        include: [{ model: OrderItem, as: 'items', include: [Product] }],
        order: [['id', 'DESC']],
      });

      if (!ord) {
        return res.json({
          status: 'L',
          situacao: 'livre',
          mesa: mesaNum,
          itens: [],
          total: 0,
        });
      }

      return res.json({
        status: 'O',
        situacao: 'ocupada',
        mesa: mesaNum,
        codigoVenda: ord.id,
        total: Number(ord.totalAmount),
        itens: (ord.items || []).filter(it => it.status !== 'cancelado').map(it => ({
          id: it.id,
          codigo: it.id,
          descricao: it.description,
          quantidade: Number(it.quantity),
          precoUnitario: Number(it.unitPrice),
          total: Number(it.quantity) * Number(it.unitPrice),
          observacao: it.observations || '',
          status: it.status,
        })),
      });
    }

    case 'recebeItens': {
      try {
        const mesaNum = parseInt(p.numeroMesa || p.mesa, 10);
        if (!mesaNum) return res.status(400).json({ status: 'ERRO', mensagem: 'Número da mesa inválido' });

        const table = await Table.findOne({ where: { number: mesaNum } });
        if (!table) return res.status(404).json({ status: 'ERRO', mensagem: `Mesa ${mesaNum} não existe` });

        // itensJson pode vir como string JSON
        let itemsList = [];
        if (typeof p.itensJson === 'string') {
          try { itemsList = JSON.parse(p.itensJson); } catch (_) { itemsList = []; }
        } else if (Array.isArray(p.itensJson)) {
          itemsList = p.itensJson;
        }

        if (!itemsList.length && p.itens) {
          try { itemsList = JSON.parse(p.itens); } catch (_) {}
        }

        if (!itemsList.length) {
          return res.status(400).json({ status: 'ERRO', mensagem: 'Nenhum item recebido' });
        }

        // Converte itens do formato APK para o formato do PizzaManager
        const formattedItems = [];
        for (const raw of itemsList) {
          if (raw.jsonPizza) {
            // Pizza com frações
            const pz = typeof raw.jsonPizza === 'string' ? JSON.parse(raw.jsonPizza) : raw.jsonPizza;
            const flavorIds = (pz.sabores || []).map(s => s.idSabor || s.id || s);
            formattedItems.push({
              kind: 'pizza',
              sizeId: pz.idTamanho || pz.idPedaco || 1,
              flavorIds,
              crustId: pz.idBorda || null,
              quantity: raw.qtde || raw.quantidade || 1,
              observations: pz.observacoes || raw.observacao || '',
            });
          } else if (raw.codigoProduto || raw.idProduto || raw.id) {
            // Produto simples (bebida, porção, etc.)
            formattedItems.push({
              kind: 'produto',
              productId: raw.codigoProduto || raw.idProduto || raw.id,
              quantity: raw.qtde || raw.quantidade || 1,
              observations: raw.observacao || raw.obs || '',
            });
          }
        }

        // Executa inserção usando transaction idêntica ao routes/orders.js
        const userId = parseInt(p.idFuncionario, 10) || 1;
        const result = await sequelize.transaction(async (t) => {
          let subtotal = 0;
          const rows = [];
          for (const it of formattedItems) {
            const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
            let row;
            if (it.kind === 'pizza') {
              const size = await Size.findByPk(it.sizeId, { transaction: t });
              const flavors = await Flavor.findAll({
                where: { id: it.flavorIds },
                include: [{ model: FlavorPrice, as: 'prices', where: { SizeId: size.id }, required: false }],
                transaction: t,
              });
              const prices = flavors.map(f => Number(f.prices?.[0]?.price || 0));
              let crust = null;
              if (it.crustId) crust = await Crust.findByPk(it.crustId, { transaction: t });
              const unit = (prices.length ? Math.max(...prices) : 40) + (crust ? Number(crust.price) : 0);
              const names = flavors.map(f => f.name);
              row = {
                kind: 'pizza', SizeId: size.id, CrustId: crust?.id || null, flavorNames: names,
                description: `Pizza ${size.name} - ${names.join(' / ')}${crust ? ` - Borda ${crust.name}` : ''}`,
                unitPrice: unit, kitchen: true,
              };
            } else {
              const prod = await Product.findByPk(it.productId, { transaction: t });
              if (prod && prod.stockControl && prod.stock >= qty) {
                await prod.update({ stock: prod.stock - qty }, { transaction: t });
              }
              row = {
                kind: 'produto', ProductId: prod.id, description: prod.name,
                unitPrice: prod.price, kitchen: prod.kitchen,
              };
            }
            subtotal += Number(row.unitPrice) * qty;
            rows.push({ ...row, quantity: qty, observations: it.observations });
          }

          let order = await Order.findOne({
            where: { TableId: table.id, paid: false, status: { [Op.ne]: 'cancelado' } },
            transaction: t,
          });

          if (order) {
            await order.update({
              totalAmount: (Number(order.totalAmount) + subtotal).toFixed(2),
              status: rows.some(r => r.kitchen) ? 'preparo' : order.status,
            }, { transaction: t });
          } else {
            order = await Order.create({
              type: 'mesa', TableId: table.id, UserId: userId,
              totalAmount: subtotal.toFixed(2), notes: p.observacaoGeral || '',
            }, { transaction: t });
          }

          const newItemIds = [];
          for (const r of rows) {
            const { kitchen, ...data } = r;
            const item = await OrderItem.create({
              ...data, OrderId: order.id, status: kitchen ? 'fila' : 'pronto',
            }, { transaction: t });
            newItemIds.push(item.id);
          }

          await Table.update({ status: 'ocupada' }, { where: { id: table.id }, transaction: t });
          return { order, newItemIds };
        });

        // Imprime automaticamente comanda de produção na Bematech Cozinha
        try {
          if (typeof printersRouter.printOrderComanda === 'function') {
            const user = await User.findByPk(userId);
            printersRouter.printOrderComanda(result.order.id, user?.username || 'GARCOM', {
              onlyItemIds: result.newItemIds,
            }).catch(() => {});
          }
        } catch (_) {}

        return res.json({
          status: 'OK',
          codigo: 1,
          mensagem: 'Itens lançados e enviados para a comanda com sucesso',
          codigoVenda: result.order.id,
        });
      } catch (err) {
        return res.status(500).json({ status: 'ERRO', mensagem: err.message });
      }
    }

    case 'imprimirVenda':
    case 'getConta': {
      try {
        const mesaNum = parseInt(p.mesa || p.numeroMesa, 10);
        let orderId = p.codigoVenda || p.venda;

        if (!orderId && mesaNum) {
          const table = await Table.findOne({ where: { number: mesaNum } });
          if (table) {
            const ord = await Order.findOne({
              where: { TableId: table.id, paid: false, status: { [Op.ne]: 'cancelado' } },
            });
            if (ord) orderId = ord.id;
          }
        }

        if (!orderId) return res.status(404).json({ status: 'ERRO', mensagem: 'Pedido não encontrado para impressão' });

        if (typeof printersRouter.printOrderConta === 'function') {
          const user = await User.findByPk(p.idFuncionario || 1);
          await printersRouter.printOrderConta(orderId, user?.username || 'GARCOM');
        }

        return res.json({ status: 'OK', codigo: 1, mensagem: 'Conferência de conta enviada para a impressora' });
      } catch (err) {
        return res.status(500).json({ status: 'ERRO', mensagem: err.message });
      }
    }

    case 'fecharMesa': {
      return res.json({ status: 'OK', codigo: 1, mensagem: 'Mesa sinalizada para fechamento no caixa' });
    }

    case 'transfereMesa': {
      try {
        const fromMesa = parseInt(p.fromMesaOuCartao || p.fromMesa, 10);
        const toMesa = parseInt(p.toMesa, 10);

        const fromTable = await Table.findOne({ where: { number: fromMesa } });
        const toTable = await Table.findOne({ where: { number: toMesa } });

        if (!fromTable || !toTable) return res.status(400).json({ status: 'ERRO', mensagem: 'Mesa inválida' });

        const openOrder = await Order.findOne({
          where: { TableId: fromTable.id, paid: false, status: { [Op.ne]: 'cancelado' } },
        });

        if (!openOrder) return res.status(400).json({ status: 'ERRO', mensagem: 'Mesa de origem sem pedidos em aberto' });

        await openOrder.update({ TableId: toTable.id });
        await fromTable.update({ status: 'livre' });
        await toTable.update({ status: 'ocupada' });

        return res.json({ status: 'OK', codigo: 1, mensagem: `Mesa ${fromMesa} transferida para Mesa ${toMesa}` });
      } catch (err) {
        return res.status(500).json({ status: 'ERRO', mensagem: err.message });
      }
    }

    default:
      return res.json({ status: 'OK', codigo: 1 });
  }
}

// Vincula as rotas tanto com .php quanto sem extensão, GET e POST
router.all('/ConfigAndroid.php', handleConfigAndroid);
router.all('/ConfigAndroid', handleConfigAndroid);
router.all('/PedidoWorker.php', handlePedidoWorker);
router.all('/PedidoWorker', handlePedidoWorker);

module.exports = router;
