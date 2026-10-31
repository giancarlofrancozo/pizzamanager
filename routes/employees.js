const express = require('express');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const { execFile } = require('child_process');
const { User } = require('../models');
const { required } = require('../middleware/auth');

const router = express.Router();

// Cargos oficiais do EiChefe com seus respectivos níveis e papéis padrão
const CARGOS_EICHEFE = [
  { id: 1, name: 'Garçom', nivel: 1, defaultRole: 'garcom', defaultComCaixa: false, defaultComissao: true },
  { id: 2, name: 'KDS / Cozinha', nivel: 2, defaultRole: 'cozinheiro', defaultComCaixa: false, defaultComissao: false },
  { id: 3, name: 'Gerente', nivel: 3, defaultRole: 'admin', defaultComCaixa: true, defaultComissao: true, defaultAcessoFinanceiro: true, defaultAcessoEstoque: true },
  { id: 4, name: 'Gerente Tablet', nivel: 4, defaultRole: 'admin', defaultComCaixa: true, defaultComissao: true },
  { id: 5, name: 'Caixa', nivel: 5, defaultRole: 'caixa', defaultComCaixa: true, defaultComissao: false, defaultAcessoEstoque: true },
  { id: 6, name: 'Atendente', nivel: 6, defaultRole: 'garcom', defaultComCaixa: false, defaultComissao: true },
  { id: 7, name: 'PDV', nivel: 7, defaultRole: 'caixa', defaultComCaixa: true, defaultComissao: false },
  { id: 8, name: 'Usuário Consulta', nivel: 8, defaultRole: 'garcom', defaultComCaixa: false, defaultComissao: false },
  { id: 9, name: 'Entregador', nivel: 9, defaultRole: 'garcom', defaultComCaixa: false, defaultComissao: true },
  { id: 10, name: 'Rodízio', nivel: 10, defaultRole: 'garcom', defaultComCaixa: false, defaultComissao: true },
];

function getCargoInfo(cargoId) {
  const cid = Number(cargoId || 1);
  return CARGOS_EICHEFE.find(c => c.id === cid) || CARGOS_EICHEFE[0];
}

// Lista cargos disponíveis
router.get('/cargos', required(), (req, res) => {
  res.json(CARGOS_EICHEFE);
});

// Lista todos os funcionários (com busca e filtros)
router.get('/', required(), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const active = req.query.active !== undefined ? req.query.active === 'true' || req.query.active === '1' : null;
    const cargoId = req.query.cargoId ? Number(req.query.cargoId) : null;

    const where = {};
    if (q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { username: { [Op.like]: `%${q}%` } },
        { cargoNome: { [Op.like]: `%${q}%` } },
      ];
    }
    if (active !== null) {
      where.active = active;
    }
    if (cargoId) {
      where.cargoId = cargoId;
    }

    const employees = await User.findAll({
      where,
      attributes: { exclude: ['passwordHash'] },
      order: [['active', 'DESC'], ['name', 'ASC']],
    });

    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Detalhes de um funcionário
router.get('/:id', required(), async (req, res) => {
  try {
    const emp = await User.findByPk(req.params.id, {
      attributes: { exclude: ['passwordHash'] },
    });
    if (!emp) return res.status(404).json({ error: 'Funcionário não encontrado' });
    res.json(emp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cadastra um novo funcionário
router.post('/', required(['admin']), async (req, res) => {
  try {
    const {
      name,
      username,
      password,
      pin,
      cargoId,
      active = true,
      comCaixa = false,
      comissao = false,
      taxaCalculo = 10.00,
      acessoFinanceiro = false,
      acessoEstoque = false,
      codigoInterno = null,
    } = req.body;

    const cleanUsername = String(username || '').trim().toLowerCase();
    const cleanName = String(name || '').trim();

    if (!cleanUsername || !cleanName) {
      return res.status(400).json({ error: 'Nome e usuário são obrigatórios' });
    }

    const existing = await User.findOne({ where: { username: cleanUsername } });
    if (existing) {
      return res.status(400).json({ error: `Usuário '${cleanUsername}' já está em uso` });
    }

    const cargo = getCargoInfo(cargoId);
    const passToHash = String(password || pin || '1234');
    const passwordHash = await bcrypt.hash(passToHash, 10);

    const emp = await User.create({
      name: cleanName,
      username: cleanUsername,
      passwordHash,
      pin: pin ? String(pin).trim() : null,
      role: cargo.defaultRole,
      cargoId: cargo.id,
      cargoNome: cargo.name,
      active: Boolean(active),
      comCaixa: Boolean(comCaixa),
      comissao: Boolean(comissao),
      taxaCalculo: taxaCalculo !== null && taxaCalculo !== undefined ? Number(taxaCalculo) : 10.00,
      acessoFinanceiro: Boolean(acessoFinanceiro),
      acessoEstoque: Boolean(acessoEstoque),
      codigoInterno: codigoInterno ? Number(codigoInterno) : null,
    });

    const safeObj = emp.toJSON();
    delete safeObj.passwordHash;
    res.status(201).json(safeObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualiza um funcionário existente
router.put('/:id', required(['admin']), async (req, res) => {
  try {
    const emp = await User.findByPk(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Funcionário não encontrado' });

    const {
      name,
      username,
      password,
      pin,
      cargoId,
      active,
      comCaixa,
      comissao,
      taxaCalculo,
      acessoFinanceiro,
      acessoEstoque,
      codigoInterno,
    } = req.body;

    const cleanUsername = username ? String(username).trim().toLowerCase() : emp.username;
    if (cleanUsername !== emp.username) {
      const existing = await User.findOne({ where: { username: cleanUsername } });
      if (existing && existing.id !== emp.id) {
        return res.status(400).json({ error: `Usuário '${cleanUsername}' já está em uso` });
      }
    }

    const cargo = cargoId ? getCargoInfo(cargoId) : null;
    const updateData = {};

    if (name) updateData.name = String(name).trim();
    if (cleanUsername) updateData.username = cleanUsername;
    if (pin !== undefined) updateData.pin = pin ? String(pin).trim() : null;
    if (password && String(password).trim().length > 0) {
      updateData.passwordHash = await bcrypt.hash(String(password).trim(), 10);
    }
    if (cargo) {
      updateData.cargoId = cargo.id;
      updateData.cargoNome = cargo.name;
      updateData.role = cargo.defaultRole;
    }
    if (active !== undefined) updateData.active = Boolean(active);
    if (comCaixa !== undefined) updateData.comCaixa = Boolean(comCaixa);
    if (comissao !== undefined) updateData.comissao = Boolean(comissao);
    if (taxaCalculo !== undefined) updateData.taxaCalculo = Number(taxaCalculo);
    if (acessoFinanceiro !== undefined) updateData.acessoFinanceiro = Boolean(acessoFinanceiro);
    if (acessoEstoque !== undefined) updateData.acessoEstoque = Boolean(acessoEstoque);
    if (codigoInterno !== undefined) updateData.codigoInterno = codigoInterno ? Number(codigoInterno) : null;

    await emp.update(updateData);

    const safeObj = emp.toJSON();
    delete safeObj.passwordHash;
    res.json(safeObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ativa ou Desativa um funcionário (Toggle rápido)
router.patch('/:id/toggle-active', required(['admin']), async (req, res) => {
  try {
    const emp = await User.findByPk(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Funcionário não encontrado' });

    // Impede desativar o admin padrão se for o único admin
    if (emp.username === 'admin' && emp.active) {
      const adminCount = await User.count({ where: { role: 'admin', active: true } });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Não é possível desativar o único administrador' });
      }
    }

    await emp.update({ active: !emp.active });
    res.json({ id: emp.id, active: emp.active, message: emp.active ? 'Funcionário ativado' : 'Funcionário desativado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove ou Desativa o funcionário
router.delete('/:id', required(['admin']), async (req, res) => {
  try {
    const emp = await User.findByPk(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Funcionário não encontrado' });
    if (emp.username === 'admin') {
      return res.status(400).json({ error: 'Não é permitido excluir o administrador principal' });
    }
    // Desativação segura (estilo EiChefe ativo='n')
    await emp.update({ active: false });
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sincroniza / Importa todos os funcionários do banco de dados do EiChefe (MySQL 3307)
router.post('/sync-eichefe', required(['admin']), async (req, res) => {
  const mysqlExe = 'c:/Projeot/eichefe-gestao/mysql/bin/mysql.exe';
  const query = 'SELECT f.codigo, f.nome, f.usuario, f.senha, c.codigo as cargoId, c.cargo as cargoNome, f.ativo, f.comissao, f.taxaCalculo, f.comCaixa, f.acessoFinanceiro, f.acessoEstoque, f.codigoInterno FROM funcionario f LEFT JOIN cargo c ON f.cargo=c.codigo ORDER BY f.codigo ASC;';
  const args = ['-P', '3307', '-u', 'like', '-p3be3HvR34MmfKqdtw7FT', 'eichefe-gestao', '-B', '-e', query];

  execFile(mysqlExe, args, async (err, stdout) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao conectar no banco do EiChefe: ' + (err.message || err) });
    }

    try {
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) {
        return res.json({ imported: 0, updated: 0, total: 0 });
      }

      const headers = lines[0].split('\t').map(h => h.trim());
      const rawRows = lines.slice(1).map(l => {
        const vals = l.split('\t');
        const obj = {};
        headers.forEach((h, i) => {
          let v = vals[i] !== undefined ? vals[i].trim() : null;
          if (v === 'NULL' || v === '') v = null;
          obj[h] = v;
        });
        return obj;
      });

      let imported = 0;
      let updated = 0;
      const defaultPassHash = await bcrypt.hash('1234', 10);

      for (const row of rawRows) {
        if (!row.usuario || !row.nome) continue;
        const cleanUser = row.usuario.toLowerCase().trim();
        const cleanName = row.nome.trim();
        const cid = Number(row.cargoId || 1);
        const cargo = getCargoInfo(cid);
        const isActive = row.ativo === 's';
        const comCaixa = row.comCaixa === 'sim' || row.comCaixa === 's';
        const comissao = row.comissao === 'y' || row.comissao === 's';
        const acessoFin = row.acessoFinanceiro === 'sim';
        const acessoEst = row.acessoEstoque === 'sim';
        const taxa = row.taxaCalculo ? Number(row.taxaCalculo) : 10.00;
        const codInt = row.codigoInterno ? Number(row.codigoInterno) : null;

        const existing = await User.findOne({ where: { username: cleanUser } });
        if (existing) {
          await existing.update({
            name: cleanName,
            cargoId: cid,
            cargoNome: row.cargoNome || cargo.name,
            role: cargo.defaultRole,
            active: isActive,
            comCaixa,
            comissao,
            taxaCalculo: taxa,
            acessoFinanceiro: acessoFin,
            acessoEstoque: acessoEst,
            codigoInterno: codInt,
          });
          updated++;
        } else {
          await User.create({
            name: cleanName,
            username: cleanUser,
            passwordHash: defaultPassHash,
            pin: '1234',
            cargoId: cid,
            cargoNome: row.cargoNome || cargo.name,
            role: cargo.defaultRole,
            active: isActive,
            comCaixa,
            comissao,
            taxaCalculo: taxa,
            acessoFinanceiro: acessoFin,
            acessoEstoque: acessoEst,
            codigoInterno: codInt,
          });
          imported++;
        }
      }

      res.json({
        ok: true,
        imported,
        updated,
        total: rawRows.length,
        message: `${imported} funcionários cadastrados e ${updated} atualizados a partir do EiChefe!`,
      });
    } catch (parseErr) {
      res.status(500).json({ error: 'Erro ao processar dados do EiChefe: ' + parseErr.message });
    }
  });
});

module.exports = router;
