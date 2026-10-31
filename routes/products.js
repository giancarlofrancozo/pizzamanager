const express = require('express');
const { Product, Category } = require('../models');
const { required } = require('../middleware/auth');

const router = express.Router();
router.use(required());

// Categorias
router.get('/categories', async (req, res) => res.json(await Category.findAll({ order: [['name', 'ASC']] })));
router.post('/categories', required(['admin']), async (req, res) =>
  res.status(201).json(await Category.create(req.body)));
router.put('/categories/:id', required(['admin']), async (req, res) => {
  const c = await Category.findByPk(req.params.id);
  if (!c) return res.sendStatus(404);
  res.json(await c.update(req.body));
});
router.delete('/categories/:id', required(['admin']), async (req, res) => {
  await Category.destroy({ where: { id: req.params.id } });
  res.sendStatus(204);
});

// Produtos
router.get('/', async (req, res) => {
  const where = req.query.all ? {} : { active: true };
  res.json(await Product.findAll({ where, include: Category, order: [['name', 'ASC']] }));
});
router.post('/', required(['admin']), async (req, res) => res.status(201).json(await Product.create(req.body)));
router.put('/:id', required(['admin']), async (req, res) => {
  const p = await Product.findByPk(req.params.id);
  if (!p) return res.sendStatus(404);
  res.json(await p.update(req.body));
});
router.delete('/:id', required(['admin']), async (req, res) => {
  const p = await Product.findByPk(req.params.id);
  if (!p) return res.sendStatus(404);
  await p.update({ active: false });
  res.sendStatus(204);
});

module.exports = router;
