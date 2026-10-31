process.on('uncaughtException', (err) => {
  const fs = require('fs');
  const path = require('path');
  const line = `[${new Date().toISOString()}] [UNCAUGHT EXCEPTION] ${err.stack || err.message}\n`;
  try { fs.appendFileSync(path.join(__dirname, 'server_debug.log'), line); } catch (_) {}
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  const fs = require('fs');
  const path = require('path');
  const line = `[${new Date().toISOString()}] [UNHANDLED REJECTION] ${reason?.stack || reason}\n`;
  try { fs.appendFileSync(path.join(__dirname, 'server_debug.log'), line); } catch (_) {}
  console.error('[UNHANDLED REJECTION]', reason);
});

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const {
  sequelize, User, Category, Product, Table, Size, Flavor, FlavorPrice, Crust,
  Neighborhood, Courier, KdsStage, PaymentMethod,
} = require('./models');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rotas diretas para o app de garçom / mobile
app.get('/garcom', (req, res) => res.sendFile(path.join(__dirname, 'public', 'garcom.html')));
app.get('/mobile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'garcom.html')));

const debugLog = path.join(__dirname, 'server_debug.log');
function logServer(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(debugLog, line); } catch (_) {}
  console.log(msg);
}

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const dur = Date.now() - t0;
    if (res.statusCode >= 400 || req.method !== 'GET') {
      logServer(`${req.method} ${req.originalUrl || req.url} -> ${res.statusCode} (${dur}ms)`);
    }
  });
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/pizza', require('./routes/pizza'));
app.use('/api/config', require('./routes/config'));
app.use('/api', require('./routes/cadastros'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/kitchen', require('./routes/kitchen'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/printers', require('./routes/printers'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/fiscal', require('./routes/fiscal'));
app.use('/service/android', require('./routes/android_compat'));

app.use((err, req, res, next) => {
  logServer(`[EXPRESS ERROR] ${req.method} ${req.url} -> ${err.stack || err.message}`);
  res.status(err.status || 500).json({ error: err.message || 'Erro interno' });
});

async function seed() {
  // Dados de demonstracao so entram em banco totalmente vazio (apos importar do EiChefe nada e sobrescrito)
  if (await User.count() > 0) return;
  {
    await User.bulkCreate([
      { username: 'admin', role: 'admin', passwordHash: await bcrypt.hash('admin123', 10) },
      { username: 'garcom', role: 'garcom', passwordHash: await bcrypt.hash('garcom123', 10) },
      { username: 'cozinha', role: 'cozinheiro', passwordHash: await bcrypt.hash('cozinha123', 10) },
    ]);
  }
  if (await Category.count() === 0) {
    const [bebidas, sobremesas, porcoes] = await Category.bulkCreate([
      { name: 'Bebidas' }, { name: 'Sobremesas' }, { name: 'Porcoes' },
    ]);
    await Product.bulkCreate([
      { name: 'Coca-Cola 2L', price: 12, stockControl: true, stock: 50, kitchen: false, CategoryId: bebidas.id },
      { name: 'Guarana 2L', price: 10, stockControl: true, stock: 50, kitchen: false, CategoryId: bebidas.id },
      { name: 'Suco de Laranja', price: 8, kitchen: true, CategoryId: bebidas.id },
      { name: 'Petit Gateau', price: 18, kitchen: true, CategoryId: sobremesas.id },
      { name: 'Batata Frita', price: 24, kitchen: true, CategoryId: porcoes.id },
    ]);
  }
  if (await Table.count() === 0) {
    await Table.bulkCreate(Array.from({ length: 10 }, (_, i) => ({ number: i + 1 })));
  }
  if (await Size.count() === 0) {
    const sizes = await Size.bulkCreate([
      { name: 'Broto', maxFlavors: 1 },
      { name: 'Media', maxFlavors: 2 },
      { name: 'Grande', maxFlavors: 2 },
      { name: 'Gigante', maxFlavors: 3 },
    ]);
    // preco base por tamanho; sabores premium somam um acrescimo
    const base = { Broto: 28, Media: 42, Grande: 52, Gigante: 64 };
    const flavors = [
      ['Margherita', 'Molho, mussarela, tomate e manjericao', 'salgada', 0],
      ['Calabresa', 'Calabresa, cebola e mussarela', 'salgada', 0],
      ['Mussarela', 'Molho e mussarela', 'salgada', -4],
      ['Portuguesa', 'Presunto, ovo, cebola, azeitona', 'salgada', 4],
      ['Frango com Catupiry', 'Frango desfiado e catupiry', 'salgada', 4],
      ['Quatro Queijos', 'Mussarela, provolone, gorgonzola, parmesao', 'salgada', 8],
      ['Chocolate com Morango', 'Chocolate ao leite e morangos', 'doce', 6],
    ];
    for (const [name, description, kind, extra] of flavors) {
      const f = await Flavor.create({ name, description, kind });
      await FlavorPrice.bulkCreate(sizes.map(s => ({
        FlavorId: f.id, SizeId: s.id, price: base[s.name] + extra * (s.name === 'Broto' ? 0.6 : s.name === 'Gigante' ? 1.3 : 1),
      })));
    }
  }
  if (await Crust.count() === 0) {
    await Crust.bulkCreate([
      { name: 'Catupiry', price: 8 }, { name: 'Cheddar', price: 8 }, { name: 'Chocolate', price: 10 },
    ]);
  }
  if (await Neighborhood.count() === 0) {
    await Neighborhood.bulkCreate([
      { name: 'Centro', fee: 5 }, { name: 'Jardim', fee: 7 }, { name: 'Vila Nova', fee: 9 },
    ]);
  }
  if (await Courier.count() === 0) {
    await Courier.bulkCreate([{ name: 'Carlos', phone: '11999990001' }, { name: 'Marcos', phone: '11999990002' }]);
  }
  await PaymentMethod.bulkCreate([{ name: 'Dinheiro' }, { name: 'Cartao de Credito' }, { name: 'Cartao de Debito' }, { name: 'Pix' }]);
  if (await KdsStage.count() === 0) {
    await KdsStage.bulkCreate([
      { name: 'Montagem', position: 1, targetMinutes: 8 },
      { name: 'Forno', position: 2, targetMinutes: 12 },
      { name: 'Finalizacao', position: 3, targetMinutes: 3 },
    ]);
  }
}

async function ensureColumns() {
  const qi = sequelize.getQueryInterface();
  const addCol = async (table, col, def) => {
    const desc = await qi.describeTable(table);
    if (!desc[col]) await qi.addColumn(table, col, def);
  };
  await addCol('Orders', 'paidAmount', { type: sequelize.Sequelize.DECIMAL(10, 2), defaultValue: 0 });
  await addCol('Orders', 'splitCount', { type: sequelize.Sequelize.INTEGER, defaultValue: 1 });
  await addCol('Orders', 'addressNumber', { type: sequelize.Sequelize.STRING });
  await addCol('Orders', 'complement', { type: sequelize.Sequelize.STRING });
  await addCol('Orders', 'reference', { type: sequelize.Sequelize.STRING });
  await addCol('Orders', 'deliveryMode', { type: sequelize.Sequelize.STRING, defaultValue: 'e' });
  await addCol('Orders', 'discount', { type: sequelize.Sequelize.DECIMAL(10, 2), defaultValue: 0 });
  await addCol('Orders', 'isNewCustomer', { type: sequelize.Sequelize.BOOLEAN, defaultValue: false });
  await addCol('Orders', 'nfeStatus', { type: sequelize.Sequelize.STRING, defaultValue: 'nao_emitida' });
  await addCol('Orders', 'nfeKey', { type: sequelize.Sequelize.STRING });
  await addCol('Orders', 'nfeProtocol', { type: sequelize.Sequelize.STRING });
  await addCol('Orders', 'nfeFile', { type: sequelize.Sequelize.STRING });
  await addCol('Orders', 'customerCpf', { type: sequelize.Sequelize.STRING });
  await addCol('Orders', 'customerName', { type: sequelize.Sequelize.STRING });
  await addCol('OrderItems', 'paidQuantity', { type: sequelize.Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 });
  await addCol('OrderItems', 'splitInfo', { type: sequelize.Sequelize.TEXT });
  await addCol('OrderItems', 'cancelledAt', { type: sequelize.Sequelize.DATE });
  await addCol('OrderItems', 'cancelledReason', { type: sequelize.Sequelize.STRING });
  await addCol('OrderItems', 'cancelledBy', { type: sequelize.Sequelize.STRING });
  await addCol('Categories', 'PrinterId', { type: sequelize.Sequelize.INTEGER });
  await addCol('Categories', 'print_separate', { type: sequelize.Sequelize.STRING, defaultValue: 'n' });
}

const PORT = process.env.PORT || 3000;
sequelize.sync().then(ensureColumns).then(seed).then(() => {
  console.log('Database synced');
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
});
