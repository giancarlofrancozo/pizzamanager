const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Category = sequelize.define('Category', {
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  PrinterId: { type: DataTypes.INTEGER },
  print_separate: { type: DataTypes.STRING, defaultValue: 'n' }, // 'n'=Agrupado, 'p'=Por produto, 's'=Separado
});

module.exports = Category;
