const { sequelize } = require('../db');
const User = require('./user');
const Category = require('./category');
const Product = require('./product');
const Table = require('./table');
const Customer = require('./customer');
const Order = require('./order');
const OrderItem = require('./orderItem');
const { Size, Flavor, FlavorPrice, Crust } = require('./pizza');
const { Neighborhood, Courier } = require('./delivery');
const { KdsStage, ItemStageLog } = require('./kds');
const PaymentMethod = require('./paymentMethod');
const OrderPayment = require('./orderPayment');
const { PrintServer, PhysicalPrinter, Printer, PrintJob } = require('./printer');

PrintServer.hasMany(PhysicalPrinter, { foreignKey: 'PrintServerId' });
PhysicalPrinter.belongsTo(PrintServer, { foreignKey: 'PrintServerId', as: 'server' });
PhysicalPrinter.hasMany(Printer, { foreignKey: 'PhysicalPrinterId' });
Printer.belongsTo(PhysicalPrinter, { foreignKey: 'PhysicalPrinterId', as: 'physical' });
PrintServer.hasMany(Printer, { foreignKey: 'PrintServerId' });
Printer.belongsTo(PrintServer, { foreignKey: 'PrintServerId', as: 'server' });

Printer.hasMany(Category, { foreignKey: 'PrinterId' });
Category.belongsTo(Printer, { foreignKey: 'PrinterId', as: 'printer' });

Category.hasMany(Product, { foreignKey: 'CategoryId' });
Product.belongsTo(Category, { foreignKey: 'CategoryId' });

Order.hasMany(OrderItem, { foreignKey: 'OrderId', as: 'items', onDelete: 'CASCADE' });
OrderItem.belongsTo(Order, { foreignKey: 'OrderId' });
Order.hasMany(OrderPayment, { foreignKey: 'OrderId', as: 'payments', onDelete: 'CASCADE' });
OrderPayment.belongsTo(Order, { foreignKey: 'OrderId' });
Product.hasMany(OrderItem, { foreignKey: 'ProductId' });
OrderItem.belongsTo(Product, { foreignKey: 'ProductId' });

Table.hasMany(Order, { foreignKey: 'TableId' });
Order.belongsTo(Table, { foreignKey: 'TableId' });
Customer.hasMany(Order, { foreignKey: 'CustomerId' });
Order.belongsTo(Customer, { foreignKey: 'CustomerId' });
User.hasMany(Order, { foreignKey: 'UserId' });
Order.belongsTo(User, { foreignKey: 'UserId' });

// Pizza fracionada
Flavor.hasMany(FlavorPrice, { foreignKey: 'FlavorId', as: 'prices', onDelete: 'CASCADE' });
FlavorPrice.belongsTo(Flavor, { foreignKey: 'FlavorId' });
Size.hasMany(FlavorPrice, { foreignKey: 'SizeId', onDelete: 'CASCADE' });
FlavorPrice.belongsTo(Size, { foreignKey: 'SizeId' });
OrderItem.belongsTo(Size, { foreignKey: 'SizeId' });
OrderItem.belongsTo(Crust, { foreignKey: 'CrustId' });

// Delivery
Neighborhood.hasMany(Order, { foreignKey: 'NeighborhoodId' });
Order.belongsTo(Neighborhood, { foreignKey: 'NeighborhoodId' });
Courier.hasMany(Order, { foreignKey: 'CourierId' });
Order.belongsTo(Courier, { foreignKey: 'CourierId' });

// KDS
KdsStage.hasMany(OrderItem, { foreignKey: 'CurrentStageId' });
OrderItem.belongsTo(KdsStage, { foreignKey: 'CurrentStageId', as: 'currentStage' });
OrderItem.hasMany(ItemStageLog, { foreignKey: 'OrderItemId', as: 'logs', onDelete: 'CASCADE' });
ItemStageLog.belongsTo(OrderItem, { foreignKey: 'OrderItemId' });
ItemStageLog.belongsTo(KdsStage, { foreignKey: 'KdsStageId' });

module.exports = {
  sequelize, User, Category, Product, Table, Customer, Order, OrderItem,
  Size, Flavor, FlavorPrice, Crust, Neighborhood, Courier, KdsStage, ItemStageLog, PaymentMethod, OrderPayment,
  PrintServer, PhysicalPrinter, Printer, PrintJob,
};
