const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'pizzamanager-local-secret';

function sign(user) {
  return jwt.sign({
    id: user.id,
    name: user.name || user.username,
    username: user.username,
    role: user.role,
    cargoNome: user.cargoNome,
    comCaixa: Boolean(user.comCaixa),
    acessoFinanceiro: Boolean(user.acessoFinanceiro),
    acessoEstoque: Boolean(user.acessoEstoque),
  }, SECRET, { expiresIn: '12h' });
}

function required(roles = []) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Nao autenticado' });
    try {
      req.user = jwt.verify(token, SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Token invalido' });
    }
    if (roles.length && req.user.role !== 'admin' && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Sem permissao' });
    }
    next();
  };
}

module.exports = { sign, required };
