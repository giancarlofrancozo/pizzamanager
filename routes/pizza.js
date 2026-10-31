const express = require('express');
const { Size, Flavor, FlavorPrice, Crust } = require('../models');
const { required } = require('../middleware/auth');

const router = express.Router();
router.use(required());

// Cardapio de pizzas completo: tamanhos, sabores com preco por tamanho e bordas
router.get('/menu', async (req, res) => {
  const [sizes, flavors, crusts] = await Promise.all([
    Size.findAll({ where: { active: true }, order: [['maxFlavors', 'ASC'], ['id', 'ASC']] }),
    Flavor.findAll({ where: { active: true }, include: [{ model: FlavorPrice, as: 'prices' }], order: [['name', 'ASC']] }),
    Crust.findAll({ where: { active: true }, order: [['price', 'ASC']] }),
  ]);
  res.json({ sizes, flavors, crusts });
});

const admin = required(['admin']);

// Tamanhos
router.post('/sizes', admin, async (req, res) => res.status(201).json(await Size.create(req.body)));
router.put('/sizes/:id', admin, async (req, res) => {
  const s = await Size.findByPk(req.params.id);
  if (!s) return res.sendStatus(404);
  res.json(await s.update(req.body));
});
router.delete('/sizes/:id', admin, async (req, res) => {
  await Size.update({ active: false }, { where: { id: req.params.id } });
  res.sendStatus(204);
});

// Bordas
router.post('/crusts', admin, async (req, res) => res.status(201).json(await Crust.create(req.body)));
router.put('/crusts/:id', admin, async (req, res) => {
  const c = await Crust.findByPk(req.params.id);
  if (!c) return res.sendStatus(404);
  res.json(await c.update(req.body));
});
router.delete('/crusts/:id', admin, async (req, res) => {
  await Crust.update({ active: false }, { where: { id: req.params.id } });
  res.sendStatus(204);
});

// Sabores: body { name, description, kind, prices: { "<sizeId>": preco } }
async function savePrices(flavorId, prices = {}) {
  for (const [sizeId, price] of Object.entries(prices)) {
    if (price === '' || price === null) {
      await FlavorPrice.destroy({ where: { FlavorId: flavorId, SizeId: sizeId } });
      continue;
    }
    const [row, created] = await FlavorPrice.findOrCreate({
      where: { FlavorId: flavorId, SizeId: sizeId }, defaults: { price },
    });
    if (!created) await row.update({ price });
  }
}
const withPrices = id => Flavor.findByPk(id, { include: [{ model: FlavorPrice, as: 'prices' }] });

router.post('/flavors', admin, async (req, res) => {
  const f = await Flavor.create(req.body);
  await savePrices(f.id, req.body.prices);
  res.status(201).json(await withPrices(f.id));
});
router.put('/flavors/:id', admin, async (req, res) => {
  const f = await Flavor.findByPk(req.params.id);
  if (!f) return res.sendStatus(404);
  await f.update(req.body);
  await savePrices(f.id, req.body.prices);
  res.json(await withPrices(f.id));
});
router.delete('/flavors/:id', admin, async (req, res) => {
  await Flavor.update({ active: false }, { where: { id: req.params.id } });
  res.sendStatus(204);
});

module.exports = router;
