const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { required } = require('../middleware/auth');
const {
  Order, OrderItem, OrderPayment, Product, Table, Customer, Size, Crust, KdsStage,
} = require('../models');
const nfeService = require('../services/nfe');

const orderInclude = [
  { model: OrderItem, as: 'items', include: [Product, Size, Crust, { model: KdsStage, as: 'currentStage' }] },
  { model: OrderPayment, as: 'payments' },
  Table, Customer,
];

// Helper para verificar se o executável do Projeto Nf-e Desktop está rodando no Windows
const isFiscalAppRunning = nfeService.isFiscalAppRunning;

/**
 * GET /api/fiscal/config
 * Retorna as configurações fiscais ativas e o status do serviço
 */
router.get('/config', required(['admin', 'caixa', 'garcom']), async (req, res) => {
  try {
    const config = nfeService.getFiscalConfig();
    const appRunning = await isFiscalAppRunning();
    const pendingFiles = nfeService.listPendingFiles();

    res.json({
      active: true,
      cnpj: config.cnpj,
      name: config.name,
      codigoEmissor: config.codigoEmissor,
      codigoLoja: config.codigoLoja,
      srcFolder: config.src,
      srcFolderExists: fs.existsSync(config.src),
      isFiscalAppRunning: appRunning,
      todayPendingCount: pendingFiles.length,
      model: '65', // NFC-e
      state: 'PR',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/fiscal/pending
 * Retorna lista de notas fiscais pendentes/processadas na pasta hoje
 */
router.get('/pending', required(['admin', 'caixa']), async (req, res) => {
  try {
    const list = nfeService.listPendingFiles();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/fiscal/preview/:orderId
 * Gera uma prévia do JSON fiscal antes de emitir
 */
router.get('/preview/:orderId', required(['admin', 'caixa', 'garcom']), async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.orderId, { include: orderInclude });
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

    const payload = nfeService.buildNfePayload(order, {
      customerCpf: req.query.cpf,
      customerName: req.query.name,
    });
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/fiscal/emit/:orderId
 * Emite a NFC-e para o pedido especificado
 * Opções no corpo: { cpf, name, mode: 'scanner' | 'cloud' | 'both' }
 */
router.post('/emit/:orderId', required(['admin', 'caixa', 'garcom']), async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.orderId, { include: orderInclude });
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

    const customerCpf = req.body.cpf || req.body.customerCpf || order.customerCpf || null;
    const customerName = req.body.name || req.body.customerName || order.customerName || order.Customer?.name || null;
    const mode = req.body.mode || 'scanner'; // Padrão: scanner (integração local com impressora via Projeto Nf-e)

    // 1. Emissão via Scanner (cria o JSON na pasta do desktop Projeto Nf-e)
    const fileResult = await nfeService.emitNfeFile(order, {
      customerCpf,
      customerName,
    });

    let cloudResult = null;
    if (mode === 'cloud' || mode === 'both') {
      try {
        cloudResult = await nfeService.emitNfeCloud(order, { customerCpf, customerName });
      } catch (cloudErr) {
        console.warn('[Fiscal] Erro na emissão em nuvem:', cloudErr.message);
        cloudResult = { success: false, error: cloudErr.message };
      }
    }

    // Atualizar pedido no banco de dados
    const patch = {
      nfeStatus: 'emitida',
      nfeFile: fileResult.filename,
    };
    if (customerCpf) patch.customerCpf = customerCpf;
    if (customerName) patch.customerName = customerName;
    if (cloudResult?.chaveNfe) patch.nfeKey = cloudResult.chaveNfe;
    if (cloudResult?.numeroProtocolo) patch.nfeProtocol = cloudResult.numeroProtocolo;

    await order.update(patch);

    const isRunning = await isFiscalAppRunning();

    res.json({
      success: true,
      orderId: order.id,
      fileResult,
      cloudResult,
      isFiscalAppRunning: isRunning,
      message: isRunning
        ? 'NFC-e enviada para o Projeto Nf-e Desktop com sucesso! Impressão fiscal acionada.'
        : 'NFC-e salva na pasta de integração. Abra o Projeto Nf-e para impressão.',
    });
  } catch (err) {
    console.error('[Fiscal] Erro na emissão:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/fiscal/launch
 * Inicia o Projeto Nf-e Desktop se estiver fechado
 */
router.post('/launch', required(['admin', 'caixa']), async (req, res) => {
  try {
    const isRunning = await isFiscalAppRunning();
    if (isRunning) {
      return res.json({ success: true, message: 'Projeto Nf-e Desktop já está em execução.' });
    }

    const started = nfeService.launchFiscalApp();
    if (!started) {
      return res.status(404).json({ error: 'Executável do Projeto Nf-e não encontrado no caminho padrão.' });
    }

    res.json({ success: true, message: 'Projeto Nf-e Desktop iniciado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
