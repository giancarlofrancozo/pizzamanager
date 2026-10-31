const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const User = sequelize.define('User', {
  name: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Funcionário' },
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  pin: { type: DataTypes.STRING(10), allowNull: true },
  role: { type: DataTypes.STRING, defaultValue: 'garcom' }, // 'admin', 'gerente', 'garcom', 'cozinheiro', 'caixa', 'atendente', 'entregador'
  cargoId: { type: DataTypes.INTEGER, defaultValue: 1 },
  cargoNome: { type: DataTypes.STRING(50), defaultValue: 'Garçom' },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  comCaixa: { type: DataTypes.BOOLEAN, defaultValue: false }, // Se pode operar/abrir caixa
  comissao: { type: DataTypes.BOOLEAN, defaultValue: false }, // Se recebe comissão nas vendas
  taxaCalculo: { type: DataTypes.DECIMAL(5, 2), defaultValue: 10.00 }, // % de comissão
  acessoFinanceiro: { type: DataTypes.BOOLEAN, defaultValue: false }, // Permissão módulo financeiro
  acessoEstoque: { type: DataTypes.BOOLEAN, defaultValue: false }, // Permissão módulo estoque
  codigoInterno: { type: DataTypes.INTEGER, allowNull: true }, // Crachá / Cartão RFID
});

module.exports = User;
