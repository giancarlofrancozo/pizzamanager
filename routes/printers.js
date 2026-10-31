const express = require('express');
const net = require('net');
const {
  PrintServer, PhysicalPrinter, Printer, PrintJob,
  Category, Order, OrderItem, OrderPayment, Product, Table, Customer,
  Size, Crust, Neighborhood, Courier,
} = require('../models');
const { required } = require('../middleware/auth');
const authenticate = required();

const router = express.Router();

// Auxiliares idênticos ao motor de impressão do EiChefe Gestão
function padRight(str, len) {
  const s = String(str || '');
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}
function padLeft(str, len) {
  const s = String(str || '');
  return s.length >= len ? s.slice(0, len) : ' '.repeat(len - s.length) + s;
}
function lineSep(width, ch = '-') {
  return ch.repeat(width);
}
function money(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function dotLine(label, valStr, width = 41, boldLabel = true, boldVal = false) {
  const dotsCount = Math.max(2, width - label.length - valStr.length);
  const dots = '.'.repeat(dotsCount);
  const l = boldLabel ? `{B}${label}{/B}` : label;
  const r = boldVal ? `{B}${valStr}{/B}` : valStr;
  return `${l}${dots}${r}`;
}
function wrapLines(str, maxLen, keepIndent = false) {
  const raw = String(str || '');
  const indentMatch = keepIndent ? raw.match(/^(\s*)/) : null;
  const indent = indentMatch ? indentMatch[1] : '';
  const words = raw.trim().split(/\s+/);
  const out = [];
  let cur = indent;
  for (const w of words) {
    if (!cur.trim()) cur += w;
    else if (cur.length + 1 + w.length <= maxLen) cur += ' ' + w;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}
function fmtDateEiChefe(dateObj, withSeconds = false, withAs = true) {
  const d = new Date(dateObj || Date.now());
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const sep = withAs ? ' as ' : ' ';
  return `${dd}/${mm}/${yyyy}${sep}${hh}:${mi}${withSeconds ? ':' + ss : ''}`;
}
function fmtPhoneEiChefe(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return raw;
}
function fmtPaymentEiChefe(method) {
  return String(method || 'Dinheiro')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Gera o texto ESC/Bema ou ESC/POS idêntico ao EiChefe para o daemon EiChefeImpressao (porta 9998)
function buildAgentEscPosString(markedText, { charType = 'pos', beep = 2 } = {}) {
  let raw = String(markedText || '');
  if (charType === 'bt') {
    // Bematech ESC/Bema (MP-4200 TH): <ESC>@ <ESC>H
    raw = raw
      .replace(/\{BIG\}/g, '\x1bW1\x1bd1\x1bE')
      .replace(/\{\/BIG\}/g, '\x1bF\x1bW0\x1bd0')
      .replace(/\{DH\}/g, '\x1bd1')
      .replace(/\{\/DH\}/g, '\x1bd0')
      .replace(/\{B\}/g, '\x1bE')
      .replace(/\{\/B\}/g, '\x1bF');
    // 5 avanços de linha no final para o pedido inteiro passar da lâmina da guilhotina antes do corte automático
    return `\x1b@\x1bH${raw}\n\n\n\n\n`;
  }
  // Epson ESC/POS (modelo 13 - idêntico ao EiChefe nos pedidos de Sushi, Cozinha e Caixa):
  // Inicialização: <ESC>@ <ESC>!\x00
  // {BIG} -> <ESC>!0<ESC>E1 (Double-Width + Double-Height + Negrito ativo)
  // {/BIG} -> <ESC>E0<ESC>!\x00 (Desliga Negrito e volta ao modo normal)
  // {DH} -> <ESC>!\x10 (Double-Height)
  // {/DH} -> <ESC>!\x00 (Volta ao modo normal)
  // {B} -> <ESC>E1 (Negrito ON)
  // {/B} -> <ESC>E0 (Negrito OFF)
  raw = raw
    .replace(/\{BIG\}/g, '\x1b!0\x1bE1')
    .replace(/\{\/BIG\}/g, '\x1bE0\x1b!\x00')
    .replace(/\{DH\}/g, '\x1b!\x10')
    .replace(/\{\/DH\}/g, '\x1b!\x00')
    .replace(/\{B\}/g, '\x1bE1')
    .replace(/\{\/B\}/g, '\x1bE0');
  const beepCmd = beep > 0 ? `\x1bB${String.fromCharCode(Math.min(9, beep))}\x02` : '';
  return `\x1b@\x1b!\x00${raw}\n\n${beepCmd}\n\n\n\n`;
}

// Gera o Buffer binário completo para envio direto via Socket TCP 9100 (com corte Bematech <ESC>w ou Epson <GS>V)
function buildEscPosBuffer(markedText, { charType = 'pos', cutter = '2', beep = 2 } = {}) {
  const chunks = [];
  chunks.push(Buffer.from([0x1B, 0x40])); // <ESC>@ Initialize
  let raw = String(markedText || '');
  if (charType === 'bt') {
    // Bematech ESC/Bema: <ESC>H + <ESC>E
    chunks.push(Buffer.from([0x1B, 0x48, 0x1B, 0x45]));
    raw = raw
      .replace(/\{BIG\}/g, '\x1bW1\x1bd1\x1bE')
      .replace(/\{\/BIG\}/g, '\x1bF\x1bW0\x1bd0')
      .replace(/\{DH\}/g, '\x1bd1')
      .replace(/\{\/DH\}/g, '\x1bd0')
      .replace(/\{B\}/g, '\x1bE')
      .replace(/\{\/B\}/g, '\x1bF');
    // Avança 5 linhas + limpa cache (\n\r) igual ao MP2032.dll para o papel sair inteiro antes de cortar
    chunks.push(Buffer.from(raw.replace(/\n/g, '\r\n') + '\r\n\r\n\r\n\r\n\r\n\n\r', 'latin1'));
    // Guilhotina Automática Bematech (MP2032.dll AcionaGuilhotina / ImpressaoDireto.cortarBematech):
    // <ESC>w (0x1B 0x77) = Corte Total | <ESC>m (0x1B 0x6D) = Corte Parcial
    if (cutter === '1') {
      chunks.push(Buffer.from([0x1B, 0x6D]));
    } else if (cutter !== '0') {
      chunks.push(Buffer.from([0x1B, 0x77]));
    }
    // Beep oficial Bematech MP-4200 TH
    if (beep > 0) {
      const bCmd = Buffer.from([0x1B, 0x28, 0x41, 0x04, 0x00, 0x31, 0xC8, 0x01, 0x01]);
      for (let i = 0; i < Math.min(3, beep); i++) chunks.push(bCmd);
    }
  } else {
    // Epson ESC/POS: modo normal Font A
    chunks.push(Buffer.from([0x1B, 0x21, 0x00]));
    raw = raw
      .replace(/\{BIG\}/g, '\x1b!0\x1bE1')
      .replace(/\{\/BIG\}/g, '\x1bE0\x1b!\x00')
      .replace(/\{DH\}/g, '\x1b!\x10')
      .replace(/\{\/DH\}/g, '\x1b!\x00')
      .replace(/\{B\}/g, '\x1bE1')
      .replace(/\{\/B\}/g, '\x1bE0');
    chunks.push(Buffer.from(raw.replace(/\n/g, '\r\n') + '\r\n\r\n\r\n\r\n', 'latin1'));
    if (beep > 0) {
      chunks.push(Buffer.from([0x1B, 0x42, Math.min(9, beep), 0x02]));
    }
    if (cutter === '1') {
      chunks.push(Buffer.from([0x1D, 0x56, 0x01]));
    } else if (cutter !== '0') {
      chunks.push(Buffer.from([0x1D, 0x56, 0x42, 0x00]));
    }
  }
  return Buffer.concat(chunks);
}

function checkTcpSocket(host, port, timeoutMs = 1500) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = (online, detail) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ online, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, `Conectado a ${host}:${port}`));
    socket.once('timeout', () => finish(false, `Timeout (${host}:${port})`));
    socket.once('error', err => finish(false, err.code || err.message));
    socket.connect(port, host);
  });
}

// Envia para a impressora TCP 9100 fechando com FIN gracioso (socket.end) para nunca truncar metade do pedido!
function sendRawTcp(host, port, buffer, timeoutMs = 4000) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      setTimeout(() => socket.destroy(), 200);
      resolve({ ok, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.setNoDelay(true);
      socket.end(buffer, () => {
        setTimeout(() => finish(true, `Impresso e cortado em ${host}:${port}`), 250);
      });
    });
    socket.once('close', () => finish(true, `Impresso e cortado em ${host}:${port}`));
    socket.once('timeout', () => finish(false, `Timeout ao enviar para ${host}:${port}`));
    socket.once('error', err => finish(false, err.code || err.message));
    socket.connect(port, host);
  });
}

// Envia para o serviço oficial EiChefeImpressao (127.0.0.1:9998)
function sendViaEiChefeDaemon({ serverIp = '127.0.0.1', serverPort = 9998, phys, logical, markedText }, timeoutMs = 3500) {
  return new Promise(resolve => {
    const pathStr = (phys.path || '').trim();
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(pathStr);
    const isPizzaBematech = pathStr === '192.168.18.211' || phys.char_type === 'bt' || Number(phys.model_code) === 11;
    const charType = isPizzaBematech ? 'bt' : (phys.char_type || 'pos');
    const modelCode = isPizzaBematech ? 11 : (Number(phys.model_code) || 13);
    const cutter = String(logical?.cutter ?? '2');
    const beep = Number(logical?.beep ?? 2);
    const rawTexto = buildAgentEscPosString(markedText, { charType, beep });

    const payload = {
      metodo: 'i',
      feedback: 'n',
      nome: phys.name || logical?.name || 'Cozinha',
      caminho: pathStr,
      modelo: modelCode,
      tipoInterface: Number(phys.interface_type || (isIp ? 4 : 3)),
      guilhotina: cutter === '1' ? 1 : cutter === '0' ? 0 : 2, // 2 = Corte Total Automático
      beep: beep > 0 ? `200x50x${Math.min(9, beep)}` : null,
      texto: rawTexto,
      modo: phys.mode || (isIp ? 'd' : 's'),
      retry: 'true',
      codigoImpressao: Math.floor(Date.now() % 1000000000) + Math.floor(Math.random() * 1000),
      para: 'Caixa',
      host: serverIp,
      porta: Number(serverPort || 9998),
    };

    const socket = new net.Socket();
    let done = false;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      setTimeout(() => socket.destroy(), 150);
      resolve({ ok, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.setNoDelay(true);
      const jsonAscii = JSON.stringify(payload).replace(/[\u007f-\uffff]/g, c => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
      socket.write(jsonAscii + '\r\nexit\r\n', 'ascii', () => {
        setTimeout(() => finish(true, `Impresso e cortado via EiChefeImpressao (${phys.path})`), 150);
      });
    });
    socket.once('data', () => {
      finish(true, `Impresso e cortado via EiChefeImpressao (${phys.path})`);
    });
    socket.once('timeout', () => {
      finish(false, `Timeout daemon ${serverIp}:${serverPort}`);
    });
    socket.once('error', err => finish(false, err.code || err.message));
    socket.connect(Number(serverPort || 9998), serverIp);
  });
}

// Despacha o cupom para a impressora física (via EiChefeImpressao 9998 ou direto TCP 9100)
async function dispatchHardwarePrint(phys, logical, markedText) {
  const pathStr = (phys?.path || '').trim();
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(pathStr);
  // Pizza (192.168.18.211) é Bematech ('bt', modelo 11). Cozinha (192.168.18.212 / Sushi) e Caixa são EPSON ESC/POS ('pos', modelo 13)
  const isPizzaBematech = pathStr === '192.168.18.211' || (phys?.char_type === 'bt') || Number(phys?.model_code) === 11;
  const charType = isPizzaBematech ? 'bt' : (phys?.char_type || 'pos');
  const modelCode = isPizzaBematech ? 11 : (Number(phys?.model_code) || 13);
  const cutter = String(logical?.cutter ?? '2');
  const beep = Number(logical?.beep ?? 2);

  // 1) Tenta pelo daemon EiChefeImpressao na porta 9998
  const daemonRes = await sendViaEiChefeDaemon({
    serverIp: phys?.server?.ip || '127.0.0.1',
    serverPort: phys?.server?.port || 9998,
    phys: { ...phys.toJSON ? phys.toJSON() : phys, char_type: charType, model_code: modelCode },
    logical: { cutter, beep, name: logical?.name || phys?.name },
    markedText,
  });
  if (daemonRes.ok) {
    return { sentHardware: true, hwDetail: daemonRes.detail };
  }

  // 2) Fallback direto via Socket TCP 9100
  if (isIp) {
    const buf = buildEscPosBuffer(markedText, { charType, cutter, beep });
    const tcp = await sendRawTcp(pathStr, 9100, buf);
    return { sentHardware: tcp.ok, hwDetail: tcp.detail };
  }

  return { sentHardware: false, hwDetail: daemonRes.detail || 'Fila Local' };
}

async function ensureDefaultPrinters() {
  if (await Printer.count() > 0) {
    // Cozinha (#3) = 192.168.18.212 -> EPSON ESC/POS (pos, modelo 13, 48 colunas, corte total '2')
    await PhysicalPrinter.update(
      { char_type: 'pos', model_code: 13, columns: 48, interface_type: 4, mode: 'd' },
      { where: { id: 3 } }
    );
    // Pizza (#6) = 192.168.18.211 -> Bematech MP-4200 TH (bt, modelo 11, 48 colunas, corte total '2')
    await PhysicalPrinter.update(
      { char_type: 'bt', model_code: 11, columns: 48, interface_type: 4, mode: 'd' },
      { where: { id: 6 } }
    );
    // Caixa (#1) = EPSON CAIXA -> EPSON ESC/POS Spooler (pos, modelo 13, 41 colunas, corte total '2')
    await PhysicalPrinter.update(
      { char_type: 'pos', model_code: 13, columns: 41, interface_type: 3, mode: 's' },
      { where: { id: 1 } }
    );
    await Printer.update(
      { cutter: '2' },
      { where: { id: [1, 2, 3, 4, 5, 6] } }
    );
    // Garante categoria SUSHI (#13) direcionada para impressora Cozinha (#3) com agrupamento de itens ('n')
    await Category.update(
      { PrinterId: 3, print_separate: 'n' },
      { where: { id: 13 } }
    );
    return;
  }

  const srv1 = await PrintServer.create({ id: 1, name: 'Caixa', ip: '127.0.0.1', port: 9998, type: 'java' });
  await PrintServer.create({ id: 2, name: 'Caixa PC', ip: '127.0.0.1', port: 9998, type: 'java' });

  const physCaixa = await PhysicalPrinter.create({
    id: 1, PrintServerId: srv1.id, name: 'Caixa', path: 'EPSON CAIXA',
    mode: 's', columns: 41, init_command: null, end_command: null,
    char_type: 'pos', model_code: 13, interface_type: 3,
  });
  const physCozinha = await PhysicalPrinter.create({
    id: 3, PrintServerId: srv1.id, name: 'Cozinha', path: '192.168.18.212',
    mode: 'd', columns: 48, init_command: null, end_command: '<br><br><br>',
    char_type: 'pos', model_code: 13, interface_type: 4,
  });
  const physPizza = await PhysicalPrinter.create({
    id: 6, PrintServerId: srv1.id, name: 'Pizza', path: '192.168.18.211',
    mode: 'd', columns: 48, init_command: null, end_command: null,
    char_type: 'bt', model_code: 11, interface_type: 4,
  });

  await Printer.bulkCreate([
    { id: 1, PrintServerId: srv1.id, PhysicalPrinterId: physCaixa.id, name: 'Caixa', end_command: '<br><br><br>', cutter: '2', beep: 2, print_items: true },
    { id: 2, PrintServerId: srv1.id, PhysicalPrinterId: physCaixa.id, name: 'Bebidas', end_command: '<br><br><br>', cutter: '2', beep: 2, print_items: true },
    { id: 3, PrintServerId: srv1.id, PhysicalPrinterId: physCozinha.id, name: 'Cozinha', end_command: null, cutter: '2', beep: 2, print_items: true },
    { id: 4, PrintServerId: srv1.id, PhysicalPrinterId: physCaixa.id, name: 'Suco', end_command: '<br><br><br>', cutter: '2', beep: 2, print_items: true },
    { id: 5, PrintServerId: srv1.id, PhysicalPrinterId: physCaixa.id, name: 'Drink', end_command: null, cutter: '2', beep: 2, print_items: true },
    { id: 6, PrintServerId: srv1.id, PhysicalPrinterId: physPizza.id, name: 'Pizza', end_command: '<br><br><br>', cutter: '2', beep: 2, print_items: true },
  ]);

  const cats = await Category.findAll();
  for (const c of cats) {
    const n = (c.name || '').toLowerCase();
    let pid = 6;
    let sep = 'n';
    if (n === 'doces e balas' || /vinho|sorvete|bala|cover|taxa|bebida|refrigerante|cerveja|agua|água/i.test(n)) {
      pid = 1;
    } else if (/suco/i.test(n)) {
      pid = 4;
    } else if (/drink|coquetel/i.test(n)) {
      pid = 5;
    } else if (/sushi|prato|cozinha/i.test(n)) {
      pid = 3;
    }
    if (/tradicional|porç|porcoes/i.test(n)) sep = 'p';
    await c.update({ PrinterId: pid, print_separate: sep });
  }
}

// Monta o texto da comanda da cozinha no formato exato de 48 colunas da Bematech do EiChefe (tudo em negrito)
function buildComandaText(order, itemsList, garcom, w = 48) {
  const vendaCod = String(order.id).padStart(8, '0');
  const dtFull = fmtDateEiChefe(order.createdAt || new Date(), true, true);
  const lines = [];

  if (order.type === 'delivery') {
    lines.push(`VENDA: ${vendaCod}           ${dtFull}`);
    lines.push('');
    lines.push(`                  {DH}ENTREGA: {B}${order.id}{/B}{/DH}`);
    lines.push('');
    lines.push(`CLIENTE: {B}${(order.Customer?.name || '').toUpperCase()}{/B}`);
    if (order.Customer?.phone) {
      lines.push(`            {B}TELEFONE: {/B}${fmtPhoneEiChefe(order.Customer.phone)}`);
    }
    if (order.notes) {
      lines.push(`OBS GERAL: {B}${order.notes}{/B}`);
    }
  } else if (order.type === 'balcao') {
    lines.push(`VENDA: ${vendaCod}           ${dtFull}`);
    lines.push('');
    lines.push(`                   {DH}BALCAO: {B}${order.id}{/B}{/DH}`);
    lines.push('');
    lines.push(`ATENDENTE: ${garcom}`);
    if (order.Customer?.name) {
      lines.push(`{DH}CLIENTE: {B}${order.Customer.name.toUpperCase()}{/B}{/DH}`);
    }
    if (order.notes) {
      lines.push(`OBS GERAL: {B}${order.notes}{/B}`);
    }
  } else {
    const localNum = order.Table ? order.Table.number : order.id;
    lines.push(`VENDA: ${vendaCod}           ${dtFull}`);
    lines.push(`ATENDENTE: ${garcom}`);
    lines.push(`                    {DH}MESA: {B}${localNum}{/B}{/DH}`);
    if (order.notes) {
      lines.push(`OBS GERAL: {B}${order.notes}{/B}`);
    }
  }
  lines.push(lineSep(w, '-'));

  const maxBigCols = Math.max(20, Math.floor(w / 2)); // 24 caracteres em fonte dupla (48 colunas)
  for (let idx = 0; idx < itemsList.length; idx++) {
    const it = itemsList[idx];
    if (idx > 0) lines.push('');
    if (it.kind === 'pizza') {
      const sizeName = it.Size?.name ? `Pizza ${it.Size.name}` : 'Pizza Grande';
      for (const wl of wrapLines(`${it.quantity}x ${sizeName}`, maxBigCols)) {
        lines.push(`{BIG}${wl}{/BIG}`);
      }
      const flavors = Array.isArray(it.flavorNames) && it.flavorNames.length
        ? it.flavorNames
        : [it.description || 'Tradicional'];
      for (const flv of flavors) {
        for (const wl of wrapLines(`> ${flv}`, maxBigCols)) {
          lines.push(`{BIG}${wl}{/BIG}`);
        }
      }
      if (it.observations) {
        for (const wl of wrapLines(`  -- OBS: ${it.observations}`, maxBigCols, true)) {
          lines.push(`{BIG}${wl}{/BIG}`);
        }
      }
      if (it.Crust) {
        for (const wl of wrapLines(`-> Borda ${it.Crust.name}`, maxBigCols)) {
          lines.push(`{BIG}${wl}{/BIG}`);
        }
      }
    } else {
      const prodName = (it.Product?.name || it.description || 'Produto').toUpperCase();
      for (const wl of wrapLines(`${it.quantity}x ${prodName}`, maxBigCols)) {
        lines.push(`{BIG}${wl}{/BIG}`);
      }
      if (it.observations) {
        for (const wl of wrapLines(`  -- OBS: ${it.observations}`, maxBigCols, true)) {
          lines.push(`{BIG}${wl}{/BIG}`);
        }
      }
    }
  }

  return lines.join('\n');
}

// Função exportável para imprimir e cortar automaticamente o pedido na cozinha ao lançar pedido ou clicar em Comanda
async function printOrderComanda(orderId, operatorName = 'ADMIN', { printerId = null, reprint = false, onlyItemIds = null } = {}) {
  await ensureDefaultPrinters();
  const order = await Order.findByPk(orderId, {
    include: [
      { model: Table },
      { model: Customer },
      { model: Neighborhood },
      { model: Courier },
      {
        model: OrderItem,
        as: 'items',
        include: [
          { model: Product, include: [{ model: Category, include: [{ model: Printer, as: 'printer', include: [{ model: PhysicalPrinter, as: 'physical', include: [{ model: PrintServer, as: 'server' }] }] }] }] },
          { model: Size },
          { model: Crust },
        ],
      },
    ],
  });
  if (!order) return [];

  const printers = await Printer.findAll({
    include: [{ model: PhysicalPrinter, as: 'physical', include: [{ model: PrintServer, as: 'server' }] }],
  });
  const caixaPrinter = printers.find(p => p.id === 1) || printers[0];
  const pizzaPrinter = printers.find(p => p.id === 6) || caixaPrinter;
  const garcom = String(operatorName || 'ADMIN').toUpperCase();

  const itemsToPrint = (order.items || []).filter(it => !onlyItemIds || onlyItemIds.includes(it.id));
  // Cada grupo em ticketsToPrint gera 1 comanda com corte automático de guilhotina no final
  const ticketsToPrint = [];
  const groupedBuckets = new Map();

  for (const item of itemsToPrint) {
    let targetPrinter = pizzaPrinter;
    let separate = 'n';
    if (printerId) {
      targetPrinter = printers.find(p => p.id === Number(printerId)) || targetPrinter;
    } else if (item.kind === 'pizza') {
      targetPrinter = pizzaPrinter;
      separate = 'n'; // Pizzas do mesmo pedido saem na comanda do pedido e cortam automaticamente ao final do pedido
    } else if (item.Product?.Category?.printer) {
      targetPrinter = item.Product.Category.printer;
      separate = item.Product.Category.print_separate || 'n';
    }
    if (!targetPrinter || !targetPrinter.print_items) continue;

    if (separate === 'p') {
      ticketsToPrint.push({ printer: targetPrinter, items: [item] });
    } else {
      const key = String(targetPrinter.id);
      if (!groupedBuckets.has(key)) {
        const bucket = { printer: targetPrinter, items: [] };
        groupedBuckets.set(key, bucket);
        ticketsToPrint.push(bucket);
      }
      groupedBuckets.get(key).items.push(item);
    }
  }

  const createdJobs = [];
  for (const ticket of ticketsToPrint) {
    const p = ticket.printer;
    const phys = p.physical || { name: p.name, path: '192.168.18.211', columns: 48, char_type: 'bt', model_code: 11, interface_type: 4 };
    const w = Number(phys.columns) >= 44 ? Number(phys.columns) : 48;
    const content = buildComandaText(order, ticket.items, garcom, w);

    await dispatchHardwarePrint(phys, p, content);

    const job = await PrintJob.create({
      order_id: order.id,
      printer_id: p.id,
      printer_name: `${p.name} (${phys.name})`,
      printer_path: phys.path,
      job_type: 'comanda',
      content,
      status: 'e',
      reprinted: Boolean(reprint),
      operator_name: garcom,
    });
    createdJobs.push(job);
  }

  return createdJobs;
}

router.get('/', authenticate, async (req, res) => {
  await ensureDefaultPrinters();
  const [servers, physical, printers, categories, jobs] = await Promise.all([
    PrintServer.findAll({ order: [['id', 'ASC']] }),
    PhysicalPrinter.findAll({ include: [{ model: PrintServer, as: 'server' }], order: [['id', 'ASC']] }),
    Printer.findAll({ include: [{ model: PhysicalPrinter, as: 'physical' }, { model: PrintServer, as: 'server' }], order: [['id', 'ASC']] }),
    Category.findAll({ include: [{ model: Printer, as: 'printer' }], order: [['name', 'ASC']] }),
    PrintJob.findAll({ order: [['id', 'DESC']], limit: 40 }),
  ]);
  res.json({ servers, physical, printers, categories, jobs });
});

router.post('/test-status', authenticate, async (req, res) => {
  const { kind, id } = req.body;
  if (kind === 'server') {
    const srv = await PrintServer.findByPk(id);
    if (!srv) return res.status(404).json({ error: 'Servidor não encontrado' });
    const status = await checkTcpSocket(srv.ip, srv.port);
    return res.json({ id: srv.id, kind, ...status });
  }
  const phys = await PhysicalPrinter.findByPk(id, { include: [{ model: PrintServer, as: 'server' }] });
  if (!phys) return res.status(404).json({ error: 'Impressora física não encontrada' });

  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(phys.path.trim());
  if (isIp) {
    const status = await checkTcpSocket(phys.path.trim(), 9100);
    return res.json({ id: phys.id, kind: 'physical', interface: 'TCP/IP (9100)', ...status });
  }
  const srvStatus = phys.server ? await checkTcpSocket(phys.server.ip, phys.server.port) : { online: false };
  res.json({
    id: phys.id,
    kind: 'physical',
    interface: 'Spooler Windows / USB',
    online: srvStatus.online,
    detail: srvStatus.online
      ? `Agente Java online (${phys.path})`
      : `Fila Local Ativa (${phys.path})`,
  });
});

router.put('/routing', authenticate, async (req, res) => {
  const { mappings } = req.body;
  if (Array.isArray(mappings)) {
    for (const m of mappings) {
      await Category.update(
        { PrinterId: m.PrinterId || null, print_separate: m.print_separate || 'n' },
        { where: { id: m.categoryId } }
      );
    }
  }
  res.json({ ok: true });
});

router.put('/physical/:id', authenticate, async (req, res) => {
  const p = await PhysicalPrinter.findByPk(req.params.id);
  if (!p) return res.status(404).json({ error: 'Impressora física não encontrada' });
  await p.update(req.body);
  res.json(p);
});

router.put('/logical/:id', authenticate, async (req, res) => {
  const p = await Printer.findByPk(req.params.id);
  if (!p) return res.status(404).json({ error: 'Impressora lógica não encontrada' });
  await p.update(req.body);
  res.json(p);
});

// Teste de Impressora no exato formato de Comanda do EiChefe (com corte automático Bematech)
router.post('/test-print/:id', authenticate, async (req, res) => {
  await ensureDefaultPrinters();
  let logical = await Printer.findByPk(req.params.id, {
    include: [{ model: PhysicalPrinter, as: 'physical', include: [{ model: PrintServer, as: 'server' }] }],
  });
  let phys = logical
    ? logical.physical
    : await PhysicalPrinter.findByPk(req.params.id, { include: [{ model: PrintServer, as: 'server' }] });
  if (!phys) return res.status(404).json({ error: 'Impressora não encontrada' });

  const w = Number(phys.columns) >= 44 ? Number(phys.columns) : 48;
  const dt = fmtDateEiChefe(new Date(), true, true);
  const op = (req.user?.username || 'ADMIN').toUpperCase();
  const lines = [
    `{B}VENDA: 00000001           ${dt}{/B}`,
    `{B}ATENDENTE: ${op}{/B}`,
    `                    {DH}{B}MESA: 18{/B}{/DH}`,
    lineSep(w, '-'),
    `{BIG}1x Pizza Grande{/BIG}`,
    `{BIG}> 4 Queijos{/BIG}`,
    `{BIG}> File do Chef{/BIG}`,
    `{BIG}-> Borda Catupiry{/BIG}`,
  ];
  const content = lines.join('\n');

  const { sentHardware, hwDetail } = await dispatchHardwarePrint(phys, logical || { cutter: '2', beep: 2, name: phys.name }, content);

  const job = await PrintJob.create({
    order_id: null,
    printer_id: logical ? logical.id : phys.id,
    printer_name: logical ? `${logical.name} (${phys.name})` : phys.name,
    printer_path: phys.path,
    job_type: 'teste',
    content,
    status: 'e',
    operator_name: op,
  });

  res.json({ job, sentHardware, hwDetail, columns: w });
});

// Monta o texto da Conta / Conferência / Cupom de Entrega no formato de 41 colunas do EiChefe
function buildContaText(order, garcom = 'STEPHANY', w = 41) {
  const vendaCod = String(order.id).padStart(8, '0');
  const dtShort = fmtDateEiChefe(order.createdAt || new Date(), false, true);
  const lines = [];

  if (order.type === 'delivery') {
    lines.push(`{B}VENDA: {/B}${vendaCod}`);
    lines.push(`${dtShort}      {B}GARCOM: {/B}${garcom}`);
  } else {
    const mesaNum = String(order.Table ? order.Table.number : order.id).padStart(3, '0');
    const labelLocal = order.type === 'mesa' ? 'MESA: ' : 'BALC: ';
    lines.push(`{B}VENDA: {/B}${vendaCod}                 {B}${labelLocal}{/B}${mesaNum}`);
    lines.push(`${dtShort}        {B}GARCOM: {/B}${garcom}`);
    if (order.Customer) {
      lines.push(`      {B}CLIENTE: {/B}${order.Customer.name.toUpperCase()}`);
    }
  }

  lines.push(lineSep(w, '-'));
  lines.push(`{B}QT{/B} DESCRICAO                UNIT    TOTAL`);

  let subtotal = 0;
  for (const it of order.items || []) {
    const qty = Number(it.quantity || 1);
    const unit = Number(it.unitPrice || 0);
    const tot = qty * unit;
    subtotal += tot;

    const qtStr = padLeft(String(qty), 2);
    const unitStr = padLeft(money(unit), 8);
    const totStr = padLeft(money(tot), 9);

    if (it.kind === 'pizza') {
      const sizeTitle = it.Size?.name ? `Pizza ${it.Size.name}` : 'Pizza Grande';
      lines.push(`${qtStr} ${padRight(sizeTitle, 21)}${unitStr}${totStr}`);
      const flavors = Array.isArray(it.flavorNames) && it.flavorNames.length
        ? it.flavorNames
        : [it.description || 'Tradicional'];
      for (const flv of flavors) {
        lines.push(`   > ${flv}`);
      }
      if (it.observations) {
        for (const wl of wrapLines(`--- OBS: ${it.observations}`, 35)) {
          lines.push(`   ${wl}`);
        }
      }
      if (it.Crust) {
        for (const wl of wrapLines(`- Borda ${it.Crust.name} R$ ${money(it.Crust.price)}`, 35)) {
          lines.push(`   ${wl}`);
        }
      }
    } else {
      const name = it.Product?.name || it.description || 'Produto';
      const wrapped = wrapLines(name, 21);
      lines.push(`${qtStr} ${padRight(wrapped[0], 21)}${unitStr}${totStr}`);
      for (let i = 1; i < wrapped.length; i++) {
        lines.push(`   ${wrapped[i]}`);
      }
      if (it.observations) {
        for (const wl of wrapLines(`--- OBS: ${it.observations}`, 35)) {
          lines.push(`   ${wl}`);
        }
      }
    }
  }

  // Obs. Geral do EiChefe
  if (order.notes) {
    lines.push('Obs. Geral:');
    lines.push(`{DH}{B}\n${order.notes}\n{/B}{/DH}`);
    lines.push(lineSep(w, '-'));
  }

  const deliv = Number(order.deliveryFee || 0);
  const disc = Number(order.discount || 0);
  const total = Number(order.totalAmount || (subtotal + deliv - disc));
  const paid = Number(order.paidAmount || 0);
  const remaining = Math.max(0, Number((total - paid).toFixed(2)));

  if (order.type === 'delivery') {
    lines.push('');
    lines.push('');
    lines.push(`               {DH}{B}ENTREGA: ${order.id}{/B}{/DH}`);
    if (order.isNewCustomer) {
      lines.push('CLIENTE NOVO');
    }
    lines.push(lineSep(w, '-'));
    lines.push(`{DH}{B}DADOS PARA ENTREGA{/B}{/DH}`);
    lines.push(`{B}Hora Pedido:{/B} ${fmtDateEiChefe(order.createdAt || new Date(), true, false)}`);
    lines.push(`{DH}{B}Nome:{/B} ${(order.Customer?.name || 'CLIENTE DELIVERY').toUpperCase()}{/DH}`);

    const street = (order.address || order.Customer?.address || '').trim();
    const num = (order.addressNumber || '').trim();
    const fullStreet = (num && !street.includes(num)) ? `${street}, ${num}` : street;
    const addrLines = wrapLines(fullStreet, 30);
    lines.push(`{B}Endereco:{/B} ${addrLines[0] || ''}`);
    for (let i = 1; i < addrLines.length; i++) {
      lines.push(`   ${addrLines[i]}`);
    }

    const rawBairro = (order.Neighborhood?.name || order.Customer?.neighborhood || '').replace(/^[,\s-]+/, '').trim();
    if (rawBairro) {
      lines.push(`{B}Bairro:{/B} ${rawBairro.toUpperCase()}`);
    }
    if (order.complement) {
      lines.push(`{B}Complemento:{/B} ${order.complement.toUpperCase()}`);
    }
    if (order.reference) {
      lines.push(`{B}Referencia:{/B} ${order.reference.toUpperCase()}`);
    }
    const phone = fmtPhoneEiChefe(order.Customer?.phone || '');
    if (phone) {
      lines.push(`{B}Telefone:{/B} ${phone}`);
    }
    lines.push(lineSep(w, '-'));
    lines.push('');
    const modeLabel = (order.deliveryMode === 'b' || String(order.deliveryMode || '').toUpperCase() === 'RETIRADA') ? 'RETIRADA' : 'DISK-ENTREGA';
    lines.push(dotLine('TIPO ENTREGA', modeLabel, w, true, false));
    lines.push(dotLine('FORMA DE PAGAMENTO', fmtPaymentEiChefe(order.paymentMethod || 'DINHEIRO').toUpperCase(), w, true, false));
    lines.push(dotLine('TAXA ENTREGA', `R$ ${money(deliv)}`, w, false, false));
    lines.push('');
    lines.push(dotLine('Total Itens', `R$ ${money(subtotal)}`, w, true, true));
    if (disc > 0) {
      lines.push(dotLine('Desconto', `R$ ${money(disc)}`, w, true, true));
    }
    if ((order.payments || []).length > 0) {
      lines.push('');
      lines.push(`               {B}PAGAMENTOS{/B}`);
      for (const pg of order.payments) {
        const label = pg.payerName ? `${pg.paymentMethod} (${pg.payerName})` : pg.paymentMethod;
        lines.push(dotLine(label, `R$ ${money(pg.amount)}`, w, false, false));
      }
      lines.push(dotLine('Total Pago', `R$ ${money(paid)}`, w, true, true));
    }
    lines.push('');
    const dueAmount = paid > 0 ? remaining : total;
    lines.push(`{DH}${dotLine('Total Devido', `R$ ${money(dueAmount)}`, w, true, true)}{/DH}`);
    lines.push('');
    const changeForVal = Number(order.changeFor || 0);
    const troco = (changeForVal > dueAmount && dueAmount > 0) ? (changeForVal - dueAmount) : 0;
    lines.push(`{B}${dotLine('TROCO DISK', `R$ ${money(troco)}`, w, false, false)}{/B}`);
    lines.push('');
    const aReceber = (changeForVal > dueAmount && dueAmount > 0) ? changeForVal : dueAmount;
    lines.push(`{DH}${dotLine('A RECEBER', `R$ ${money(aReceber)}`, w, true, true)}{/DH}`);
  } else {
    // Mesa / Balcão
    lines.push('');
    if ((order.payments || []).length > 0) {
      lines.push(`{DH}${dotLine('Total Itens', `R$ ${money(subtotal)}`, w, true, true)}{/DH}`);
      lines.push('');
      lines.push(`               {B}PAGAMENTOS{/B}`);
      for (const pg of order.payments) {
        const label = pg.payerName ? `${pg.paymentMethod} (${pg.payerName})` : pg.paymentMethod;
        lines.push(dotLine(label, `R$ ${money(pg.amount)}`, w, false, false));
      }
      lines.push(dotLine('Total Pago', `R$ ${money(paid)}`, w, true, true));
      lines.push('');
      lines.push(`{DH}${dotLine('Total Devido', `R$ ${money(remaining)}`, w, true, true)}{/DH}`);
    } else {
      lines.push(dotLine('Total Itens', `R$ ${money(subtotal)}`, w, true, true));
      if (disc > 0) {
        lines.push(dotLine('Desconto', `R$ ${money(disc)}`, w, true, true));
      }
      lines.push('');
      lines.push(`{DH}${dotLine('Total Devido', `R$ ${money(total)}`, w, true, true)}{/DH}`);
    }

    const splitCount = Math.max(1, Number(order.splitCount || 1));
    if (splitCount > 1) {
      lines.push('');
      const cota = +(total / splitCount).toFixed(2);
      lines.push(`{B}DIVISAO EM ${splitCount} PESSOAS:{/B}`);
      lines.push(dotLine(`Valor por Pessoa (${splitCount}x)`, `R$ ${money(cota)}`, w, true, true));
      if (paid > 0) {
        const partesPagas = remaining <= 0.01 ? splitCount : Math.min(splitCount - 1, Math.round(paid / cota));
        const partesFaltam = Math.max(0, splitCount - partesPagas);
        lines.push(dotLine('Partes Pagas', `${partesPagas} de ${splitCount} (R$ ${money(paid)})`, w));
        lines.push(dotLine('Restam Pagar', `${partesFaltam} parte(s) (R$ ${money(remaining)})`, w, true, true));
      }
    }
  }

  return lines.join('\n');
}

// Função exportável para imprimir a Conta / Cupom de Entrega no Caixa (EPSON CAIXA)
async function printOrderConta(orderId, operatorName = 'STEPHANY', { printerId = null, reprint = false } = {}) {
  await ensureDefaultPrinters();
  const order = await Order.findByPk(orderId, {
    include: [
      { model: Table },
      { model: Customer },
      { model: Neighborhood },
      { model: Courier },
      { model: OrderPayment, as: 'payments' },
      {
        model: OrderItem,
        as: 'items',
        include: [
          { model: Product, include: [{ model: Category }] },
          { model: Size },
          { model: Crust },
        ],
      },
    ],
  });
  if (!order) return [];

  const printers = await Printer.findAll({
    include: [{ model: PhysicalPrinter, as: 'physical', include: [{ model: PrintServer, as: 'server' }] }],
  });
  const caixaPrinter = printers.find(p => p.id === 1) || printers[0];
  const p = printerId ? (printers.find(x => x.id === Number(printerId)) || caixaPrinter) : caixaPrinter;
  const phys = p?.physical || { name: 'Caixa', path: 'EPSON CAIXA', columns: 41, char_type: 'pos', model_code: 13, interface_type: 3 };
  const w = Number(phys.columns) >= 40 ? Number(phys.columns) : 41;
  const garcom = String(operatorName || 'STEPHANY').toUpperCase();

  const content = buildContaText(order, garcom, w);
  await dispatchHardwarePrint(phys, p, content);

  const job = await PrintJob.create({
    order_id: order.id,
    printer_id: p?.id || 1,
    printer_name: p ? `${p.name} (${phys.name})` : phys.name,
    printer_path: phys.path,
    job_type: order.type === 'delivery' ? 'delivery' : 'conta',
    content,
    status: 'e',
    reprinted: Boolean(reprint),
    operator_name: garcom,
  });

  return [job];
}

// Monta o texto de cancelamento de item no formato de comanda do EiChefe
function buildCancelamentoText(order, item, qty, reason, garcom, w = 48) {
  const vendaCod = String(order.id).padStart(8, '0');
  const dtFull = fmtDateEiChefe(new Date(), true, true);
  const localNum = order.Table ? `MESA: ${order.Table.number}` : (order.type === 'delivery' ? `ENTREGA #${order.id}` : `BALCAO #${order.id}`);
  const lines = [];

  lines.push(lineSep(w, '='));
  lines.push('       {DH}*** CANCELAMENTO DE ITEM ***{/DH}');
  lines.push(lineSep(w, '='));
  lines.push(`VENDA: ${vendaCod}           ${dtFull}`);
  lines.push(`ATENDENTE: ${garcom}`);
  lines.push(`                    {DH}${localNum}{/DH}`);
  lines.push(lineSep(w, '-'));
  lines.push('');
  lines.push(`{BIG}CANCELADO: ${qty}x{/BIG}`);
  lines.push(`{BIG}${item.description || 'Produto'}{/BIG}`);
  lines.push('');
  lines.push(`{B}MOTIVO:{/B} ${reason}`);
  lines.push('');
  lines.push(lineSep(w, '-'));
  lines.push('   {B}ATENCAO COZINHA/BAR: NAO PREPARAR!{/B}');
  lines.push(lineSep(w, '='));
  lines.push('\n\n\n');
  return lines.join('\n');
}

async function printOrderCancelamento(orderId, itemId, qty, reason, garcom) {
  const order = await Order.findByPk(orderId, {
    include: [
      {
        model: OrderItem,
        as: 'items',
        include: [
          { model: Product, include: [{ model: Category, include: [{ model: Printer, as: 'printer', include: [{ model: PhysicalPrinter, as: 'physical' }] }] }] },
          Size, Crust,
        ],
      },
      Table, Customer,
    ],
  });
  if (!order) return [];
  const item = (order.items || []).find(x => x.id === Number(itemId));
  if (!item) return [];

  const printers = await Printer.findAll({
    where: { active: true },
    include: [{ model: PhysicalPrinter, as: 'physical' }],
  });
  const pizzaPrinter = printers.find(p => p.print_pizza) || printers[0];

  let targetPrinter = null;
  if (item.kind === 'pizza' || item.SizeId) {
    targetPrinter = pizzaPrinter;
  } else if (item.Product?.Category?.printer) {
    targetPrinter = item.Product.Category.printer;
  } else {
    targetPrinter = printers.find(p => p.print_items) || printers[0];
  }
  if (!targetPrinter) return [];

  const phys = targetPrinter.physical || { name: targetPrinter.name, path: '192.168.18.211', columns: 48, char_type: 'bt', model_code: 11, interface_type: 4 };
  const w = Number(phys.columns) >= 44 ? Number(phys.columns) : 48;
  const content = buildCancelamentoText(order, item, qty, reason, garcom, w);

  await dispatchHardwarePrint(phys, targetPrinter, content);

  const job = await PrintJob.create({
    order_id: order.id,
    printer_id: targetPrinter.id,
    printer_name: `${targetPrinter.name} (${phys.name})`,
    printer_path: phys.path,
    job_type: 'comanda_cancelamento',
    content,
    status: 'e',
    reprinted: false,
    operator_name: garcom,
  });

  return [job];
}

// Gera Comanda de Produção ou Conta (Mesa / Disk-Entrega) 100% idêntica ao impressao.ibd do EiChefe
router.post('/print-order/:orderId', authenticate, async (req, res) => {
  await ensureDefaultPrinters();
  const { type = 'conta', printerId = null, reprint = false } = req.body || {};

  if (type === 'comanda') {
    const jobs = await printOrderComanda(req.params.orderId, req.user?.username || 'ADMIN', { printerId, reprint });
    return res.json({ jobs });
  }

  const jobs = await printOrderConta(req.params.orderId, req.user?.username || 'STEPHANY', { printerId, reprint });
  if (!jobs || !jobs.length) return res.status(404).json({ error: 'Pedido não encontrado' });
  return res.json({ jobs });
});

router.post('/print-cancel/:orderId/:itemId', authenticate, async (req, res) => {
  const { quantity = 1, reason = 'Cancelado' } = req.body || {};
  const jobs = await printOrderCancelamento(req.params.orderId, req.params.itemId, quantity, reason, req.user?.username || 'ADMIN');
  res.json({ jobs });
});

router.printOrderComanda = printOrderComanda;
router.printOrderConta = printOrderConta;
router.printOrderCancelamento = printOrderCancelamento;
module.exports = router;
