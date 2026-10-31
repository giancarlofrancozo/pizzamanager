// Importa cardapio, precos, mesas, bairros, formas de pagamento e clientes do dump do EiChefe.
//   node import/eichefe.js --dry   -> so mostra o que seria importado
//   node import/eichefe.js         -> recria o banco local e importa
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { readDump } = require('./dump');

const DUMP = process.env.EICHEFE_DUMP || 'C:/Projeot/eichefe-gestao/service/temp/backup/backup-service.sql';
const DRY = process.argv.includes('--dry');
const str = v => (v === null || v === undefined ? '' : String(v).replace(/\0/g, '').trim());

(async () => {
  const d = await readDump(DUMP, [
    'categoria', 'subcategoria', 'produto', 'sabor', 'borda', 'pedaco', 'numerosabor', 'bairro', 'cidade',
    'mesa', 'formapagamento', 'configuracao', 'cliente', 'enderecocliente', 'telefone',
  ]);
  const cfg = Object.fromEntries(d.configuracao.map(c => [c.nome, c.tipo]));
  const entregaFixa = Number(cfg.taxaEntrega || 0);

  // ----- Pizza fracionada: pedaco = tamanho, produto(sabor x pedaco) = preco -----
  const nSabor = Object.fromEntries(d.numerosabor.map(n => [n.codigo, n.numeroSabor]));
  const sizes = d.pedaco.filter(p => p.ativo === 's').map(p => ({
    eid: p.codigo,
    name: `${str(p.descricao) || 'Pizza'} (${str(p.nome)} pedacos)`,
    maxFlavors: nSabor[p.codNumeroSabor] || 1,
  }));
  const sizeIds = new Set(sizes.map(s => s.eid));
  const frac = d.produto.filter(p => p.codSabor && p.codPedaco && p.ativo === 'y' && sizeIds.has(p.codPedaco));
  const priceBy = {}; // `${sabor}|${pedaco}` -> preco
  frac.forEach(p => { priceBy[`${p.codSabor}|${p.codPedaco}`] = Number(p.valor); });
  const flavors = d.sabor.filter(s => s.ativo === 'y').map(s => ({
    eid: s.codigo, name: str(s.nome), description: str(s.descricao) || null,
    kind: s.codigoSubCategoria === 2 ? 'doce' : 'salgada',
    prices: sizes.map(z => [z.eid, priceBy[`${s.codigo}|${z.eid}`]]).filter(([, v]) => v !== undefined),
  }));
  const flavorsOk = flavors.filter(f => f.prices.length);

  // ----- Bordas: preco vem dos produtos de borda por pedaco -----
  const bordaProd = d.produto.filter(p => p.codBorda && p.ativo === 'y');
  const crusts = d.borda.filter(b => b.ativo === 'y').map(b => {
    const ps = bordaProd.filter(p => p.codBorda === b.codigo).map(p => Number(p.valor));
    return { eid: b.codigo, name: str(b.nome), price: ps.length ? Math.max(...ps) : 0, distinct: new Set(ps).size };
  });

  // ----- Produtos comuns -----
  const sub = Object.fromEntries(d.subcategoria.map(s => [s.codigo, s]));
  const cat = Object.fromEntries(d.categoria.map(c => [c.codigo, c]));
  const common = d.produto.filter(p => !p.codSabor && !p.codBorda && !p.codPedaco && p.ativo === 'y' && p.vender === 's'
    && !/^taxas?$/i.test(str(sub[p.subCategoria]?.nome)));
  const kitchenOff = p => {
    const s = sub[p.subCategoria];
    return (s && s.codigoCategoria === 3) || /sorvete|doces e balas|vinho|cover/i.test(str(s?.nome));
  };

  // ----- Bairros / taxa fixa -----
  const cityName = Object.fromEntries(d.cidade.map(c => [c.codigo, c.nome]));
  const bairros = d.bairro.filter(b => b.ativoParaEntrega === 's');
  const perCity = {};
  bairros.forEach(b => { perCity[b.codigoCidade] = (perCity[b.codigoCidade] || 0) + 1; });
  const mainCity = Number(Object.entries(perCity).sort((a, b) => b[1] - a[1])[0][0]);
  const neighborhoods = bairros.map(b => ({
    name: str(b.nome) + (b.codigoCidade === mainCity ? '' : ` - ${cityName[b.codigoCidade] || ''}`),
    fee: entregaFixa,
  }));
  const bairroNome = Object.fromEntries(d.bairro.map(b => [b.codigo, str(b.nome)]));

  // ----- Clientes (nome, telefone, endereco principal) -----
  const phones = {}; const phoneByCode = {};
  d.telefone.forEach(t => { (phones[t.codigoCliente] ||= []).push(t); phoneByCode[t.codigo] = t.telefone; });
  const addrs = {}; const addrByCode = {};
  d.enderecocliente.forEach(a => { (addrs[a.codigoCliente] ||= []).push(a); addrByCode[a.codigo] = a; });
  const customers = d.cliente.filter(c => str(c.nome)).map(c => {
    const phone = phoneByCode[c.idTelefonePrincipal] || phones[c.codigo]?.[0]?.telefone;
    const a = addrByCode[c.codigoEnderecoPrincipal] || addrs[c.codigo]?.[0];
    return {
      name: str(c.nome), phone: str(phone) || null,
      address: a ? [str(a.endereco), str(a.numero)].filter(Boolean).join(', ') + (str(a.complemento) ? ' - ' + str(a.complemento) : '') : null,
      neighborhood: a ? (bairroNome[a.codigoBairro] || str(a.bairro)) || null : null,
    };
  });

  const tables = d.mesa.filter(m => m.ativo === 's').map(m => m.nMesa);
  const payments = d.formapagamento.filter(f => f.fechamento === 'y').map(f => str(f.nome));

  console.log(JSON.stringify({
    tamanhos: sizes.map(s => `${s.name} ate ${s.maxFlavors} sabores`),
    sabores: `${flavorsOk.length} com preco (de ${flavors.length} ativos)`,
    faixaPrecoPizza: [Math.min(...frac.map(p => p.valor)), Math.max(...frac.map(p => p.valor))],
    bordas: crusts.length, bordasComPrecoDiferentePorTamanho: crusts.filter(c => c.distinct > 1).map(c => c.name),
    produtos: common.length, subcategoriasUsadas: [...new Set(common.map(p => str(sub[p.subCategoria]?.nome)))],
    produtosSemCozinha: common.filter(kitchenOff).length,
    bairros: neighborhoods.length, cidadePrincipal: cityName[mainCity], taxaFixa: entregaFixa,
    mesas: tables.length, formasPagamento: payments, clientes: customers.length,
    clientesComTelefone: customers.filter(c => c.phone).length, clientesComEndereco: customers.filter(c => c.address).length,
  }, null, 1));
  if (DRY) return;

  // ----- Gravacao -----
  const dbFile = path.join(__dirname, '..', 'db', 'database.sqlite');
  if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, dbFile.replace('.sqlite', '.antes-da-importacao.sqlite'));
  const M = require('../models');
  await M.sequelize.sync({ force: true });

  await M.User.bulkCreate([
    { username: 'admin', role: 'admin', passwordHash: await bcrypt.hash('admin123', 10) },
    { username: 'garcom', role: 'garcom', passwordHash: await bcrypt.hash('garcom123', 10) },
    { username: 'cozinha', role: 'cozinheiro', passwordHash: await bcrypt.hash('cozinha123', 10) },
  ]);
  await M.KdsStage.bulkCreate([
    { name: 'Montagem', position: 1, targetMinutes: 8 },
    { name: 'Forno', position: 2, targetMinutes: 12 },
    { name: 'Finalizacao', position: 3, targetMinutes: 3 },
  ]);

  const sizeRows = await M.Size.bulkCreate(sizes.map(s => ({ name: s.name, maxFlavors: s.maxFlavors })));
  const sizeMap = Object.fromEntries(sizes.map((s, i) => [s.eid, sizeRows[i].id]));
  for (const f of flavorsOk) {
    const row = await M.Flavor.create({ name: f.name, description: f.description, kind: f.kind });
    await M.FlavorPrice.bulkCreate(f.prices.map(([eid, price]) => ({ FlavorId: row.id, SizeId: sizeMap[eid], price })));
  }
  await M.Crust.bulkCreate(crusts.map(c => ({ name: c.name, price: c.price })));

  const catRows = {};
  for (const name of [...new Set(common.map(p => str(sub[p.subCategoria]?.nome) || 'Outros'))]) {
    catRows[name] = (await M.Category.create({ name })).id;
  }
  await M.Product.bulkCreate(common.map(p => ({
    name: str(p.nome), description: str(p.descricao) || null, price: Number(p.valor),
    CategoryId: catRows[str(sub[p.subCategoria]?.nome) || 'Outros'], kitchen: !kitchenOff(p),
    stockControl: false, stock: 0, // o estoque do EiChefe tem valores sem controle real (negativos e 99999)
  })));

  await M.Neighborhood.bulkCreate(neighborhoods);
  await M.Table.bulkCreate(tables.map(n => ({ number: n })));
  await M.PaymentMethod.bulkCreate(payments.map(name => ({ name })));
  for (let i = 0; i < customers.length; i += 500) await M.Customer.bulkCreate(customers.slice(i, i + 500));

  console.log('IMPORTADO: ' + JSON.stringify({
    tamanhos: await M.Size.count(), sabores: await M.Flavor.count(), precosSabor: await M.FlavorPrice.count(),
    bordas: await M.Crust.count(), categorias: await M.Category.count(), produtos: await M.Product.count(),
    bairros: await M.Neighborhood.count(), mesas: await M.Table.count(), pagamentos: await M.PaymentMethod.count(),
    clientes: await M.Customer.count(),
  }));
})().catch(e => { console.error(e); process.exit(1); });
