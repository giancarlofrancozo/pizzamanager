const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

// Tamanho (EiChefe: pedaco + numerosabor) - maxFlavors = quantos sabores cabem
const Size = sequelize.define('Size', {
  name: { type: DataTypes.STRING, allowNull: false },
  maxFlavors: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

// Sabor (EiChefe: sabor)
const Flavor = sequelize.define('Flavor', {
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  kind: { type: DataTypes.ENUM('salgada', 'doce'), defaultValue: 'salgada' },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

// Preco do sabor por tamanho
const FlavorPrice = sequelize.define('FlavorPrice', {
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
});

// Borda (EiChefe: borda)
const Crust = sequelize.define('Crust', {
  name: { type: DataTypes.STRING, allowNull: false },
  price: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
});

module.exports = { Size, Flavor, FlavorPrice, Crust };
