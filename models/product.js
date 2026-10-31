const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Product = sequelize.define('Product', {
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  costPrice: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  imageUrl: { type: DataTypes.STRING },
  stockControl: { type: DataTypes.BOOLEAN, defaultValue: false },
  stock: { type: DataTypes.INTEGER, defaultValue: 0 },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  kitchen: { type: DataTypes.BOOLEAN, defaultValue: true },
});

module.exports = Product;
