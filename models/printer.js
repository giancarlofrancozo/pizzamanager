const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

// Espelha `impressoraservidor` do EiChefe
const PrintServer = sequelize.define('PrintServer', {
  name: { type: DataTypes.STRING, allowNull: false },
  ip: { type: DataTypes.STRING, defaultValue: '127.0.0.1' },
  port: { type: DataTypes.INTEGER, defaultValue: 9998 },
  type: { type: DataTypes.STRING, defaultValue: 'java' }, // 'php' | 'java' | 'bluetooth'
});

// Espelha `impressorafisica` do EiChefe
const PhysicalPrinter = sequelize.define('PhysicalPrinter', {
  name: { type: DataTypes.STRING, allowNull: false },
  path: { type: DataTypes.STRING, allowNull: false }, // Ex: 'EPSON CAIXA' ou IP '192.168.18.211'
  mode: { type: DataTypes.STRING, defaultValue: 'd' }, // 'c','n','d','s','w','r'
  columns: { type: DataTypes.INTEGER, defaultValue: 48 }, // `linhas` (colunas por linha: 41 ou 48)
  init_command: { type: DataTypes.STRING },
  end_command: { type: DataTypes.STRING },
  char_type: { type: DataTypes.STRING, defaultValue: 'pos' }, // 'pos' (Epson ESC/POS) | 'bt' (Bematech)
  model_code: { type: DataTypes.INTEGER, defaultValue: 13 }, // 13 = Epson, 11 = Bematech
  interface_type: { type: DataTypes.INTEGER, defaultValue: 4 }, // 3 = Spooler/USB Windows, 4 = Rede TCP/IP
});

// Espelha `impressora` (impressora lógica / setor) do EiChefe
const Printer = sequelize.define('Printer', {
  name: { type: DataTypes.STRING, allowNull: false }, // Caixa, Bebidas, Cozinha, Suco, Drink, Pizza
  init_command: { type: DataTypes.STRING },
  end_command: { type: DataTypes.STRING, defaultValue: '<br><br><br>' },
  cutter: { type: DataTypes.STRING, defaultValue: '2' }, // guilhotina ('0'=Não, '1'=Parcial, '2'=Total)
  beep: { type: DataTypes.INTEGER, defaultValue: 2 },
  print_items: { type: DataTypes.BOOLEAN, defaultValue: true },
});

// Espelha `impressao` + `vendaimpressa` do EiChefe
const PrintJob = sequelize.define('PrintJob', {
  order_id: { type: DataTypes.INTEGER },
  printer_id: { type: DataTypes.INTEGER },
  printer_name: { type: DataTypes.STRING },
  printer_path: { type: DataTypes.STRING },
  job_type: { type: DataTypes.STRING, defaultValue: 'comanda' }, // 'comanda' | 'conta' | 'delivery' | 'teste'
  content: { type: DataTypes.TEXT, allowNull: false },
  status: { type: DataTypes.STRING, defaultValue: 'e' }, // 'n'=Na fila, 'e'=Enviado/Impresso, 'x'=Erro, 'c'=Cancelado
  reprinted: { type: DataTypes.BOOLEAN, defaultValue: false },
  operator_name: { type: DataTypes.STRING },
});

module.exports = { PrintServer, PhysicalPrinter, Printer, PrintJob };
