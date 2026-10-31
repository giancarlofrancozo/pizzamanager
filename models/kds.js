const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

// Etapa da cozinha (EiChefe: kdsetapa) - ex.: Montagem, Forno, Finalizacao
const KdsStage = sequelize.define('KdsStage', {
  name: { type: DataTypes.STRING, allowNull: false },
  position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  targetMinutes: { type: DataTypes.INTEGER, defaultValue: 10 },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

// Historico de etapas por item (EiChefe: itemvendakds: inicio / final)
const ItemStageLog = sequelize.define('ItemStageLog', {
  startedAt: { type: DataTypes.DATE },
  finishedAt: { type: DataTypes.DATE },
});

module.exports = { KdsStage, ItemStageLog };
