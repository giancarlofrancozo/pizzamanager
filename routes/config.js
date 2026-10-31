const express = require('express');
const { Neighborhood, Courier, KdsStage, PaymentMethod } = require('../models');
const { required } = require('../middleware/auth');

const router = express.Router();
router.use(required());
const admin = required(['admin']);

function crud(path, Model, order) {
  router.get(path, async (req, res) =>
    res.json(await Model.findAll({ where: req.query.all ? {} : { active: true }, order })));
  router.post(path, admin, async (req, res) => res.status(201).json(await Model.create(req.body)));
  router.put(`${path}/:id`, admin, async (req, res) => {
    const row = await Model.findByPk(req.params.id);
    if (!row) return res.sendStatus(404);
    res.json(await row.update(req.body));
  });
  router.delete(`${path}/:id`, admin, async (req, res) => {
    await Model.update({ active: false }, { where: { id: req.params.id } });
    res.sendStatus(204);
  });
}

crud('/neighborhoods', Neighborhood, [['name', 'ASC']]);
crud('/couriers', Courier, [['name', 'ASC']]);
crud('/stages', KdsStage, [['position', 'ASC']]);
crud('/payment-methods', PaymentMethod, [['name', 'ASC']]);

module.exports = router;
