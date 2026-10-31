const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { exec, spawn } = require('child_process');

// Caminho padrão da configuração oficial do Projeto Nf-e Desktop
const CONFIG_PATH = path.join(
  process.env.USERPROFILE || 'C:\\Users\\USER',
  'Documents',
  '.projetoNfe',
  'configuracao.conf'
);

function getFiscalConfig() {
  const defaults = {
    src: 'C:\\eichefe-gestao\\service\\temp\\nfe-json',
    token: '21deafe41d8b582cf9c0e66d51c3faf5',
    codigoEmissor: '320',
    codigoLoja: '322',
    codigoFuncionario: '558',
    cnpj: '20879782000198',
    name: 'caseiro-pizzaria',
    ipWebsocket: 'websocket.projetonfe.com.br',
    portaWebsocket: '80',
    conectarWebsocket: 'true',
    versaoWebsocket: '2.0',
    hostSistema: 'app.projetonfe.com.br',
  };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    }
  } catch (err) {
    console.warn('[Fiscal] Não foi possível ler configuracao.conf:', err.message);
  }
  return defaults;
}

/**
 * Classificação fiscal inteligente baseada na taxonomia histórica de 3.000+ notas emitidas
 * pela Caseiro Pizzaria no Ei Chef.
 */
function classifyItem(item) {
  const name = String(item.description || item.Product?.name || item.Size?.name || '').trim();
  const lower = name.toLowerCase();

  // 1. Pizza (CFOP 5102, NCM 19023000, perfilImposto 501 - tributação normal)
  if (item.kind === 'pizza' || lower.includes('pizza') || lower.includes('broto') || lower.includes('calzone')) {
    return {
      ncm: '19023000',
      cfop: '5102',
      perfilImposto: '501',
    };
  }

  // 2. Bebidas alcoólicas - Cervejas, Chopp, Doses, Caipirinhas (CFOP 5405 ST, NCM 22089000 / 22030000, perfil 502)
  if (
    lower.includes('cerveja') || lower.includes('chopp') || lower.includes('heineken') ||
    lower.includes('original') || lower.includes('skol') || lower.includes('brahma') ||
    lower.includes('amstel') || lower.includes('budweiser') || lower.includes('corona') ||
    lower.includes('caipirinha') || lower.includes('caipireja') || lower.includes('vodka') ||
    lower.includes('whisky') || lower.includes('destilado')
  ) {
    return {
      ncm: '22089000',
      cfop: '5405',
      perfilImposto: '502',
    };
  }

  // 3. Refrigerantes, Sucos e Águas (CFOP 5405 ST, NCM 22021000, perfil 502)
  if (
    lower.includes('coca') || lower.includes('guaran') || lower.includes('fanta') ||
    lower.includes('sprite') || lower.includes('pepsi') || lower.includes('soda') ||
    lower.includes('schweppes') || lower.includes('suco') || lower.includes('refrigerante') ||
    lower.includes('agua') || lower.includes('água') || lower.includes('tonica') ||
    lower.includes('tônica') || lower.includes('aquarius') || lower.includes('h2oh') ||
    lower.includes('dell valle') || lower.includes('matte') || lower.includes('chá')
  ) {
    return {
      ncm: '22021000',
      cfop: '5405',
      perfilImposto: '502',
    };
  }

  // 4. Sobremesas e Chocolates (CFOP 5102, NCM 17049020, perfil 501)
  if (
    lower.includes('sobremesa') || lower.includes('chocolate') || lower.includes('petit gateau') ||
    lower.includes('brownie') || lower.includes('sorvete') || lower.includes('picolé') ||
    lower.includes('doce') || lower.includes('pudim') || lower.includes('acai') || lower.includes('açaí')
  ) {
    return {
      ncm: '17049020',
      cfop: '5102',
      perfilImposto: '501',
    };
  }

  // 5. Porções, Lanches, Entradas e Pratos (CFOP 5102, NCM 21069090, perfil 501)
  return {
    ncm: '21069090',
    cfop: '5102',
    perfilImposto: '501',
  };
}

/**
 * Converte a forma de pagamento do sistema no código SEFAZ correspondente e na sigla de arquivo
 */
function mapPaymentMethod(methodName) {
  const m = String(methodName || '').toLowerCase().trim();
  if (m.includes('dinheiro')) return { code: '01', sigla: 'D', name: 'Dinheiro' };
  if (m.includes('cheque')) return { code: '02', sigla: 'O', name: 'Cheque' };
  if (m.includes('crédito') || m.includes('credito')) return { code: '03', sigla: 'C', name: 'Cartão de Crédito' };
  if (m.includes('débito') || m.includes('debito')) return { code: '04', sigla: 'C', name: 'Cartão de Débito' };
  if (m.includes('cartão') || m.includes('cartao')) return { code: '04', sigla: 'C', name: 'Cartão' };
  if (m.includes('pix')) return { code: '17', sigla: 'P', name: 'PIX' };
  if (m.includes('vale') || m.includes('alimenta') || m.includes('refei')) return { code: '10', sigla: 'V', name: 'Vale Alimentação' };
  if (m.includes('desconto') || m.includes('brinde')) return { code: '99', sigla: 'B', name: 'Desconto/Brinde' };
  return { code: '99', sigla: 'O', name: 'Outros' };
}

/**
 * Monta o payload completo no formato NfeFileJson que o Projeto Nf-e consome
 */
function buildNfePayload(order, options = {}) {
  const cfg = getFiscalConfig();
  const customerCpf = options.customerCpf || order.customerCpf || options.cpf || null;
  const customerName = options.customerName || order.customerName || options.name || order.Customer?.name || null;

  // Filtrar itens ativos (não cancelados)
  const rawItems = (order.items || []).filter(item => !item.cancelledAt);

  const produtos = rawItems.map((item, idx) => {
    const classification = classifyItem(item);
    const itemName = item.description || (item.kind === 'pizza' ? `Pizza ${item.Size?.name || ''}`.trim() : item.Product?.name) || 'Item';
    const itemCode = item.kind === 'pizza'
      ? `PZ${String(item.SizeId || idx + 1).padStart(8, '0')}`
      : `PD${String(item.ProductId || idx + 1).padStart(8, '0')}`;

    const qty = Number(item.quantity) || 1;
    const unitVal = Number(item.unitPrice) || 0;

    const hash = crypto
      .createHash('md5')
      .update(`${order.id}_${item.id || idx}_${itemName}_${qty}_${unitVal}`)
      .digest('hex');

    return {
      hash,
      codigo: itemCode,
      referencia: null,
      codigoBarra: null,
      nome: itemName.substring(0, 120),
      ncm: classification.ncm,
      cfop: classification.cfop,
      qtde: qty.toFixed(1),
      unidade: { principal: 'un', sigla: 'un', proporcao: 1 },
      valor: unitVal,
      perfilImposto: classification.perfilImposto,
    };
  });

  // Mapear pagamentos
  const pagamentos = [];
  if (Array.isArray(order.payments) && order.payments.length > 0) {
    for (const p of order.payments) {
      const pm = mapPaymentMethod(p.paymentMethod);
      pagamentos.push({
        formaPagamento: pm.code,
        valor: Number(p.amount || 0).toFixed(2),
      });
    }
  } else {
    const pm = mapPaymentMethod(order.paymentMethod);
    pagamentos.push({
      formaPagamento: pm.code,
      valor: Number(order.totalAmount || 0).toFixed(2),
    });
  }

  // Mapear tipo de venda
  let siglaTipo = 'b';
  let tipoDesc = 'Balcão';
  let numeroVenda = String(order.id);

  if (order.type === 'mesa') {
    siglaTipo = 'm';
    tipoDesc = 'Mesa';
    numeroVenda = String(order.Table?.number || order.tableNumber || order.id);
  } else if (order.type === 'delivery') {
    siglaTipo = 'd';
    tipoDesc = 'Disk-entrega';
    numeroVenda = String(order.id);
  }

  // Destinatário (se informado CPF)
  let destinatario = [];
  if (customerCpf) {
    const cleanCpf = String(customerCpf).replace(/\D/g, '');
    if (cleanCpf.length === 11) {
      destinatario = {
        cpf: cleanCpf,
        ...(customerName ? { nome: String(customerName).trim().substring(0, 60) } : {}),
      };
    } else if (cleanCpf.length === 14) {
      destinatario = {
        cnpj: cleanCpf,
        ...(customerName ? { nome: String(customerName).trim().substring(0, 60) } : {}),
      };
    }
  }

  const payload = {
    id: String(order.id),
    token: cfg.token,
    idNfe: {
      idNfeXml: null,
      chaveNfe: null,
    },
    idEmissor: String(cfg.codigoEmissor || '320'),
    cabecalho: {
      modelo: '65',
      serie: '',
      tipoDocumento: '1',
      tipoAmbiente: null,
      tipoImpressao: '4',
      tipoEmissao: '1',
      finalidadeEmissao: '1',
      naturezaOperacao: 'Venda de Mercadoria',
      consumidorFinal: 's',
      indicacaoPagamento: '0',
      indicacaoPresenca: '1',
      informacaoAdicional: '',
    },
    destinatario,
    produtos,
    frete: {
      modalidade: '9',
    },
    pagamentos,
    rodape: {
      desconto: Number(order.discount || 0),
      outros: (order.type === 'delivery' && Number(order.deliveryFee) > 0) ? Number(order.deliveryFee) : 0,
    },
    venda: {
      siglaTipo,
      tipo: tipoDesc,
      numero: numeroVenda,
      ip: '127.0.0.1',
      funcionario: Number(cfg.codigoFuncionario || 19),
    },
  };

  return payload;
}

/**
 * Salva o arquivo JSON no diretório monitorado pelo scanner do Projeto Nf-e Desktop
 * Caminho: C:\eichefe-gestao\service\temp\nfe-json\<DD-MM-YYYY>\<Sigla>_<HH-MM>_<idVenda>_<valorTotal>{_obs}.json
 */
async function emitNfeFile(order, options = {}) {
  const cfg = getFiscalConfig();
  const payload = buildNfePayload(order, options);

  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const dateFolder = `${day}-${month}-${year}`;

  const targetDir = path.join(cfg.src, dateFolder);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Determinar a sigla principal de pagamento
  const mainPaymentMethod = (order.payments && order.payments[0])
    ? order.payments[0].paymentMethod
    : order.paymentMethod;
  const pm = mapPaymentMethod(mainPaymentMethod);

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}-${minutes}`;

  const totalStr = Number(order.totalAmount || 0).toFixed(2);

  // Sufixo opcional (nome do cliente ou tipo)
  let suffix = '';
  const customerName = options.customerName || order.Customer?.name || order.customerName;
  if (customerName) {
    const cleanName = customerName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
    suffix = `_${cleanName}`;
  } else if (order.type === 'mesa') {
    suffix = `_mesa`;
  }

  const filename = `${pm.sigla}_${timeStr}_${order.id}_${totalStr}${suffix}.json`;
  const fullPath = path.join(targetDir, filename);

  const jsonStr = JSON.stringify(payload, null, 2);
  fs.writeFileSync(fullPath, jsonStr, 'utf-8');

  console.log(`[Fiscal] NFC-e gerada no scanner: ${fullPath}`);

  // Se o Projeto Nf-e Desktop não estiver aberto, abre automaticamente em segundo plano
  try {
    isFiscalAppRunning().then((running) => {
      if (!running) {
        launchFiscalApp();
      }
    }).catch(() => {});
  } catch (_) {}

  return {
    success: true,
    mode: 'scanner',
    filename,
    filePath: fullPath,
    folder: targetDir,
    payload,
  };
}

/**
 * Envia diretamente para a API na nuvem do Projeto Nf-e
 * Endpoint: https://app.projetonfe.com.br/{codigoLoja}/api/json/emissao/send/{id}.html
 */
async function emitNfeCloud(order, options = {}) {
  const cfg = getFiscalConfig();
  const payload = buildNfePayload(order, options);

  const postData = new URLSearchParams();
  postData.append('idEmissor', String(cfg.codigoEmissor || '320'));
  postData.append('token', cfg.token);
  postData.append('idFuncionario', String(cfg.codigoFuncionario || '558'));
  postData.append('send', '1');
  postData.append('xml', 'n');
  postData.append('nfe', JSON.stringify(payload));
  postData.append('filename', `D_${order.id}_${Date.now()}.json`);

  const url = `https://${cfg.hostSistema || 'app.projetonfe.com.br'}/${cfg.codigoLoja}/api/json/emissao/send/${order.id}.html`;

  return new Promise((resolve, reject) => {
    const postBody = postData.toString();
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postBody),
        },
        timeout: 15000,
      },
      (res) => {
        let rawData = '';
        res.setEncoding('latin1');
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            resolve({
              success: parsed.status === 1 || parsed.codigo === 0,
              response: parsed,
              chaveNfe: parsed.nfe?.chaveNfe,
              numeroProtocolo: parsed.nfe?.numeroProtocolo,
              motivoNfe: parsed.nfe?.motivoNfe,
              statusNfe: parsed.nfe?.statusNfe,
              rawData,
            });
          } catch (err) {
            resolve({
              success: false,
              error: 'Resposta não é JSON válido',
              rawData,
            });
          }
        });
      }
    );

    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na comunicação com SEFAZ / Projeto Nf-e'));
    });

    req.write(postBody);
    req.end();
  });
}

/**
 * Lista os arquivos fiscais pendentes no diretório monitorado
 */
function listPendingFiles() {
  const cfg = getFiscalConfig();
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const dateFolder = `${day}-${month}-${year}`;
  const targetDir = path.join(cfg.src, dateFolder);

  if (!fs.existsSync(targetDir)) return [];

  const files = fs.readdirSync(targetDir);
  return files.map((file) => {
    const fullPath = path.join(targetDir, file);
    const stats = fs.statSync(fullPath);
    return {
      file,
      path: fullPath,
      size: stats.size,
      time: stats.mtime,
    };
  });
}

/**
 * Verifica se o Projeto Nf-e Desktop está em execução no Windows
 */
function isFiscalAppRunning() {
  return new Promise((resolve) => {
    exec('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name = \'javaw.exe\' or Name = \'projetonfe-desktop.exe\'\\").CommandLine -match \'projetonfe\'"', (err, stdout) => {
      if (!err && stdout && stdout.toLowerCase().includes('projetonfe')) {
        return resolve(true);
      }
      exec('tasklist /FI "IMAGENAME eq projetonfe-desktop.exe" /NH', (err2, stdout2) => {
        if (!err2 && stdout2 && stdout2.toLowerCase().includes('projetonfe-desktop.exe')) {
          return resolve(true);
        }
        resolve(false);
      });
    });
  });
}

/**
 * Inicia o executável do Projeto Nf-e Desktop
 */
function launchFiscalApp() {
  const appPath = path.join(
    process.env.LOCALAPPDATA || 'C:\\Users\\USER\\AppData\\Local',
    'Programs',
    'Like Sistemas',
    'Projeto Nf-e App',
    'projetonfe-desktop.exe'
  );

  if (fs.existsSync(appPath)) {
    const child = spawn(appPath, [], { detached: true, stdio: 'ignore' });
    child.unref();
    console.log('[Fiscal] Projeto Nf-e Desktop iniciado automaticamente.');
    return true;
  }
  return false;
}

module.exports = {
  getFiscalConfig,
  classifyItem,
  mapPaymentMethod,
  buildNfePayload,
  emitNfeFile,
  emitNfeCloud,
  listPendingFiles,
  isFiscalAppRunning,
  launchFiscalApp,
};
