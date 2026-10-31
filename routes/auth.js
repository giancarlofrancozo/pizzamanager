const express = require('express');
const bcrypt = require('bcrypt');
const { User } = require('../models');
const { sign, required } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password, pin } = req.body;
  const user = await User.findOne({ where: { username: (username || '').toLowerCase().trim() } });
  if (!user) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  if (user.active === false) {
    return res.status(403).json({ error: 'Funcionário desativado no sistema' });
  }

  let valid = false;
  if (password && (await bcrypt.compare(String(password), user.passwordHash))) {
    valid = true;
  } else if (pin && user.pin && String(pin).trim() === user.pin.trim()) {
    valid = true;
  }

  if (!valid) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }

  res.json({
    token: sign(user),
    user: {
      id: user.id,
      name: user.name || user.username,
      username: user.username,
      role: user.role,
      cargoNome: user.cargoNome,
      cargoId: user.cargoId,
      comCaixa: Boolean(user.comCaixa),
      acessoFinanceiro: Boolean(user.acessoFinanceiro),
      acessoEstoque: Boolean(user.acessoEstoque),
    },
  });
});

router.get('/waiters', async (req, res) => {
  const users = await User.findAll({
    where: { active: true },
    attributes: ['id', 'name', 'username', 'role', 'cargoNome'],
    order: [['name', 'ASC']],
  });
  res.json(users);
});

router.get('/me', required(), async (req, res) => {
  const user = await User.findByPk(req.user.id, {
    attributes: { exclude: ['passwordHash'] },
  });
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(user);
});

router.get('/users', required(['admin']), async (req, res) => {
  const users = await User.findAll({
    attributes: { exclude: ['passwordHash'] },
    order: [['active', 'DESC'], ['name', 'ASC']],
  });
  res.json(users);
});

router.post('/users', required(['admin']), async (req, res) => {
  const { name, username, password, pin, role, cargoId, cargoNome } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Dados obrigatórios' });
  const user = await User.create({
    name: name || username,
    username: username.toLowerCase().trim(),
    role: role || 'garcom',
    cargoId: cargoId || 1,
    cargoNome: cargoNome || 'Garçom',
    pin: pin || null,
    passwordHash: await bcrypt.hash(password, 10),
  });
  const safe = user.toJSON();
  delete safe.passwordHash;
  res.status(201).json(safe);
});

module.exports = router;
