const $app = document.getElementById('app');
const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
const mins = ms => Math.max(0, Math.round(ms / 60000));
const TYPE = { mesa: 'Salão', balcao: 'Balcão', delivery: 'Delivery' };
const STATUS = { pendente: 'pendente', preparo: 'em preparo', pronto: 'pronto', saiu: 'saiu p/ entrega', entregue: 'entregue', cancelado: 'cancelado' };
const typeChip = t => `<span class="chip ${t}">${TYPE[t] || t}</span>`;
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

let token = localStorage.getItem('token');
let me = JSON.parse(localStorage.getItem('me') || 'null');
let tab = 'pedido';
let timer = null;

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2800);
}

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/auth/login') { logout(); throw new Error('Sessao expirada'); }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Erro ' + res.status);
  return data;
}
const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

function logout() { token = null; me = null; localStorage.clear(); render(); }

// Modal simples: devolve o overlay; onOk recebe o overlay
function modal(title, bodyHtml, onOk, okLabel = 'Confirmar', customClass = '') {
  const o = document.createElement('div');
  o.className = 'overlay';
  const showFooter = onOk !== null;
  const footerHtml = showFooter ? `
    <div class="row" style="margin-top:14px;justify-content:flex-end">
      <button class="btn sec" data-x>Cancelar</button>
      ${typeof onOk === 'function' ? `<button class="btn ok" data-ok>${okLabel || 'Confirmar'}</button>` : ''}
    </div>` : '';
  o.innerHTML = `<div class="modal ${customClass}"><h3>${esc(title)}</h3>${bodyHtml}${footerHtml}</div>`;
  document.body.appendChild(o);
  const close = () => o.remove();
  const btnX = o.querySelector('[data-x]');
  if (btnX) btnX.onclick = close;
  o.onclick = e => { if (e.target === o) close(); };
  const btnOk = o.querySelector('[data-ok]');
  if (btnOk && typeof onOk === 'function') {
    btnOk.onclick = safe(async () => { await onOk(o); close(); });
  }
  return o;
}

// Modal de Lançamento de Produto com Observações e Quantidade (estilo acrescimos.tpl do EiChefe)
function openProductItemModal(p, initialObs = '', initialQty = 1, onConfirm) {
  let qty = Math.max(1, parseInt(initialQty, 10) || 1);
  const unit = Number(p.price || 0);

  // Sugestões de observações rápidas estilo EiChefe por categoria
  const catName = (p.Category?.name || p.categoryName || '').toLowerCase();
  const isDrink = /bebida|refrigerante|suco|cerveja|agua|água|drink|vinho/i.test(catName + ' ' + p.name);
  const drinkChips = ['Sem Gelo', 'Gelo e Limão', 'Bem Gelada', 'Copo Descartável', 'Sem Açúcar', 'Com Canudo', 'Temp. Ambiente'];
  const foodChips = ['Sem Cebola', 'Ao Ponto', 'Bem Passado', 'Mal Passado', 'Sem Sal', 'Molho à Parte', 'Caprichado', 'Para Viagem', 'Separado'];
  const chips = isDrink ? drinkChips : foodChips;

  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `
    <div class="modal eichefe-item-modal" style="max-width: 460px; width: 95%;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #e9ecef;padding-bottom:10px;margin-bottom:14px">
        <div>
          <h3 style="margin:0;font-size:18px;color:#252c38">🍽️ ${esc(p.name)}</h3>
          <span class="muted" style="font-size:12px">${esc(p.Category?.name || 'Item do Cardápio')} ${p.stockControl ? ` • Estoque: ${p.stock}` : ''}</span>
        </div>
        <div style="font-size:18px;font-weight:800;color:#28a745;white-space:nowrap">${brl(unit)}</div>
      </div>

      <div style="margin-bottom:14px">
        <label style="display:block;font-weight:700;font-size:13px;color:#495057;margin-bottom:6px">Quantidade:</label>
        <div style="display:flex;align-items:center;gap:10px">
          <button type="button" class="btn sec" id="m-item-minus" style="width:44px;height:42px;font-size:22px;font-weight:bold;line-height:1">-</button>
          <input type="number" id="m-item-qty" min="1" value="${qty}" style="width:70px;height:42px;text-align:center;font-size:18px;font-weight:bold">
          <button type="button" class="btn sec" id="m-item-plus" style="width:44px;height:42px;font-size:22px;font-weight:bold;line-height:1">+</button>
          <div id="m-item-subtot" style="margin-left:auto;font-weight:800;font-size:16px;color:#252c38">${brl(unit * qty)}</div>
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="display:block;font-weight:700;font-size:13px;color:#495057;margin-bottom:6px">
          Observação do Item <small class="muted" style="font-weight:normal">(sai na comanda e cupom)</small>:
        </label>
        <div class="obs-quick-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
          ${chips.map(c => `<button type="button" class="btn sec sm m-chip" data-chip="${esc(c)}" style="border-radius:14px;padding:3px 10px;font-size:11.5px;background:#f8f9fa">+ ${esc(c)}</button>`).join('')}
        </div>
        <textarea id="m-item-obs" rows="2" placeholder="Digite uma observação (ex: bem gelada, 2 copos, sem cebola)..." style="width:100%;border-radius:4px;padding:8px;font-size:13.5px;border:1px solid #ced4da;box-sizing:border-box">${esc(initialObs)}</textarea>
      </div>

      <div class="row" style="justify-content:flex-end;gap:8px">
        <button type="button" class="btn sec" id="m-item-cancel">Cancelar (Esc)</button>
        <button type="button" class="btn ok" id="m-item-add" style="padding:8px 18px;font-weight:700">✅ Confirmar Item</button>
      </div>
    </div>
  `;
  document.body.appendChild(o);

  const close = () => {
    window.removeEventListener('keydown', keyHandler);
    o.remove();
  };
  const inputQty = o.querySelector('#m-item-qty');
  const inputObs = o.querySelector('#m-item-obs');
  const subtotEl = o.querySelector('#m-item-subtot');

  const updateSubtotal = () => {
    qty = Math.max(1, parseInt(inputQty.value, 10) || 1);
    inputQty.value = qty;
    subtotEl.textContent = brl(unit * qty);
  };

  o.querySelector('#m-item-minus').onclick = () => { if (qty > 1) { qty--; inputQty.value = qty; updateSubtotal(); } };
  o.querySelector('#m-item-plus').onclick = () => { qty++; inputQty.value = qty; updateSubtotal(); };
  inputQty.oninput = updateSubtotal;

  o.querySelectorAll('.m-chip').forEach(btn => {
    btn.onclick = () => {
      const chipText = btn.dataset.chip;
      let cur = inputObs.value.trim();
      if (!cur) {
        inputObs.value = chipText;
      } else if (cur.toLowerCase().includes(chipText.toLowerCase())) {
        const regex = new RegExp(`(^|,\\s*)${chipText}`, 'gi');
        inputObs.value = cur.replace(regex, '').replace(/^,\s*/, '').trim();
      } else {
        inputObs.value = cur + ', ' + chipText;
      }
      inputObs.focus();
    };
  });

  const confirmAdd = () => {
    const finalObs = inputObs.value.trim();
    onConfirm({ qty, obs: finalObs });
    close();
  };

  o.querySelector('#m-item-add').onclick = confirmAdd;
  o.querySelector('#m-item-cancel').onclick = close;
  o.onclick = e => { if (e.target === o) close(); };

  const keyHandler = (e) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter' && e.target !== inputObs) {
      e.preventDefault();
      confirmAdd();
    }
  };
  window.addEventListener('keydown', keyHandler);

  setTimeout(() => inputObs.focus(), 60);
}

// ---------- Login ----------
function renderLogin() {
  $app.innerHTML = `
    <div class="card login">
      <h2>🍕 Pizza Manager</h2>
      <input id="u" placeholder="Usuario" value="admin">
      <input id="p" type="password" placeholder="Senha">
      <button class="btn" id="go" style="width:100%">Entrar</button>
      <p class="muted">Padrao: admin / admin123</p>
    </div>`;
  const go = safe(async () => {
    const r = await api('/auth/login', 'POST', { username: $('u').value, password: $('p').value });
    token = r.token; me = r.user;
    localStorage.setItem('token', token); localStorage.setItem('me', JSON.stringify(me));
    render();
  });
  $('go').onclick = go;
  $('p').onkeydown = e => { if (e.key === 'Enter') go(); };
}

// ---------- Shell ----------
const TABS = [
  ['pedido', 'Novo Pedido'], ['mesas', '🍽️ Mesas'], ['balcao', '🛍️ Balcão'], ['delivery', '🛵 Delivery'], ['pedidos', 'Pedidos'], ['cozinha', 'Cozinha (KDS)'],
  ['dashboard', 'Dashboard'], ['produtos', 'Produtos'], ['clientes', 'Clientes'], ['impressoras', '🖨️ Impressoras'],
  ['fiscal', '🧾 Fiscal (NFC-e)'], ['funcionarios', '👥 Funcionários'], ['cadastros', 'Cadastros'],
];
const ADMIN_ONLY = ['cadastros', 'funcionarios'];
let initialOrderType = null;
let initialTableId = null;
let initialOrderId = null;

function render() {
  clearInterval(timer);
  if (!token) return renderLogin();
  const userRole = me?.role || 'garcom';
  const userName = me?.name || me?.username || 'Usuário';
  const tabs = TABS.filter(([k]) => !ADMIN_ONLY.includes(k) || userRole === 'admin')
    .filter(([k]) => k !== 'dashboard' || ['admin', 'caixa'].includes(userRole))
    .filter(([k]) => k !== 'fiscal' || ['admin', 'caixa'].includes(userRole));
  $app.innerHTML = `
    <header>
      <h1>🍕 Caseiro Pizzaria</h1>
      <nav>${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</nav>
      <span class="user" style="display:flex;align-items:center;gap:8px;">
        <a href="/garcom" target="_blank" class="btn sm" style="background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:4px 8px;border-radius:6px;font-size:0.75rem;">📱 App Garçom</a>
        <a href="/download/Caseiro-Pizzaria.apk" class="btn sm" style="background:#0284c7;color:#fff;text-decoration:none;font-weight:700;padding:4px 8px;border-radius:6px;font-size:0.75rem;">📥 Baixar APK</a>
        <span>${esc(userName)} (${userRole})</span>
        <button class="btn sec sm" id="out">Sair</button>
      </span>
    </header>
    <main id="view"></main>`;
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); });
  $('out').onclick = logout;
  const views = { pedido: viewNovoPedido, mesas: viewMesas, balcao: viewBalcao, delivery: viewDelivery, pedidos: viewPedidos, cozinha: viewCozinha, dashboard: viewDashboard, produtos: viewProdutos, clientes: viewClientes, impressoras: viewImpressoras, fiscal: viewFiscal, funcionarios: viewFuncionarios, cadastros: viewCadastros };
  safe(views[tab] || viewNovoPedido)();
}
const view = () => $('view');

// Renderização do Card de Mesa Idêntico ao EiChefe Gestão (.cadaMesa, .bordaMesa)
function renderMesaCard(t, isSelected = false, displayMode = 'tempo') {
  let statusClass = 'mesaLivre';
  if (t.isOpen) {
    if (t.status === 'pronto') statusClass = 'mesaPronto';
    else if (t.status === 'fechamento') statusClass = 'mesaFechamento';
    else statusClass = 'mesaAberta';
  }

  const opName = t.order?.operatorName ? esc(t.order.operatorName) : (t.isOpen ? 'Em Aberto' : 'LIVRE');
  const timeVal = t.order?.timeStr || '00:00';
  const priceVal = t.order ? brl(t.order.total) : 'LIVRE';
  const mainVal = t.isOpen ? (displayMode === 'tempo' ? timeVal : priceVal) : 'LIVRE';
  const altVal = t.isOpen ? (displayMode === 'tempo' ? priceVal : timeVal) : 'LIVRE';
  const custName = t.order?.customerName ? esc(t.order.customerName) : '';
  const splitCount = Number(t.order?.splitCount || 1);

  return `
    <div class="cadaMesa ${statusClass} ${isSelected ? 'selected' : ''}" data-id="${t.id}" data-num="${t.number}">
      <div class="bordaMesa">
        <div class="nomeFuncionario" title="${opName}">${opName}</div>
        <div class="numeroMesa" title="Mesa ${t.number}">${t.number}</div>
        <div class="quadros-row">
          ${t.isOpen ? `
            <button type="button" class="quadro-btn cli" title="Cliente / Vincular" data-mcli="${t.id}">CLI</button>
            <button type="button" class="quadro-btn m" title="Mudar / Transferir Mesa" data-mmudar="${t.number}">M</button>
            <button type="button" class="quadro-btn v" title="Ver Detalhes do Pedido" data-mver="${t.id}">V</button>
            <button type="button" class="quadro-btn imp" title="Imprimir Conferência" data-mimp="${t.order?.id}">IMP</button>
            ${t.hasReadyItem ? `<button type="button" class="quadro-btn pronto" title="Prato Pronto na Cozinha (KDS)">✓</button>` : ''}
          ` : `
            <button type="button" class="quadro-btn desativado" tabindex="-1">CLI</button>
            <button type="button" class="quadro-btn desativado" tabindex="-1">M</button>
            <button type="button" class="quadro-btn desativado" tabindex="-1">V</button>
            <button type="button" class="quadro-btn desativado" tabindex="-1">IMP</button>
          `}
        </div>
        <div class="valorMesa" 
             onmouseover="if('${t.isOpen}'==='true'){this.textContent='${altVal}';}" 
             onmouseout="if('${t.isOpen}'==='true'){this.textContent='${mainVal}';}"
             title="${t.isOpen ? 'Clique para ver ou lançar itens' : 'Mesa Livre'}">
          ${mainVal}
        </div>
        ${splitCount > 1 ? `
          <div class="divisaoMesaBadge" title="Conta dividida em ${splitCount} pessoas (${brl(t.order.total / splitCount)}/pessoa)">
            👥 ${splitCount}x (${brl(t.order.total / splitCount)})
          </div>
        ` : ''}
      </div>
      ${custName ? `<div class="nomeClienteMesa" title="${custName}">${custName}</div>` : ''}
    </div>
  `;
}

// ---------- Novo Pedido ----------
async function viewNovoPedido() {
  const [products, tables, menu, bairros, payMethods, allOrders] = await Promise.all([
    api('/products'), api('/tables'), api('/pizza/menu'), api('/config/neighborhoods'), api('/config/payment-methods'), api('/orders'),
  ]);
  const categories = [...new Set(products.map(p => p.Category?.name).filter(Boolean))].sort();
  let cart = [];
  const openBalcaoOrders = (allOrders || []).filter(o => o.type === 'balcao' && !o.paid && o.status !== 'cancelado');
  let targetOrderId = initialOrderId || null;
  initialOrderId = null;
  let targetOrder = targetOrderId ? (allOrders || []).find(o => o.id === targetOrderId) : null;
  let type = targetOrder?.type || initialOrderType || 'mesa';
  initialOrderType = null;
  let tableId = (targetOrder?.TableId) || initialTableId || null;
  initialTableId = null;
  let npMesaSearch = '';
  let npMesaFilter = 'todas';
  let pz = { sizeId: menu.sizes[0]?.id, flavors: [], crustId: '', q: '' };
  let delivery = {
    customer: null,
    phone: '(44) ',
    name: '',
    cep: '',
    distance: '-',
    customFee: '',
    avgTime: '00:40',
    street: '',
    number: '',
    complement: '',
    reference: '',
    neighborhoodId: '',
    city: 'Floresta',
    state: 'PR',
    freeDelivery: false,
    deliveryMode: 'e', // 'e' = Disk-Entrega, 'b' = Retirada
    paymentMethod: payMethods[0]?.name || 'Dinheiro',
    changeFor: '',
    discount: '',
    notes: '',
    cpfCnpj: '',
  };
  let prodFilter = { q: '', cat: '', obs: '' };
  let custResults = [];
  let balcao = {
    customer: targetOrder?.Customer || null,
    name: targetOrder?.Customer?.name || (targetOrder?.type === 'balcao' ? `Balcão #${targetOrder.id}` : ''),
    phone: targetOrder?.Customer?.phone || '',
    notes: '',
  };
  let balcaoCustResults = [];

  const sizeOf = id => menu.sizes.find(s => s.id === +id);
  const flavorPrice = (f, sizeId) => { const p = f.prices.find(x => x.SizeId === +sizeId); return p ? Number(p.price) : null; };
  const pizzaPrice = () => {
    const fl = pz.flavors.map(id => menu.flavors.find(f => f.id === id));
    if (!fl.length) return 0;
    const crust = menu.crusts.find(c => c.id === +pz.crustId);
    return Math.max(...fl.map(f => flavorPrice(f, pz.sizeId) ?? 0)) + (crust ? Number(crust.price) : 0);
  };
  const fee = () => {
    if (type !== 'delivery' || delivery.freeDelivery || delivery.deliveryMode === 'b') return 0;
    if (delivery.customFee !== '') return Math.max(0, Number(delivery.customFee) || 0);
    return Number(bairros.find(b => b.id === +delivery.neighborhoodId)?.fee || 0);
  };

  const fullAddress = () => {
    const parts = [];
    if (delivery.street) parts.push(delivery.street + (delivery.number ? ', ' + delivery.number : ''));
    if (delivery.complement) parts.push(delivery.complement);
    if (delivery.reference) parts.push('Ref: ' + delivery.reference);
    return parts.join(' - ');
  };

  const draw = () => {
    const size = sizeOf(pz.sizeId);
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const discVal = type === 'delivery' ? Math.max(0, Number(delivery.discount) || 0) : 0;
    const curFee = fee();
    const totalDue = Math.max(0, subtotal + curFee - discVal);
    const trocoVal = type === 'delivery' && Number(delivery.changeFor) > totalDue
      ? Number(delivery.changeFor) - totalDue
      : 0;
    const fq = pz.q.toLowerCase();
    const flavors = menu.flavors.filter(f => !fq || f.name.toLowerCase().includes(fq));
    const pq = prodFilter.q.toLowerCase();
    const prods = products.filter(p => (!prodFilter.cat || p.Category?.name === prodFilter.cat) && (!pq || p.name.toLowerCase().includes(pq)));

    const filteredTables = tables.filter(t => {
      if (npMesaFilter === 'livres' && t.isOpen) return false;
      if (npMesaFilter === 'ocupadas' && !t.isOpen) return false;
      if (npMesaSearch.trim()) {
        const q = npMesaSearch.trim().toLowerCase();
        if (!String(t.number).includes(q) && !t.order?.customerName?.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    view().innerHTML = `
      <div class="split">
        <div>
          <div class="card">
            <div class="row">
              <select id="type">${Object.entries(TYPE).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
              ${type === 'mesa' ? `
                <span class="muted" style="font-weight:700">${tableId ? 'Mesa #' + (tables.find(t => t.id === tableId)?.number || tableId) : 'Selecione uma mesa abaixo'}</span>
                ${type === 'mesa' && tableId && tables.find(t => t.id === tableId)?.isOpen ? `<button type="button" class="btn ok sm" id="open-bill">💰 Receber / Dividir Conta</button>` : ''}
                <button type="button" class="btn sec sm" id="go-salon-board" style="margin-left:auto">🍽️ Ver Salão Completo</button>
              ` : ''}
              ${type === 'delivery' ? `<button type="button" class="btn sec sm" id="go-delivery-board" style="margin-left:auto">🛵 Ver Painel de Entregas (Kanban)</button>` : ''}
              ${type === 'balcao' ? `
                <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
                  <span class="chip balcao" style="font-weight:700;font-size:12px;padding:3px 10px">
                    🏬 Venda no Balcão
                  </span>
                  <button type="button" class="btn sec sm" id="go-balcao-board" style="font-weight:700">🛍️ Ver Painel de Balcão</button>
                </div>
              ` : ''}
            </div>

            ${type === 'mesa' ? `
              <div style="margin-top:10px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
                  <input id="np-mesa-search" placeholder="🔍 Filtrar nº mesa..." style="width:160px;padding:4px 8px;font-size:12px" value="${esc(npMesaSearch)}">
                  <div style="display:flex;gap:4px">
                    <button type="button" class="pill ${npMesaFilter === 'todas' ? 'on' : ''}" data-npf="todas">Todas (${tables.length})</button>
                    <button type="button" class="pill ${npMesaFilter === 'livres' ? 'on' : ''}" data-npf="livres">Livres (${tables.filter(t => !t.isOpen).length})</button>
                    <button type="button" class="pill ${npMesaFilter === 'ocupadas' ? 'on' : ''}" data-npf="ocupadas">Ocupadas (${tables.filter(t => t.isOpen).length})</button>
                  </div>
                </div>
                <div id="tables" class="englobaMesas" style="max-height:260px">
                  ${filteredTables.map(t => renderMesaCard(t, t.id === tableId, 'tempo')).join('')}
                </div>
              </div>
            ` : ''}

            ${type === 'balcao' ? `
              ${targetOrderId && targetOrder ? `
                <div style="background:#e0f2fe;border:2px solid #0284c7;border-radius:8px;padding:12px 16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 6px rgba(2,132,199,0.15)">
                  <div>
                    <div style="color:#0369a1;font-weight:800;font-size:14px;display:flex;align-items:center;gap:6px">
                      <span style="font-size:18px">🛒</span> Lançando Mais Itens na Comanda Balcão #${targetOrder.id}
                    </div>
                    <div style="font-size:12.5px;color:#1e293b;margin-top:3px">
                      Cliente: <b>${esc(targetOrder.Customer?.name || 'Cliente')}</b>
                      ${targetOrder.Customer?.phone ? ` — 📞 ${esc(targetOrder.Customer.phone)}` : ''}
                      | Total Atual: <b style="color:#0284c7">${brl(targetOrder.totalAmount)}</b>
                      ${targetOrder.items?.length ? ` (${targetOrder.items.length} itens já lançados)` : ''}
                    </div>
                    <div style="font-size:11.5px;color:#64748b;margin-top:2px">
                      Os itens que você adicionar abaixo serão somados a esta comanda e impressos na cozinha.
                    </div>
                  </div>
                  <button type="button" class="btn sec sm" id="balcao-cancel-target" style="border-color:#0284c7;color:#0369a1;font-weight:700;white-space:nowrap;padding:6px 12px">
                    ❌ Criar Novo Balcão
                  </button>
                </div>
              ` : (openBalcaoOrders.length ? `
                <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                  <span style="font-size:12px;font-weight:700;color:#334155">📋 Comandas de Balcão em Aberto:</span>
                  <select id="select-open-balcao" style="font-size:12.5px;padding:5px 8px;border-radius:4px;border:1px solid #94a3b8;flex:1;max-width:380px;background:#fff;font-weight:600">
                    <option value="">-- Selecione uma comanda aberta para adicionar mais itens --</option>
                    ${openBalcaoOrders.map(bo => `<option value="${bo.id}">#${bo.id} - ${esc(bo.Customer?.name || 'Cliente')} (${brl(bo.totalAmount)} - ${bo.items?.length || 0} itens)</option>`).join('')}
                  </select>
                  <span class="muted" style="font-size:11px">ou preencha abaixo para abrir novo</span>
                </div>
              ` : '')}

              <div class="balcao-cliente-card ${!balcao.name.trim() ? 'invalido' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="font-size:16px">👤</span>
                    <strong style="font-size:13.5px;color:#1e293b">${targetOrderId ? `Comanda #${targetOrderId} - Cliente` : 'Cliente do Balcão'}</strong>
                    <span style="font-size:11px;font-weight:700;background:${targetOrderId ? '#e0f2fe' : (!balcao.name.trim() ? '#fee2e2' : '#dcfce7')};color:${targetOrderId ? '#0369a1' : (!balcao.name.trim() ? '#991b1b' : '#166534')};padding:1px 8px;border-radius:10px">
                      ${targetOrderId ? `LANÇANDO NA COMANDA #${targetOrderId}` : (!balcao.name.trim() ? 'OBRIGATÓRIO INFORMAR O NOME' : 'CLIENTE IDENTIFICADO')}
                    </span>
                  </div>
                  <div style="font-size:12px;color:#64748b">
                    ${balcao.customer ? `<span style="color:#029CC1;font-weight:600">✓ Cliente #${balcao.customer.id} cadastrado</span>` : ''}
                  </div>
                </div>

                <div style="display:grid;grid-template-columns:2fr 1.2fr auto;gap:8px;align-items:center">
                  <div>
                    <label style="display:block;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:3px">
                      Nome do Cliente <span style="color:#dc3545">*</span>
                    </label>
                    <input id="balcao-name" placeholder="Digite o nome do cliente (obrigatório)..." value="${esc(balcao.name)}" autocomplete="off" style="width:100%;font-size:13px;font-weight:600;padding:6px 10px;border-radius:4px;border:1px solid ${!balcao.name.trim() ? '#dc3545' : '#cbd5e1'};background:#fff" ${targetOrderId ? 'readonly title="Cliente já vinculado a esta comanda aberta"' : ''}>
                  </div>
                  <div>
                    <label style="display:block;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:3px">
                      Telefone / Celular <span class="muted" style="font-weight:normal">(opcional)</span>
                    </label>
                    <input id="balcao-phone" placeholder="(xx) xxxxx-xxxx" value="${esc(balcao.phone)}" autocomplete="off" style="width:100%;font-size:12.5px;padding:6px 10px;border-radius:4px;border:1px solid #cbd5e1;background:#fff" ${targetOrderId ? 'readonly' : ''}>
                  </div>
                  <div style="align-self:flex-end">
                    <button type="button" class="btn sec sm" id="balcao-clear-cust" title="Limpar cliente" style="padding:6px 12px;font-size:11.5px" ${targetOrderId ? 'disabled' : ''}>
                      Limpar
                    </button>
                  </div>
                </div>

                ${balcaoCustResults.length ? `
                  <div class="results" style="margin-top:6px;max-height:160px;overflow-y:auto;background:#fff;border:1px solid #cbd5e1;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
                    ${balcaoCustResults.map(c => `
                      <div data-balcao-cust="${c.id}" style="padding:6px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:12.5px">
                        <b>${esc(c.name)}</b>
                        ${c.phone ? ` — <span style="color:#ff6600;font-weight:700">${esc(c.phone)}</span>` : ''}
                        ${c.address ? ` <span class="muted" style="font-size:11px">(${esc(c.address)})</span>` : ''}
                      </div>
                    `).join('')}
                  </div>
                ` : ''}

                <div style="margin-top:8px">
                  <input id="balcao-notes" placeholder="Observação adicional (ex: retirada em 20 min, embalar p/ viagem...)" value="${esc(balcao.notes)}" style="width:100%;font-size:12px;padding:5px 8px;border-radius:4px;border:1px solid #cbd5e1;background:#fff">
                </div>
              </div>
            ` : ''}
          </div>

          ${type === 'delivery' ? `
          <!-- Layout Exato do modalDeliveryDadosCliente (enderecoDiskEntregaTemplate.tpl + modalLigacaoBinaDadosCliente.tpl + formFinalizaDiskEntrega.tpl) -->
          <div class="eichefe-disk-panel">
            <div class="eichefe-disk-header">
              <h3>Delivery: <strong>Novo Atendimento Disk-Entrega</strong></h3>
              <span style="font-size:13px;opacity:.9">${delivery.customer ? `Cliente #${delivery.customer.id} vinculado` : 'Informe telefone ou nome'}</span>
            </div>
            <div class="eichefe-disk-body">
              <!-- Coluna Esquerda: modalLigacaoBinaDadosCliente.tpl + finalizaDiskEntrega.tpl -->
              <div class="eichefe-bina-col">
                <div class="eichefe-bina-top">
                  <div style="font-size:12px;color:#6c757d;font-weight:700;text-transform:uppercase">Nova Ligação / WhatsApp</div>
                  <div class="eichefe-bina-phone-icon">📞</div>
                  <div class="nome-cliente-novoDisk">${esc(delivery.name || delivery.customer?.name || 'Cliente não definido')}</div>
                  <div class="telefone-cliente-novoDisk">${esc(delivery.phone && delivery.phone.trim() !== '(44)' ? delivery.phone : (delivery.customer?.phone || 'Não identificado'))}</div>
                  <div class="log-cliente-novoDisk">
                    <div style="color:#6c757d">Status do Cliente:</div>
                    <strong style="color:#28a745">${delivery.customer ? 'Cliente Cadastrado no EiChefe' : 'Primeira Compra / Avulso'}</strong>
                    ${delivery.customer?.address ? `<div class="muted" style="margin-top:4px;font-size:11.5px">${esc(delivery.customer.address)} - ${esc(delivery.customer.neighborhood || '')}</div>` : ''}
                  </div>
                </div>

                <!-- Finalizar Entrega (formFinalizaDiskEntrega.tpl + finalizaDiskEntrega.tpl) -->
                <div class="eichefe-finaliza-box">
                  <h4>Finalizar Entrega</h4>
                  <div style="margin-bottom:6px">
                    <select id="dlv-mode" style="width:100%">
                      <option value="e" ${delivery.deliveryMode === 'e' ? 'selected' : ''}>Disk-Entrega</option>
                      <option value="b" ${delivery.deliveryMode === 'b' ? 'selected' : ''}>Retirada no Balcão</option>
                    </select>
                  </div>
                  <div style="margin-bottom:6px">
                    <select id="dlv-pay" style="width:100%">
                      ${payMethods.map(pm => `<option value="${esc(pm.name)}" ${delivery.paymentMethod === pm.name ? 'selected' : ''}>${esc(pm.name)}</option>`).join('')}
                    </select>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
                    <div>
                      <label style="font-size:11px;color:#555">Troco para</label>
                      <input id="troco" type="number" step="0.01" placeholder="R$ 0,00" value="${esc(delivery.changeFor)}" style="width:100%">
                    </div>
                    <div>
                      <label style="font-size:11px;color:#555">Troco</label>
                      <input id="troco-calc" readonly value="${brl(trocoVal)}" style="width:100%;background:#f1f3f5;font-weight:700">
                    </div>
                  </div>
                  <div style="margin-bottom:8px">
                    <label style="font-size:11px;color:#555">Desconto (R$)</label>
                    <input id="dlv-disc" type="number" step="0.01" placeholder="R$ 0,00" value="${esc(delivery.discount)}" style="width:100%">
                  </div>
                  <table class="eichefe-info-venda-table" style="width:100%">
                    <tbody>
                      <tr><td>Itens da Lista</td><td style="text-align:right;font-weight:700">${brl(subtotal)}</td></tr>
                      <tr><td>Taxa</td><td style="text-align:right;font-weight:700">${brl(curFee)}</td></tr>
                      ${discVal > 0 ? `<tr><td>Desconto</td><td style="text-align:right;color:var(--danger)">- ${brl(discVal)}</td></tr>` : ''}
                      <tr><td>Valor Pago</td><td style="text-align:right">R$ 0,00</td></tr>
                    </tbody>
                    <tfoot>
                      <tr><td colspan="2" style="text-align:right;font-size:11px;color:#6c757d;padding-top:6px !important">Valor Devido</td></tr>
                      <tr><td colspan="2" style="text-align:right;font-size:18px;font-weight:800;color:#d03982">${brl(totalDue)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <!-- Coluna Direita: enderecoDiskEntregaTemplate.tpl (Dados do Cliente) -->
              <div class="eichefe-addr-col">
                <h4>Dados do Cliente</h4>
                <!-- Linha 1: Telefone + Nome do Cliente + Limpar -->
                <div class="eichefe-form-row" style="grid-template-columns: 180px 1fr 90px">
                  <input id="dlv-phone" placeholder="(xx) xxxxx-xxxx" value="${esc(delivery.phone)}">
                  <input id="dlv-name" placeholder="Nome do Cliente (digite p/ buscar)" value="${esc(delivery.name)}">
                  <button type="button" class="btn danger" id="dlv-clear-cust" style="background:#fff;color:var(--danger);border-color:var(--danger)">Limpar</button>
                </div>
                ${custResults.length ? `<div class="results" style="margin-bottom:8px">${custResults.map(c => `<div data-cust="${c.id}"><b>${esc(c.name)}</b> — <span style="color:#ff6600;font-weight:700">${esc(c.phone || 'S/ fone')}</span> <span class="muted">(${esc(c.address || '')} - ${esc(c.neighborhood || '')})</span></div>`).join('')}</div>` : ''}

                <!-- Linha 2: CEP + Lupa | Distância | Taxa de Entrega | Tempo Médio -->
                <div class="eichefe-form-row" style="grid-template-columns: 1.3fr 0.7fr 1fr 0.9fr">
                  <div style="display:flex">
                    <input id="dlv-cep" placeholder="CEP" value="${esc(delivery.cep)}" style="border-radius:4px 0 0 4px;width:100%">
                    <button type="button" class="btn ok sm" id="dlv-cep-btn" title="Buscar por CEP" style="border-radius:0 4px 4px 0">🔍</button>
                  </div>
                  <input id="dlv-dist" readonly placeholder="-" value="${esc(delivery.distance)}" style="background:#f8f9fa;text-align:center" title="Distância">
                  <input id="dlv-fee" type="number" step="0.50" placeholder="Taxa R$ 0,00" value="${delivery.freeDelivery ? '0.00' : (delivery.customFee !== '' ? delivery.customFee : (curFee || ''))}" ${delivery.freeDelivery ? 'readonly' : ''} title="Taxa de Entrega (R$)">
                  <input id="dlv-time" placeholder="--:--" value="${esc(delivery.avgTime)}" style="text-align:center" title="Tempo Médio">
                </div>

                <!-- Linha 3: Endereço (Logradouro) + Nº -->
                <div class="eichefe-form-row" style="grid-template-columns: 3fr 1fr">
                  <input id="dlv-street" placeholder="Endereço (Rua / Avenida)" value="${esc(delivery.street)}">
                  <input id="dlv-num" placeholder="Nº" value="${esc(delivery.number)}">
                </div>

                <!-- Linha 4: Complemento + Ponto de Referência -->
                <div class="eichefe-form-row" style="grid-template-columns: 1fr 1fr">
                  <input id="dlv-comp" placeholder="Complemento" value="${esc(delivery.complement)}">
                  <input id="dlv-ref" placeholder="Ponto Referência" value="${esc(delivery.reference)}">
                </div>

                <!-- Linha: Obs. Geral do Pedido (sai na comanda e cupom de entrega) -->
                <div class="eichefe-form-row" style="grid-template-columns: 1fr">
                  <input id="dlv-notes" placeholder="Obs. Geral (ex: sem cebola, campainha quebrada)" value="${esc(delivery.notes || '')}">
                </div>

                <!-- Linha 5: Bairro (com X) + Cidade + Estado -->
                <div class="eichefe-form-row" style="grid-template-columns: 2fr 1.2fr 0.6fr">
                  <div style="display:flex">
                    <select id="bairro" style="width:100%;border-radius:4px 0 0 4px">
                      <option value="">Bairro...</option>
                      ${bairros.map(b => `<option value="${b.id}" ${+delivery.neighborhoodId === b.id ? 'selected' : ''}>${esc(b.name)} (${brl(b.fee)})</option>`).join('')}
                    </select>
                    <button type="button" class="btn sec sm" id="dlv-clear-bairro" title="Limpar Bairro" style="border-radius:0 4px 4px 0">X</button>
                  </div>
                  <input id="dlv-city" readonly value="${esc(delivery.city)}" placeholder="Cidade" style="background:#f8f9fa">
                  <input id="dlv-uf" readonly value="${esc(delivery.state)}" placeholder="UF" style="background:#f8f9fa;text-align:center">
                </div>

                <!-- Linha 6: Opções do Cliente (Botões Circulares do EiChefe) + Taxa Grátis + Limpar Endereço -->
                <div style="margin-top:10px;font-weight:700;font-size:13.5px;color:#252c38">Opções do Cliente</div>
                <div class="div-opcoes-cliente">
                  <div class="opcao-pedido" id="op-trocar-cli" title="Buscar / Trocar Cliente">
                    <div class="op-ico">👤</div>
                    <span>Trocar Cliente</span>
                  </div>
                  <div class="opcao-pedido" id="op-enderecos" title="Endereços do Cliente">
                    <div class="op-ico">📍</div>
                    <span>Endereços</span>
                  </div>
                  <div class="opcao-pedido" id="op-telefones" title="Telefones do Cliente">
                    <div class="op-ico">📱</div>
                    <span>Telefones</span>
                  </div>
                  <div class="opcao-pedido" id="op-unir" title="Unir Cadastro de Cliente">
                    <div class="op-ico">🔗</div>
                    <span>Unir Cliente</span>
                  </div>
                  <div class="opcao-pedido" id="op-fiscal" title="Informar CPF/CNPJ na Nota">
                    <div class="op-ico">🧾</div>
                    <span>Dados Fiscais</span>
                  </div>
                  <div class="opcao-pedido" id="op-hist" title="Ver Histórico de Compras do Cliente">
                    <div class="op-ico">🕒</div>
                    <span>Histórico</span>
                  </div>

                  <div class="boxBtnDisk">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:700;font-size:13px">
                      <input type="checkbox" id="dlv-free" ${delivery.freeDelivery ? 'checked' : ''}>
                      Taxa Grátis
                    </label>
                    <button type="button" class="btn danger sm" id="dlv-clear-addr" style="background:#fff;color:var(--danger);border-color:var(--danger);padding:5px 12px">
                      Limpar Endereço
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          ` : ''}

          <div class="card"><h3>🍕 Montar pizza</h3>
            <div class="row">${menu.sizes.map(s => `<button class="btn ${s.id === +pz.sizeId ? '' : 'sec'}" data-size="${s.id}">${esc(s.name)} <small>(ate ${s.maxFlavors} sab.)</small></button>`).join('')}
              <input id="fq" placeholder="Buscar sabor" value="${esc(pz.q)}" style="margin-left:auto"></div>
            <p class="muted">Escolha ate ${size?.maxFlavors || 1} sabor(es). O preco vale pelo sabor mais caro.
              ${pz.flavors.length ? '<b>Selecionados:</b> ' + pz.flavors.map(id => esc(menu.flavors.find(f => f.id === id).name)).join(' / ') : ''}</p>
            <div class="grid scroll" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">
              ${flavors.map(f => {
                const price = flavorPrice(f, pz.sizeId);
                return `<div class="prod ${pz.flavors.includes(f.id) ? 'on' : ''} ${price === null ? 'off' : ''}" data-flavor="${f.id}"><b>${esc(f.name)}</b>${f.kind === 'doce' ? ' 🍫' : ''}
                  <div class="muted">${esc(f.description || '')}</div><div>${price === null ? 'indisponivel' : brl(price)}</div></div>`;
              }).join('') || '<p class="muted">Nenhum sabor</p>'}
            </div>
            <div class="row" style="margin-top:12px">
              <select id="crust"><option value="">Sem borda recheada</option>${menu.crusts.map(c => `<option value="${c.id}" ${+pz.crustId === c.id ? 'selected' : ''}>Borda ${esc(c.name)} (+${brl(c.price)})</option>`).join('')}</select>
              <input id="pzobs" placeholder="Observacao da pizza" style="flex:1">
              <button class="btn ok" id="addpz">Adicionar ${pz.flavors.length ? brl(pizzaPrice()) : ''}</button>
            </div>
          </div>

          <div class="card"><h3>Outros itens</h3>
            <div class="row" style="gap:8px">
              <input id="pq" placeholder="Buscar produto" value="${esc(prodFilter.q)}" style="flex:1">
              <input id="pobs" placeholder="Observação rápida (opcional)" value="${esc(prodFilter.obs || '')}" style="flex:1">
            </div>
            <div class="pills"><span class="pill ${prodFilter.cat === '' ? 'on' : ''}" data-cat="">Todos</span>${categories.map(c => `<span class="pill ${prodFilter.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</span>`).join('')}</div>
            <div class="grid scroll">
              ${prods.map(p => `<div class="prod" data-prod="${p.id}"><b>${esc(p.name)}</b><div class="muted">${esc(p.description || '')}</div><div>${brl(p.price)}${p.stockControl ? ` <span class="muted">(est. ${p.stock})</span>` : ''}</div></div>`).join('') || '<p class="muted">Nenhum produto</p>'}
            </div></div>
        </div>

        <div class="card"><h3>Carrinho</h3>
          ${cart.length ? `<table>${cart.map((i, idx) => `<tr>
            <td>
              <b>${esc(i.label)}</b>
              ${i.obs ? `<br><small style="color:#d03982;font-weight:700">--- OBS: ${esc(i.obs)}</small>` : ''}
              <br><a href="javascript:void(0)" class="edit-item-obs" data-idx="${idx}" style="font-size:11px;color:#007bff;text-decoration:none">✏️ ${i.obs ? 'Alterar observação' : '+ Obs'}</a>
            </td>
            <td style="white-space:nowrap">
              <button class="btn sec sm" data-m="${idx}">-</button> ${i.qty} <button class="btn sec sm" data-p="${idx}">+</button>
            </td>
            <td style="font-weight:700">${brl(i.price * i.qty)}</td>
          </tr>`).join('')}</table>` : '<p class="muted">Vazio</p>'}
          ${type === 'delivery' ? `<p class="muted">Taxa de entrega: ${brl(curFee)}${discVal > 0 ? ` | Desconto: -${brl(discVal)}` : ''}</p>` : ''}
          ${targetOrderId && targetOrder ? `
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:8px 10px;margin:8px 0;font-size:12px">
              <div style="display:flex;justify-content:space-between;margin-bottom:2px">
                <span class="muted">Comanda #${targetOrder.id} (atual):</span>
                <b>${brl(targetOrder.totalAmount)}</b>
              </div>
              <div style="display:flex;justify-content:space-between;color:#0284c7;font-weight:700;margin-bottom:4px">
                <span>+ Novos Itens:</span>
                <span>+ ${brl(subtotal)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;color:#0369a1;border-top:1px dashed #7dd3fc;padding-top:4px">
                <span>Novo Total Comanda:</span>
                <span>${brl(Number(targetOrder.totalAmount || 0) + subtotal)}</span>
              </div>
            </div>
          ` : ''}
          ${type === 'balcao' ? `<p class="muted" style="font-size:12.5px;margin:8px 0 4px">Cliente: <b style="color:${balcao.name.trim() ? '#166534' : '#dc3545'}">${esc(balcao.name.trim() || '⚠️ Não informado (Obrigatório)')}</b></p>` : ''}
          <h3 style="margin-top:12px">${targetOrderId ? 'Novos Itens: ' + brl(subtotal) : 'Total: ' + brl(totalDue)}</h3>
          <button class="btn ok" id="send" style="width:100%">${
            targetOrderId
              ? `➕ Lançar Itens na Comanda #${targetOrderId}`
              : (type === 'delivery' ? '✅ Pedir / Enviar Delivery (F5)' : (type === 'balcao' ? '🏬 Enviar Pedido Balcão' : 'ENVIAR'))
          }</button>
        </div>
      </div>`;

    $('type').value = type;
    $('type').onchange = () => {
      type = $('type').value;
      draw();
      if (type === 'balcao' && !balcao.name.trim()) {
        setTimeout(() => $('balcao-name')?.focus(), 50);
      }
    };

    if (type === 'balcao') {
      const selBalcao = $('select-open-balcao');
      if (selBalcao) {
        selBalcao.onchange = () => {
          const sid = +selBalcao.value;
          if (sid) {
            targetOrderId = sid;
            targetOrder = openBalcaoOrders.find(o => o.id === sid);
            if (targetOrder) {
              balcao.name = targetOrder.Customer?.name || ('Balcão #' + targetOrder.id);
              balcao.phone = targetOrder.Customer?.phone || '';
              balcao.customer = targetOrder.Customer || null;
            }
            draw();
          }
        };
      }

      const btnCancelTarget = $('balcao-cancel-target');
      if (btnCancelTarget) {
        btnCancelTarget.onclick = () => {
          targetOrderId = null;
          targetOrder = null;
          balcao.name = '';
          balcao.phone = '';
          balcao.customer = null;
          draw();
        };
      }

      const syncBalcao = () => {
        if ($('balcao-name')) balcao.name = $('balcao-name').value;
        if ($('balcao-phone')) balcao.phone = $('balcao-phone').value;
        if ($('balcao-notes')) balcao.notes = $('balcao-notes').value;
      };

      const searchBalcaoCustomer = debounce(safe(async (inputId) => {
        syncBalcao();
        const rawQ = $(inputId).value.trim().replace(/^\(44\)\s*/, '');
        balcaoCustResults = rawQ.length >= 2 ? await api('/customers?limit=15&q=' + encodeURIComponent(rawQ)) : [];
        const caret = $(inputId).value;
        draw();
        const el = $(inputId);
        if (el) {
          el.value = caret;
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }), 220);

      if ($('balcao-name')) {
        $('balcao-name').oninput = () => searchBalcaoCustomer('balcao-name');
        $('balcao-name').onchange = syncBalcao;
      }
      if ($('balcao-phone')) {
        $('balcao-phone').oninput = () => searchBalcaoCustomer('balcao-phone');
        $('balcao-phone').onchange = syncBalcao;
      }
      if ($('balcao-notes')) {
        $('balcao-notes').onchange = syncBalcao;
        $('balcao-notes').oninput = syncBalcao;
      }

      document.querySelectorAll('[data-balcao-cust]').forEach(el => el.onclick = () => {
        const c = balcaoCustResults.find(x => x.id === +el.dataset.balcaoCust);
        if (!c) return;
        balcao.customer = c;
        balcao.name = c.name || '';
        balcao.phone = c.phone || '';
        balcaoCustResults = [];
        draw();
      });

      if ($('balcao-clear-cust')) {
        $('balcao-clear-cust').onclick = () => {
          balcao.customer = null;
          balcao.name = '';
          balcao.phone = '';
          balcaoCustResults = [];
          draw();
          $('balcao-name')?.focus();
        };
      }
    }

    document.querySelectorAll('#tables .cadaMesa').forEach(card => {
      card.onclick = (e) => {
        if (e.target.closest('.quadro-btn')) return;
        tableId = +card.dataset.id;
        draw();
      };
    });

    const btnGoSalon = $('go-salon-board');
    if (btnGoSalon) btnGoSalon.onclick = () => { tab = 'mesas'; render(); };

    const npSearchInput = $('np-mesa-search');
    if (npSearchInput) {
      npSearchInput.oninput = () => {
        npMesaSearch = npSearchInput.value;
        const q = npMesaSearch.trim().toLowerCase();
        document.querySelectorAll('#tables .cadaMesa').forEach(card => {
          const num = card.dataset.num;
          const t = tables.find(x => x.number === +num);
          const match = !q || num.includes(q) || t?.order?.customerName?.toLowerCase().includes(q) || t?.order?.operatorName?.toLowerCase().includes(q);
          card.style.display = match ? 'flex' : 'none';
        });
      };
    }

    document.querySelectorAll('[data-npf]').forEach(el => {
      el.onclick = () => {
        npMesaFilter = el.dataset.npf;
        draw();
      };
    });

    document.querySelectorAll('#tables [data-mver]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const t = tables.find(x => x.id === +b.dataset.mver);
        if (t) openMesaDetalhesModal(t, () => render());
      };
    });

    document.querySelectorAll('#tables [data-mmudar]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        openMudarMesaModal(tables, +b.dataset.mmudar, () => render());
      };
    });

    document.querySelectorAll('#tables [data-mimp]').forEach(b => {
      b.onclick = safe(async (e) => {
        e.stopPropagation();
        const id = +b.dataset.mimp;
        const r = await api(`/printers/print-order/${id}`, 'POST', { type: 'conta' });
        openThermalPreviewModal(r.jobs, `Conferência Pedido #${id}`);
      });
    });

    const btnBill = $('open-bill');
    if (btnBill) {
      btnBill.onclick = safe(async () => {
        const curTable = tables.find(t => t.id === tableId);
        if (!curTable || !curTable.order) return toast('Nenhum pedido aberto nesta mesa');
        openPaymentModal(curTable.order.id, () => render());
      });
    }
    const btnGoDlv = $('go-delivery-board');
    if (btnGoDlv) btnGoDlv.onclick = () => { tab = 'delivery'; render(); };
    const btnGoBalcao = $('go-balcao-board');
    if (btnGoBalcao) btnGoBalcao.onclick = () => { tab = 'balcao'; render(); };

    if (type === 'delivery') {
      const syncDlv = () => {
        delivery.phone = $('dlv-phone').value;
        delivery.name = $('dlv-name').value;
        delivery.cep = $('dlv-cep').value;
        delivery.street = $('dlv-street').value;
        delivery.number = $('dlv-num').value;
        delivery.complement = $('dlv-comp').value;
        delivery.reference = $('dlv-ref').value;
        delivery.neighborhoodId = $('bairro').value;
        delivery.deliveryMode = $('dlv-mode').value;
        delivery.paymentMethod = $('dlv-pay').value;
        delivery.changeFor = $('troco').value;
        delivery.discount = $('dlv-disc').value;
        delivery.notes = $('dlv-notes') ? $('dlv-notes').value : '';
      };

      const searchCustomer = debounce(safe(async (inputId) => {
        syncDlv();
        const rawQ = $(inputId).value.trim().replace(/^\(44\)\s*/, '');
        custResults = rawQ.length >= 2 ? await api('/customers?limit=15&q=' + encodeURIComponent(rawQ)) : [];
        const caret = $(inputId).value;
        draw();
        const el = $(inputId);
        if (el) {
          el.value = caret;
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }), 220);

      $('dlv-phone').oninput = () => searchCustomer('dlv-phone');
      $('dlv-name').oninput = () => searchCustomer('dlv-name');

      document.querySelectorAll('[data-cust]').forEach(el => el.onclick = () => {
        const c = custResults.find(x => x.id === +el.dataset.cust);
        if (!c) return;
        delivery.customer = c;
        delivery.name = c.name || '';
        delivery.phone = c.phone || '(44) ';
        delivery.street = c.address || '';
        delivery.number = '';
        const b = bairros.find(x => x.name.toLowerCase() === (c.neighborhood || '').toLowerCase());
        if (b) {
          delivery.neighborhoodId = b.id;
          delivery.customFee = '';
        }
        custResults = [];
        draw();
      });

      $('dlv-clear-cust').onclick = () => {
        delivery.customer = null;
        delivery.name = '';
        delivery.phone = '(44) ';
        custResults = [];
        draw();
      };
      $('dlv-clear-addr').onclick = () => {
        delivery.street = '';
        delivery.number = '';
        delivery.complement = '';
        delivery.reference = '';
        delivery.neighborhoodId = '';
        delivery.customFee = '';
        draw();
      };
      $('dlv-clear-bairro').onclick = () => {
        delivery.neighborhoodId = '';
        delivery.customFee = '';
        draw();
      };
      $('bairro').onchange = () => {
        syncDlv();
        delivery.customFee = '';
        draw();
      };
      $('dlv-fee').onchange = () => {
        syncDlv();
        delivery.customFee = $('dlv-fee').value;
        draw();
      };
      $('dlv-free').onchange = () => {
        syncDlv();
        delivery.freeDelivery = $('dlv-free').checked;
        draw();
      };
      $('dlv-mode').onchange = () => { syncDlv(); draw(); };
      $('dlv-pay').onchange = () => { syncDlv(); };
      $('troco').oninput = () => {
        syncDlv();
        const t = Number(delivery.changeFor) > totalDue ? Number(delivery.changeFor) - totalDue : 0;
        $('troco-calc').value = brl(t);
      };
      $('dlv-disc').onchange = () => { syncDlv(); draw(); };
      $('dlv-street').onchange = syncDlv;
      $('dlv-num').onchange = syncDlv;
      $('dlv-comp').onchange = syncDlv;
      $('dlv-ref').onchange = syncDlv;
      if ($('dlv-notes')) {
        $('dlv-notes').onchange = syncDlv;
        $('dlv-notes').oninput = syncDlv;
      }
      $('dlv-cep-btn').onclick = () => {
        syncDlv();
        toast('CEP Floresta/PR: 87120-000');
        if (!delivery.cep) { delivery.cep = '87120-000'; draw(); }
      };

      // Botões de Opções do Cliente do EiChefe
      $('op-trocar-cli').onclick = () => { $('dlv-name').focus(); toast('Digite o nome ou telefone para buscar outro cliente'); };
      $('op-enderecos').onclick = () => {
        if (!delivery.customer) return toast('Selecione um cliente primeiro');
        modal(`Endereços de ${delivery.customer.name}`, `<p><b>Endereço Principal:</b> ${esc(delivery.customer.address || '-')}</p><p><b>Bairro:</b> ${esc(delivery.customer.neighborhood || '-')}</p>`, () => {}, 'Fechar');
      };
      $('op-telefones').onclick = () => {
        if (!delivery.customer) return toast('Selecione um cliente primeiro');
        modal(`Telefones de ${delivery.customer.name}`, `<p><b>Telefone Cadastrado:</b> ${esc(delivery.customer.phone || '-')}</p>`, () => {}, 'Fechar');
      };
      $('op-unir').onclick = () => toast('Cadastro de cliente sincronizado');
      $('op-fiscal').onclick = () => {
        const cpf = prompt('Informe o CPF/CNPJ para a Nota Fiscal:', delivery.cpfCnpj || '');
        if (cpf !== null) { delivery.cpfCnpj = cpf; toast('CPF/CNPJ vinculado ao pedido!'); }
      };
      $('op-hist').onclick = safe(async () => {
        const allOrders = await api('/orders');
        const hist = allOrders.filter(o =>
          (delivery.customer && o.CustomerId === delivery.customer.id) ||
          (delivery.name && o.Customer?.name?.toLowerCase() === delivery.name.toLowerCase())
        );
        const html = hist.length
          ? `<table><tr><th>#</th><th>Data</th><th>Itens</th><th>Total</th></tr>${hist.slice(0, 10).map(h => `<tr><td>#${h.id}</td><td>${new Date(h.createdAt).toLocaleDateString('pt-BR')}</td><td>${h.items.map(i => `${i.quantity}x ${esc(i.description)}`).join(', ')}</td><td>${brl(h.totalAmount)}</td></tr>`).join('')}</table>`
          : '<p class="muted">Nenhum pedido anterior encontrado para este cliente.</p>';
        modal(`Histórico de Compras — ${delivery.name || 'Cliente'}`, html, () => {}, 'Fechar');
      });
    }

    document.querySelectorAll('[data-size]').forEach(b => b.onclick = () => {
      pz.sizeId = +b.dataset.size;
      pz.flavors = pz.flavors.slice(0, sizeOf(pz.sizeId).maxFlavors).filter(id => flavorPrice(menu.flavors.find(f => f.id === id), pz.sizeId) !== null);
      draw();
    });
    $('fq').oninput = debounce(() => { pz.q = $('fq').value; draw(); const e = $('fq'); e.focus(); e.setSelectionRange(e.value.length, e.value.length); }, 200);
    document.querySelectorAll('[data-flavor]').forEach(el => el.onclick = () => {
      const id = +el.dataset.flavor;
      if (flavorPrice(menu.flavors.find(x => x.id === id), pz.sizeId) === null) return toast('Sabor sem preco neste tamanho');
      if (pz.flavors.includes(id)) pz.flavors = pz.flavors.filter(x => x !== id);
      else if (pz.flavors.length >= size.maxFlavors) return toast(`${size.name} aceita ate ${size.maxFlavors} sabor(es)`);
      else pz.flavors.push(id);
      draw();
    });
    $('crust').onchange = () => { pz.crustId = $('crust').value; draw(); };
    $('addpz').onclick = () => {
      if (!pz.flavors.length) return toast('Escolha ao menos um sabor');
      const names = pz.flavors.map(id => menu.flavors.find(f => f.id === id).name);
      const crust = menu.crusts.find(c => c.id === +pz.crustId);
      cart.push({
        kind: 'pizza', sizeId: pz.sizeId, flavorIds: [...pz.flavors], crustId: pz.crustId || null,
        label: `Pizza ${size.name} - ${names.join(' / ')}${crust ? ' - Borda ' + crust.name : ''}`,
        price: pizzaPrice(), qty: 1, obs: $('pzobs').value,
      });
      pz.flavors = [];
      const pzobsEl = $('pzobs');
      if (pzobsEl) pzobsEl.value = '';
      draw();
    };

    $('pq').oninput = debounce(() => { prodFilter.q = $('pq').value; draw(); const e = $('pq'); e.focus(); e.setSelectionRange(e.value.length, e.value.length); }, 200);
    const pobsEl = $('pobs');
    if (pobsEl) {
      pobsEl.oninput = () => { prodFilter.obs = pobsEl.value; };
    }
    document.querySelectorAll('[data-cat]').forEach(el => el.onclick = () => { prodFilter.cat = el.dataset.cat; draw(); });

    document.querySelectorAll('[data-prod]').forEach(el => el.onclick = () => {
      const p = products.find(x => x.id === +el.dataset.prod);
      if (!p) return;
      openProductItemModal(p, prodFilter.obs || '', 1, ({ qty, obs }) => {
        prodFilter.obs = '';
        const ex = cart.find(c => c.productId === p.id && (c.obs || '') === (obs || ''));
        if (ex) {
          ex.qty += qty;
        } else {
          cart.push({
            kind: 'produto',
            productId: p.id,
            label: p.name,
            price: Number(p.price),
            qty,
            obs,
          });
        }
        draw();
      });
    });

    document.querySelectorAll('.edit-item-obs').forEach(a => a.onclick = () => {
      const idx = +a.dataset.idx;
      const it = cart[idx];
      if (!it) return;
      const p = (products.find(x => x.id === it.productId)) || {
        name: it.label,
        price: it.price,
        Category: { name: it.kind === 'pizza' ? 'Pizza' : 'Produto' },
      };
      openProductItemModal(p, it.obs || '', it.qty, ({ qty, obs }) => {
        it.qty = qty;
        it.obs = obs;
        draw();
      });
    });

    document.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { cart[b.dataset.p].qty++; draw(); });
    document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const i = cart[b.dataset.m]; if (--i.qty <= 0) cart.splice(b.dataset.m, 1); draw(); });

    $('send').onclick = safe(async () => {
      if (!cart.length) return toast('Carrinho vazio');
      if (type === 'mesa' && !tableId) return toast('Selecione uma mesa');

      if (type === 'balcao') {
        if ($('balcao-name')) balcao.name = $('balcao-name').value.trim();
        if ($('balcao-phone')) balcao.phone = $('balcao-phone').value.trim();
        if ($('balcao-notes')) balcao.notes = $('balcao-notes').value.trim();

        if (!balcao.name || !balcao.name.trim()) {
          toast('⚠️ Por favor, informe o Nome do Cliente para lançar o pedido de Balcão!');
          const inp = $('balcao-name');
          if (inp) {
            inp.focus();
            inp.style.borderColor = '#dc3545';
            inp.style.boxShadow = '0 0 0 3px rgba(220, 53, 69, 0.3)';
          }
          const card = document.querySelector('.balcao-cliente-card');
          if (card) card.classList.add('invalido');
          return;
        }
      }

      let addrStr = '';
      if (type === 'delivery') {
        delivery.phone = $('dlv-phone').value;
        delivery.name = $('dlv-name').value;
        delivery.street = $('dlv-street').value;
        delivery.number = $('dlv-num').value;
        delivery.complement = $('dlv-comp').value;
        delivery.reference = $('dlv-ref').value;
        delivery.neighborhoodId = $('bairro').value;
        delivery.deliveryMode = $('dlv-mode').value;
        delivery.paymentMethod = $('dlv-pay').value;
        delivery.changeFor = $('troco').value;
        delivery.discount = $('dlv-disc').value;
        delivery.notes = $('dlv-notes') ? $('dlv-notes').value : '';
        addrStr = delivery.street || delivery.customer?.address || (delivery.deliveryMode === 'b' ? 'Retirada no Balcão' : '');
        if (delivery.deliveryMode === 'e' && (!delivery.neighborhoodId || !delivery.street)) {
          return toast('Informe o Endereço e o Bairro para Disk-Entrega');
        }
      }
      await api('/orders', 'POST', {
        orderId: targetOrderId || null,
        type, tableId: type === 'mesa' ? tableId : null,
        customerId: type === 'delivery' ? delivery.customer?.id || null : (type === 'balcao' ? (balcao.customer?.id || targetOrder?.CustomerId || null) : null),
        customerName: type === 'delivery' ? (delivery.name || delivery.customer?.name || 'Cliente Delivery') : (type === 'balcao' ? (balcao.name.trim() || targetOrder?.Customer?.name || 'Balcão') : null),
        customerPhone: type === 'delivery' ? (delivery.phone || delivery.customer?.phone || '') : (type === 'balcao' ? (balcao.phone?.trim() || '') : null),
        neighborhoodId: type === 'delivery' ? (delivery.neighborhoodId || null) : null,
        address: addrStr,
        addressNumber: type === 'delivery' ? (delivery.number || null) : null,
        complement: type === 'delivery' ? (delivery.complement || null) : null,
        reference: type === 'delivery' ? (delivery.reference || null) : null,
        deliveryMode: type === 'delivery' ? (delivery.deliveryMode === 'b' ? 'RETIRADA' : 'DISK-ENTREGA') : null,
        isNewCustomer: type === 'delivery' ? (!delivery.customer?.id) : false,
        changeFor: type === 'delivery' ? (delivery.changeFor || null) : null,
        freeDelivery: type === 'delivery' ? Boolean(delivery.freeDelivery || delivery.deliveryMode === 'b') : false,
        customDeliveryFee: type === 'delivery' && delivery.customFee !== '' ? delivery.customFee : null,
        paymentMethod: type === 'delivery' ? delivery.paymentMethod : null,
        discount: type === 'delivery' ? (delivery.discount || 0) : 0,
        notes: type === 'delivery' ? (delivery.notes || (delivery.cpfCnpj ? `CPF/CNPJ: ${delivery.cpfCnpj}` : null)) : (type === 'balcao' ? (balcao.notes?.trim() || null) : null),
        items: cart.map(i => i.kind === 'pizza'
          ? { kind: 'pizza', sizeId: i.sizeId, flavorIds: i.flavorIds, crustId: i.crustId, quantity: i.qty, observations: i.obs }
          : { kind: 'produto', productId: i.productId, quantity: i.qty, observations: i.obs }),
      });
      toast(targetOrderId
        ? `✅ Novos itens adicionados à Comanda #${targetOrderId} e impressos na cozinha!`
        : (type === 'balcao' ? `✅ Pedido de Balcão para "${balcao.name}" enviado e impresso na cozinha!` : 'Pedido enviado e impresso na cozinha!'));
      tab = type === 'delivery' ? 'delivery' : (type === 'balcao' ? 'balcao' : 'pedidos');
      render();
    });
  };
  draw();
}

// ---------- Modal de Confirmação de Fechamento de Mesa (EiChefe confirmarFechaVenda.tpl) ----------
function confirmCloseTable({
  tableNumber,
  orderId,
  totalAmount = 0,
  alreadyPaid = 0,
  amountPaying = 0,
  changeAmount = 0,
  paymentMethodDesc = '',
  payerName = null,
  onConfirm,
  onCancel,
}) {
  const overlay = document.createElement('div');
  overlay.className = 'modalConfirmarFechamentoOverlay';

  const closeDialog = () => {
    window.removeEventListener('keydown', handleKey);
    overlay.remove();
    if (typeof onCancel === 'function') onCancel();
  };

  const handleKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      overlay.querySelector('#btnConfirmarFechamento')?.click();
    }
  };
  window.addEventListener('keydown', handleKey);

  overlay.innerHTML = `
    <div class="modalConfirmarFechamentoBox" role="dialog" aria-modal="true">
      <div class="headerConfirmarFechamento">
        <div style="font-size:30px;line-height:1">⚠️</div>
        <div style="flex:1">
          <h3 style="margin:0;font-size:18px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:0.5px">
            Confirmar Fechamento de Mesa
          </h3>
          <div style="font-size:12.5px;color:#64748b;margin-top:2px">
            Mesa #${tableNumber} ${orderId ? `• Pedido #${orderId}` : ''}
          </div>
        </div>
        <button type="button" id="btnFecharConfirmacaoX" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;padding:4px 8px;line-height:1" title="Cancelar (ESC)">✕</button>
      </div>

      <div style="font-size:14.5px;font-weight:600;color:#0f172a;margin-bottom:10px">
        Deseja realmente fechar a conta e liberar a Mesa #${tableNumber}?
      </div>

      <div class="resumoCardFechamento">
        <div class="linhaResumoFech">
          <span>Mesa:</span>
          <b>Mesa #${tableNumber}</b>
        </div>
        <div class="linhaResumoFech">
          <span>Total Consumido:</span>
          <b style="color:#0f172a">${brl(totalAmount)}</b>
        </div>
        ${alreadyPaid > 0 ? `
          <div class="linhaResumoFech">
            <span>Valor Já Pago Anteriormente:</span>
            <b style="color:#2563eb">${brl(alreadyPaid)}</b>
          </div>
        ` : ''}
        <div class="linhaResumoFech">
          <span>Valor Deste Recebimento:</span>
          <b style="color:#16a34a;font-size:15px">${brl(amountPaying)}</b>
        </div>
        <div class="linhaResumoFech">
          <span>Forma(s) de Pagamento:</span>
          <b>${esc(paymentMethodDesc || 'Dinheiro')}</b>
        </div>
        ${changeAmount > 0 ? `
          <div class="linhaResumoFech" style="border-top:1px dashed #cbd5e1;padding-top:6px;margin-top:4px">
            <span style="color:#15803d;font-weight:bold">Troco a Devolver:</span>
            <b style="color:#15803d;font-size:15px">${brl(changeAmount)}</b>
          </div>
        ` : ''}
        ${payerName ? `
          <div class="linhaResumoFech">
            <span>Cliente / Pagador:</span>
            <b>${esc(payerName)}</b>
          </div>
        ` : ''}
      </div>

      <div class="avisoLiberacaoMesa">
        ⚠️ <b>Atenção:</b> Após a confirmação, o pagamento será registrado no caixa e a <b>Mesa #${tableNumber}</b> será desocupada e marcada como <b>LIVRE</b> no salão.
      </div>

      <div class="footerConfirmarFechamento">
        <button type="button" class="btn sec" id="btnCancelFechamento" style="padding:9px 16px;font-size:13px;font-weight:600">
          Voltar (ESC)
        </button>
        <button type="button" class="btn ok" id="btnConfirmarFechamento" style="background:#16a34a;color:#fff;padding:9px 20px;font-size:13.5px;font-weight:700">
          ✓ Sim, Fechar Mesa (ENTER)
        </button>
      </div>
    </div>
  `;

  overlay.querySelector('#btnFecharConfirmacaoX').onclick = closeDialog;
  overlay.querySelector('#btnCancelFechamento').onclick = closeDialog;

  overlay.querySelector('#btnConfirmarFechamento').onclick = safe(async () => {
    window.removeEventListener('keydown', handleKey);
    overlay.remove();
    if (typeof onConfirm === 'function') await onConfirm();
  });

  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.querySelector('#btnConfirmarFechamento')?.focus();
  }, 50);
}

// ---------- Modal Cancelamento de Item (EiChefe: cancelarProdutos.tpl / alterarProdutos.tpl) ----------
function openModalCancelarItem(order, item, onDone) {
  const totalQty = Number(item.quantity);
  const paidQty = Number(item.paidQuantity || 0);
  const maxCancelable = Math.max(0, +(totalQty - paidQty).toFixed(2));
  if (maxCancelable <= 0.009) {
    return toast('Não é possível cancelar um item 100% pago. Estorne o pagamento primeiro.');
  }

  let qtyToCancel = maxCancelable;

  const overlay = document.createElement('div');
  overlay.className = 'modalCancelarItemOverlay';

  const renderContent = () => {
    overlay.innerHTML = `
      <div class="modalCancelarItemBox">
        <div class="modalCancelarHeader">
          <div class="modalCancelarTitle">
            <h3>CANCELAMENTO DE ITEM</h3>
            <small>Informe a quantidade e o motivo do cancelamento deste produto da mesa</small>
          </div>
          <div class="fecharModalCancelar" id="mCancelClose" title="Fechar (ESC)">✕</div>
        </div>

        <div class="modalCancelarBody">
          <div class="cardItemCancelInfo">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
              <span style="font-size:16px;font-weight:bold;color:#111">
                ${esc(item.description || item.Product?.name || 'Produto')}
              </span>
              <span style="font-size:13px;color:#666">Cód: #${item.id}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;color:#444">
              <span><b>Qtd Atual:</b> ${totalQty} un.</span>
              <span><b>Unitário:</b> ${brl(item.unitPrice)}</span>
              <span><b>Total Lançado:</b> <b>${brl(totalQty * Number(item.unitPrice))}</b></span>
            </div>
          </div>

          <div class="formGroupCancel">
            <label style="font-size:12px;font-weight:bold;color:#333;display:block;margin-bottom:4px">
              QUANTIDADE A CANCELAR:
            </label>
            <div class="stepperCancelWrapper">
              <button type="button" class="btnStepperCancel" id="btnStepCancelSub">−</button>
              <input type="number" id="inpQtdCancel" class="inpStepperCancel" min="1" max="${maxCancelable}" value="${qtyToCancel}">
              <button type="button" class="btnStepperCancel" id="btnStepCancelAdd">+</button>
              <button type="button" class="btn sec sm" id="btnCancelAllQty" style="font-size:11px;padding:3px 8px;margin-left:6px" title="Marcar todos">Total (${maxCancelable})</button>
              <span class="muted" style="font-size:12px;margin-left:6px">Subtotal a abater: <b style="color:#dc3545">${brl(qtyToCancel * Number(item.unitPrice))}</b></span>
            </div>
          </div>

          <div class="formGroupCancel">
            <label style="font-size:12px;font-weight:bold;color:#333;display:block;margin-bottom:4px">
              MOTIVO DO CANCELAMENTO: <span style="color:#dc3545">*</span>
            </label>
            <select id="selMotivoCancel" class="form-control" style="width:100%;margin-bottom:8px;font-size:13px">
              <option value="Cliente desistiu">Cliente desistiu</option>
              <option value="Pedido lançado por engano / duplicado">Pedido lançado por engano / duplicado</option>
              <option value="Demora no atendimento / preparo">Demora no atendimento / preparo</option>
              <option value="Troca por outro produto / sabor">Troca por outro produto / sabor</option>
              <option value="Item indisponível na cozinha / bar">Item indisponível na cozinha / bar</option>
              <option value="Prato incorreto / problema com o pedido">Prato incorreto / problema com o pedido</option>
              <option value="Outro motivo">Outro motivo</option>
            </select>
            <input type="text" id="inpMotivoObs" class="form-control" placeholder="Observação adicional ou justificativa..." style="width:100%;font-size:12px">
          </div>

          <div class="formGroupCancel" style="margin-top:12px;background:#f9fafb;padding:8px 10px;border-radius:6px;border:1px solid #e5e7eb">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;margin:0">
              <input type="checkbox" id="chkPrintCancel" checked style="width:16px;height:16px">
              🖨️ Imprimir Comanda de Cancelamento para a Cozinha / Bar
            </label>
          </div>
        </div>

        <div class="modalCancelarFooter">
          <button type="button" class="btn sec" id="btnCancelVoltar">Voltar</button>
          <button type="button" class="btn danger" id="btnConfirmarCancel">
            ❌ Confirmar Cancelamento
          </button>
        </div>
      </div>
    `;

    const closeCancelModal = () => {
      window.removeEventListener('keydown', handleKey);
      overlay.remove();
    };

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCancelModal();
      } else if (e.key === 'Enter') {
        if (e.target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          overlay.querySelector('#btnConfirmarCancel')?.click();
        }
      }
    };
    window.addEventListener('keydown', handleKey);

    overlay.querySelector('#mCancelClose').onclick = closeCancelModal;
    overlay.querySelector('#btnCancelVoltar').onclick = closeCancelModal;

    const inpQtd = overlay.querySelector('#inpQtdCancel');
    overlay.querySelector('#btnStepCancelSub').onclick = () => {
      if (qtyToCancel > 1) {
        qtyToCancel--;
        inpQtd.value = qtyToCancel;
        renderContent();
      }
    };
    overlay.querySelector('#btnStepCancelAdd').onclick = () => {
      if (qtyToCancel < maxCancelable) {
        qtyToCancel++;
        inpQtd.value = qtyToCancel;
        renderContent();
      }
    };
    overlay.querySelector('#btnCancelAllQty').onclick = () => {
      qtyToCancel = maxCancelable;
      inpQtd.value = qtyToCancel;
      renderContent();
    };
    inpQtd.onchange = () => {
      const v = parseInt(inpQtd.value, 10);
      qtyToCancel = Math.max(1, Math.min(maxCancelable, isNaN(v) ? 1 : v));
      renderContent();
    };

    overlay.querySelector('#btnConfirmarCancel').onclick = safe(async () => {
      const reason = overlay.querySelector('#selMotivoCancel').value;
      const notes = overlay.querySelector('#inpMotivoObs').value;
      const printCancellation = overlay.querySelector('#chkPrintCancel').checked;

      const res = await api(`/orders/${order.id}/items/${item.id}/cancel`, 'POST', {
        quantity: qtyToCancel,
        reason,
        notes,
        printCancellation,
      });

      closeCancelModal();
      toast(`✅ Item "${item.description}" (${qtyToCancel}x) cancelado!`);

      if (res.printJobs && res.printJobs.length > 0) {
        openThermalPreviewModal(res.printJobs, `Comanda de Cancelamento — Pedido #${order.id}`);
      }

      if (typeof onDone === 'function') onDone(res.order);
    });
  };

  renderContent();
  document.body.appendChild(overlay);
}

// ---------- Modal Detalhes da Mesa (EiChefe Gestão) ----------
function openMesaDetalhesModal(table, onRefresh) {
  if (!table || !table.order) return;
  const o = table.order;
  const activeItems = (o.items || []).filter(it => it.status !== 'cancelado');
  const cancelledItems = (o.items || []).filter(it => it.status === 'cancelado');

  modal(`Mesa #${table.number} — Detalhes do Atendimento`, `
    <div style="font-size:13px;margin-bottom:12px">
      <div class="eichefe-mesa-modal-grid">
        <div class="eichefe-mesa-modal-card">
          <h5>Dados da Mesa</h5>
          <div><b>Mesa:</b> #${table.number}</div>
          <div><b>Atendente:</b> ${esc(o.operatorName || 'Garçom')}</div>
          <div><b>Aberto às:</b> ${new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (${o.timeStr})</div>
          ${o.customerName ? `<div><b>Cliente:</b> ${esc(o.customerName)}</div>` : ''}
          <div style="margin-top:4px">
            <b>Status:</b> 
            <span class="t-badge ${table.status === 'pronto' ? 'preparo' : (table.status === 'fechamento' ? 'cancelado' : 'delivery')}" style="font-size:11px;padding:2px 8px">
              ${table.status === 'pronto' ? '✅ Pedido Pronto no KDS' : (table.status === 'fechamento' ? '🔴 Em Fechamento / Conta' : '🟠 Aberta / Em Consumo')}
            </span>
          </div>
        </div>
        <div class="eichefe-mesa-modal-card">
          <h5>Financeiro</h5>
          <div><b>Total Consumido:</b> <span style="font-weight:700;color:#28a745">${brl(o.total)}</span></div>
          <div><b>Valor Já Pago:</b> ${brl(o.paid)}</div>
          <div><b>Saldo Devido:</b> <span style="font-weight:800;color:#dc3545">${brl(o.due)}</span></div>
          ${o.splitCount > 1 ? `
            <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #ddd;font-size:12px;color:#0d6efd;font-weight:700">
              👥 Dividido em <b>${o.splitCount}</b> pessoas: <b>${brl(o.total / o.splitCount)}</b> por pessoa
            </div>
          ` : ''}
        </div>
      </div>

      <h5 style="margin:8px 0 4px">Itens Lançados (${activeItems.length})</h5>
      <div class="eichefe-mesa-modal-items">
        ${activeItems.length ? activeItems.map(it => `
          <div class="eichefe-mesa-modal-item">
            <div>
              <b>${it.quantity}x</b> ${esc(it.description || it.Product?.name || 'Item')}
              ${it.observations ? `<span style="color:#ff6600;font-size:11px"> (Obs: ${esc(it.observations)})</span>` : ''}
              ${it.splitInfo ? ` <span style="font-size:11px;color:#8116d7;font-weight:bold">(${it.splitInfo.splitPeople} partes de ${brl(it.splitInfo.partAmount)})</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span class="t-badge ${it.status === 'pronto' ? 'preparo' : (it.status === 'preparo' ? 'delivery' : '')}" style="font-size:10px;padding:2px 6px">
                ${it.status === 'pronto' ? '✅ Pronto' : (it.status === 'preparo' ? '🔥 Preparo' : '⏳ Fila')}
              </span>
              <b>${brl(it.quantity * it.unitPrice)}</b>
              <button type="button" class="btn danger sm btn-cancelar-item-mesa" data-cancel-item-id="${it.id}" title="Cancelar este item (EiChefe F4)" style="padding:2px 8px;font-size:11px;margin-left:4px">
                ✕ Cancelar
              </button>
            </div>
          </div>
        `).join('') : '<p class="muted">Nenhum item ativo nesta mesa</p>'}
      </div>

      ${cancelledItems.length ? `
        <details class="eichefe-mesa-modal-card" style="margin-top:10px;border-left:3px solid #dc3545">
          <summary style="cursor:pointer;font-weight:bold;color:#991b1b;font-size:12px">
            🚫 Produtos Cancelados (${cancelledItems.length}) — estilo EiChefe
          </summary>
          <div style="margin-top:6px">
            ${cancelledItems.map(cIt => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px dashed #fca5a5;font-size:12px">
                <div>
                  <b style="color:#991b1b">${cIt.quantity}x</b> <span style="text-decoration:line-through;color:#555">${esc(cIt.description)}</span>
                  <div style="font-size:11px;color:#7f1d1d">
                    Motivo: <i>${esc(cIt.cancelledReason || 'Cancelado')}</i> • ${esc(cIt.cancelledBy || 'Operador')} (${new Date(cIt.cancelledAt || cIt.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="color:#991b1b;font-weight:bold">${brl(cIt.quantity * cIt.unitPrice)}</span>
                  <button type="button" class="btn sec sm btn-print-cancel" data-print-cancel-id="${cIt.id}" title="Reimprimir Comprovante de Cancelamento" style="padding:1px 6px;font-size:11px">🖨️</button>
                </div>
              </div>
            `).join('')}
          </div>
        </details>
      ` : ''}
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:14px">
      <button type="button" class="btn sm" id="md-add-items" style="background:#029CC1;color:#fff">➕ Lançar Mais Itens</button>
      ${(o.paid || o.due <= 0.01) ? `
        <button type="button" class="btn ok sm" id="md-fechar-mesa" style="font-weight:700;background:#16a34a;color:#fff" title="Fechar conta e liberar mesa no salão">🏁 Fechar e Liberar Mesa</button>
      ` : `
        <button type="button" class="btn sm ok" id="md-pay">💰 Receber / Dividir Conta</button>
      `}
      <button type="button" class="btn danger sm" id="md-cancel-item-btn" title="Cancelar item da mesa (EiChefe F4)">❌ Cancelar Item</button>
      <button type="button" class="btn sm sec" id="md-imp">🖨️ Imprimir Conferência</button>
      <button type="button" class="btn sm" id="md-nfe" style="background:#0284c7;color:#fff;font-weight:700" title="Emitir Cupom Fiscal NFC-e">🧾 Emitir NFC-e</button>
      <button type="button" class="btn sm sec" id="md-transfer">🔄 Mudar Mesa</button>
      <button type="button" class="btn danger sm" id="md-delete" title="Excluir Atendimento e Liberar Mesa">🗑️ Excluir</button>
      <button type="button" class="btn sm sec" onclick="document.querySelector('.overlay')?.remove()">Fechar</button>
    </div>
  `, null, null, 'wide');

  const handleItemCancelled = (updatedOrder) => {
    document.querySelectorAll('.overlay').forEach(el => el.remove());
    const remainingActive = (updatedOrder.items || []).filter(x => x.status !== 'cancelado');
    if (updatedOrder.status === 'cancelado' || remainingActive.length === 0) {
      toast(`Mesa #${table.number} liberada (todos os itens foram cancelados).`);
      if (typeof onRefresh === 'function') onRefresh();
      else render();
    } else {
      table.order = updatedOrder;
      table.order.total = Number(updatedOrder.totalAmount);
      table.order.due = Math.max(0, +(Number(updatedOrder.totalAmount) - Number(updatedOrder.paidAmount || 0)).toFixed(2));
      openMesaDetalhesModal(table, onRefresh);
    }
  };

  document.querySelectorAll('.btn-cancelar-item-mesa').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const itemId = +btn.dataset.cancelItemId;
      const it = (o.items || []).find(x => x.id === itemId);
      if (it) openModalCancelarItem(o, it, handleItemCancelled);
    };
  });

  document.querySelectorAll('.btn-print-cancel').forEach(btn => {
    btn.onclick = safe(async (e) => {
      e.stopPropagation();
      const itemId = +btn.dataset.printCancelId;
      const cIt = (o.items || []).find(x => x.id === itemId);
      if (!cIt) return;
      const r = await api(`/printers/print-cancel/${o.id}/${cIt.id}`, 'POST', {
        quantity: cIt.quantity,
        reason: cIt.cancelledReason,
      });
      openThermalPreviewModal(r.jobs, `Comanda de Cancelamento — Mesa #${table.number}`);
    });
  });

  const btnMdCancel = $('md-cancel-item-btn');
  if (btnMdCancel) {
    btnMdCancel.onclick = () => {
      if (!activeItems.length) return toast('Não há itens ativos para cancelar nesta mesa');
      if (activeItems.length === 1) {
        openModalCancelarItem(o, activeItems[0], handleItemCancelled);
      } else {
        modal(`Selecione o item para cancelar — Mesa #${table.number}`, `
          <p style="font-size:13px;color:#555;margin-bottom:10px">Selecione qual item da mesa deseja cancelar:</p>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${activeItems.map(it => `
              <button type="button" class="btn sec" data-pick-cancel="${it.id}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;text-align:left">
                <span><b>${it.quantity}x</b> ${esc(it.description || 'Produto')}</span>
                <span style="font-weight:bold;color:#dc3545">❌ Cancelar (${brl(it.quantity * it.unitPrice)})</span>
              </button>
            `).join('')}
          </div>
        `, null, null);
        document.querySelectorAll('[data-pick-cancel]').forEach(b => {
          b.onclick = () => {
            const pickId = +b.dataset.pickCancel;
            const picked = activeItems.find(x => x.id === pickId);
            document.querySelectorAll('.overlay').forEach(el => el.remove());
            openMesaDetalhesModal(table, onRefresh);
            if (picked) openModalCancelarItem(o, picked, handleItemCancelled);
          };
        });
      }
    };
  }

  $('md-add-items').onclick = () => {
    document.querySelector('.overlay')?.remove();
    initialOrderType = 'mesa';
    initialTableId = table.id;
    tab = 'pedido';
    render();
  };

  const btnMdPay = $('md-pay');
  if (btnMdPay) {
    btnMdPay.onclick = () => {
      document.querySelector('.overlay')?.remove();
      openPaymentModal(o.id, onRefresh);
    };
  }

  const btnMdFecharMesa = $('md-fechar-mesa');
  if (btnMdFecharMesa) {
    btnMdFecharMesa.onclick = () => {
      confirmCloseTable({
        tableNumber: table.number,
        orderId: o.id,
        totalAmount: o.total,
        alreadyPaid: o.paid || o.total,
        amountPaying: 0,
        changeAmount: 0,
        paymentMethodDesc: 'Conta Totalmente Quitada',
        payerName: o.customerName || null,
        onConfirm: async () => {
          await api(`/orders/${o.id}/pay`, 'POST', { amount: 0, paymentMethod: 'Dinheiro' }).catch(() => {});
          document.querySelectorAll('.overlay').forEach(el => el.remove());
          toast(`✅ Mesa #${table.number} fechada e liberada com sucesso!`);
          if (typeof onRefresh === 'function') onRefresh();
          else render();
        },
      });
    };
  }

  $('md-imp').onclick = safe(async () => {
    const r = await api(`/printers/print-order/${o.id}`, 'POST', { type: 'conta' });
    openThermalPreviewModal(r.jobs, `Conferência Mesa #${table.number}`);
  });

  const btnMdNfe = $('md-nfe');
  if (btnMdNfe) {
    btnMdNfe.onclick = () => {
      openNfeModal(o.id, () => {
        openMesaDetalhesModal(table, onRefresh);
      });
    };
  }

  $('md-transfer').onclick = async () => {
    document.querySelector('.overlay')?.remove();
    const allTables = await api('/tables');
    openMudarMesaModal(allTables, table.number, onRefresh);
  };

  $('md-delete').onclick = () => {
    modal(`Excluir Pedido #${o.id} da Mesa #${table.number}`, `
      <p>Deseja <b>EXCLUIR permanentemente</b> o atendimento da <b>Mesa #${table.number}</b> (Pedido #${o.id})?</p>
      <div style="background:#fee2e2;border:1px solid #fecaca;padding:10px;border-radius:6px;color:#991b1b;margin-top:10px;font-size:12px">
        ⚠️ A mesa será liberada imediatamente no salão e todos os itens lançados serão excluídos do sistema.
      </div>
    `, async () => {
      await api(`/orders/${o.id}`, 'DELETE');
      document.querySelectorAll('.overlay').forEach(el => el.remove());
      toast(`Mesa #${table.number} liberada e pedido excluído com sucesso!`);
      if (typeof onRefresh === 'function') onRefresh();
      else render();
    }, 'Excluir');
  };
}

// ---------- Modal Mudar / Vincular Mesa (mudarMesa.tpl do EiChefe) ----------
function openMudarMesaModal(tables, prefillFromNumber = null, onRefresh = null) {
  const occupiedTables = tables.filter(t => t.isOpen);
  if (!occupiedTables.length) return toast('Não há mesas ocupadas para transferir');

  modal(`Mudar / Vincular Mesa (mudarMesa.tpl)`, `
    <div style="font-size:13px;margin-bottom:15px">
      <p style="color:#555;margin-bottom:12px">
        Selecione a <b>Mesa de Origem</b> e a <b>Mesa de Destino</b>. Se a mesa de destino estiver livre, o atendimento será transferido integralmente. Se já estiver ocupada, os pedidos serão <b>unidos / vinculados</b> conforme no EiChefe.
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">Mesa de Origem</label>
          <select id="transfer-origem" style="width:100%;font-size:14px;font-weight:700">
            ${occupiedTables.map(t => `<option value="${t.number}" ${prefillFromNumber === t.number ? 'selected' : ''}>Mesa #${t.number} — ${esc(t.order?.operatorName || 'Garçom')} (${brl(t.order?.total || 0)})</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px">Mesa de Destino</label>
          <select id="transfer-destino" style="width:100%;font-size:14px;font-weight:700">
            ${tables.map(t => `<option value="${t.number}">Mesa #${t.number} ${t.isOpen ? `(Ocupada - ${brl(t.order?.total || 0)})` : '(Livre)'}</option>`).join('')}
          </select>
        </div>
      </div>

      <div id="transfer-warning" style="background:#fff3cd;border:1px solid #ffeeba;color:#856404;padding:8px 10px;border-radius:4px;display:none;font-size:12px">
        ⚠️ Atenção: A mesa de destino já está ocupada. Os itens serão mesclados na mesma comanda.
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button type="button" class="btn sec sm" onclick="document.querySelector('.overlay')?.remove()">Cancelar</button>
      <button type="button" class="btn ok sm" id="btn-confirm-transfer" style="font-weight:800">MUDAR MESA</button>
    </div>
  `, null);

  const selDest = $('transfer-destino');
  const selOrig = $('transfer-origem');
  const warn = $('transfer-warning');

  const checkDest = () => {
    const destNum = +selDest.value;
    const destT = tables.find(t => t.number === destNum);
    warn.style.display = destT && destT.isOpen ? 'block' : 'none';
  };
  selDest.onchange = checkDest;
  checkDest();

  $('btn-confirm-transfer').onclick = safe(async () => {
    const fromNum = +selOrig.value;
    const toNum = +selDest.value;
    if (fromNum === toNum) return toast('A mesa de origem e destino devem ser diferentes');
    await api('/tables/transfer', 'POST', { fromTableNumber: fromNum, toTableNumber: toNum });
    document.querySelector('.overlay')?.remove();
    toast(`Mesa #${fromNum} transferida com sucesso para Mesa #${toNum}!`);
    if (typeof onRefresh === 'function') onRefresh();
    else render();
  });
}

// ---------- Tela Completa de Mesas do Salão (terminalMesas.tpl do EiChefe) ----------
let salonMesaFilter = 'todas';
let salonMesaDisplayMode = 'tempo';
let salonMesaSearch = '';

async function viewMesas() {
  const load = safe(async () => {
    const tables = await api('/tables');

    const totalCount = tables.length;
    const ocupadasCount = tables.filter(t => t.isOpen).length;
    const livresCount = totalCount - ocupadasCount;
    const prontosCount = tables.filter(t => t.status === 'pronto').length;
    const fechamentoCount = tables.filter(t => t.status === 'fechamento').length;

    const filtered = tables.filter(t => {
      if (salonMesaFilter === 'livres' && t.isOpen) return false;
      if (salonMesaFilter === 'ocupadas' && !t.isOpen) return false;
      if (salonMesaFilter === 'pronto' && t.status !== 'pronto') return false;
      if (salonMesaFilter === 'fechamento' && t.status !== 'fechamento') return false;

      if (salonMesaSearch.trim()) {
        const q = salonMesaSearch.trim().toLowerCase();
        const numMatch = String(t.number).includes(q);
        const custMatch = t.order?.customerName?.toLowerCase().includes(q);
        const opMatch = t.order?.operatorName?.toLowerCase().includes(q);
        if (!numMatch && !custMatch && !opMatch) return false;
      }
      return true;
    });

    view().innerHTML = `
      <div class="eichefe-salon-container">
        <!-- Barra Superior Idêntica ao terminalMesas.tpl + cabecalho.tpl do EiChefe -->
        <div class="eichefe-salon-top">
          <div class="eichefe-salon-stats">
            <div class="eichefe-salon-badge total ${salonMesaFilter === 'todas' ? 'active' : ''}" data-smf="todas" title="Ver todas as mesas">
              📊 Total: ${totalCount}
            </div>
            <div class="eichefe-salon-badge livres ${salonMesaFilter === 'livres' ? 'active' : ''}" data-smf="livres" title="Filtrar mesas livres">
              🟢 Livres: ${livresCount}
            </div>
            <div class="eichefe-salon-badge ocupadas ${salonMesaFilter === 'ocupadas' ? 'active' : ''}" data-smf="ocupadas" title="Filtrar mesas ocupadas">
              🟠 Ocupadas: ${ocupadasCount}
            </div>
            <div class="eichefe-salon-badge prontos ${salonMesaFilter === 'pronto' ? 'active' : ''}" data-smf="pronto" title="Pedidos com itens prontos na cozinha (KDS)">
              ✅ KDS Prontos: ${prontosCount}
            </div>
            <div class="eichefe-salon-badge fechamento ${salonMesaFilter === 'fechamento' ? 'active' : ''}" data-smf="fechamento" title="Mesas em fechamento / pagamento">
              🔴 Em Conta: ${fechamentoCount}
            </div>
          </div>

          <!-- Caixa Número da Mesa Rápido: Mesa (DEL) -->
          <form class="eichefe-quick-mesa-box" id="form-quick-mesa" onsubmit="return false;">
            <div class="eichefe-quick-mesa-label">Mesa<span>(DEL)</span></div>
            <input type="number" id="mesa-quick-del" class="eichefe-quick-mesa-input" placeholder="Nº" min="1" max="500" autocomplete="off">
            <button type="submit" class="eichefe-quick-mesa-btn" title="Abrir Mesa">➔</button>
          </form>

          <!-- Ações Rápidas do EiChefe -->
          <button type="button" class="btn sec sm" id="btn-mudar-mesa-top" title="Transferir ou unir mesas">🔄 Mudar Mesa</button>
          <button type="button" class="btn sec sm" id="btn-balcao-top" title="Ir para Painel de Balcão" style="color:#15803d;border-color:#15803d;font-weight:700">🛍️ Balcão</button>
          <button type="button" class="btn ok sm" id="btn-novo-pedido-top" title="Abrir novo atendimento">➕ Novo Pedido</button>

          <!-- Controles de Busca e Alternância de Modo -->
          <div class="eichefe-salon-controls">
            <input id="mesa-search-filter" class="eichefe-salon-search" placeholder="🔍 Filtrar mesa, garçom..." value="${esc(salonMesaSearch)}">
            <button type="button" id="btn-toggle-display" class="eichefe-toggle-btn" title="Alternar entre tempo e valor">
              ${salonMesaDisplayMode === 'tempo' ? '⏱️ Exibir: Tempo' : '💲 Exibir: Valor'}
            </button>
          </div>
        </div>

        <!-- Grade de Mesas (.englobaMesas) -->
        <div class="englobaMesas" style="max-height: calc(100vh - 160px)">
          ${filtered.map(t => renderMesaCard(t, false, salonMesaDisplayMode)).join('')}
        </div>
      </div>
    `;

    document.querySelectorAll('[data-smf]').forEach(el => {
      el.onclick = () => {
        salonMesaFilter = el.dataset.smf;
        load();
      };
    });

    $('btn-toggle-display').onclick = () => {
      salonMesaDisplayMode = salonMesaDisplayMode === 'tempo' ? 'valor' : 'tempo';
      load();
    };

    const searchInput = $('mesa-search-filter');
    searchInput.oninput = () => {
      salonMesaSearch = searchInput.value;
      const q = salonMesaSearch.trim().toLowerCase();
      document.querySelectorAll('.englobaMesas .cadaMesa').forEach(card => {
        const num = card.dataset.num;
        const t = tables.find(x => x.number === +num);
        const match = !q || num.includes(q) || t?.order?.customerName?.toLowerCase().includes(q) || t?.order?.operatorName?.toLowerCase().includes(q);
        card.style.display = match ? 'flex' : 'none';
      });
    };

    const openByNum = (num) => {
      const t = tables.find(x => x.number === +num);
      if (!t) return toast(`Mesa #${num} não encontrada`);
      if (t.isOpen) {
        openMesaDetalhesModal(t, load);
      } else {
        initialOrderType = 'mesa';
        initialTableId = t.id;
        tab = 'pedido';
        render();
      }
    };

    $('form-quick-mesa').onsubmit = (e) => {
      e.preventDefault();
      const val = $('mesa-quick-del').value;
      if (val) openByNum(val);
    };

    const delKeyHandler = (e) => {
      if (e.key === 'Delete' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const inp = $('mesa-quick-del');
        if (inp) { inp.focus(); inp.select(); }
      }
    };
    window.addEventListener('keydown', delKeyHandler);

    $('btn-mudar-mesa-top').onclick = () => openMudarMesaModal(tables, null, load);
    if ($('btn-balcao-top')) $('btn-balcao-top').onclick = () => { tab = 'balcao'; render(); };
    $('btn-novo-pedido-top').onclick = () => { initialOrderType = 'mesa'; tab = 'pedido'; render(); };

    document.querySelectorAll('.englobaMesas .cadaMesa').forEach(card => {
      const num = +card.dataset.num;
      const t = tables.find(x => x.number === num);
      if (!t) return;

      card.onclick = (e) => {
        if (e.target.closest('.quadro-btn')) return;
        if (t.isOpen) {
          openMesaDetalhesModal(t, load);
        } else {
          initialOrderType = 'mesa';
          initialTableId = t.id;
          tab = 'pedido';
          render();
        }
      };
    });

    document.querySelectorAll('[data-mver]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const t = tables.find(x => x.id === +b.dataset.mver);
        if (t) openMesaDetalhesModal(t, load);
      };
    });

    document.querySelectorAll('[data-mmudar]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        openMudarMesaModal(tables, +b.dataset.mmudar, load);
      };
    });

    document.querySelectorAll('[data-mimp]').forEach(b => {
      b.onclick = safe(async (e) => {
        e.stopPropagation();
        const id = +b.dataset.mimp;
        const r = await api(`/printers/print-order/${id}`, 'POST', { type: 'conta' });
        openThermalPreviewModal(r.jobs, `Conferência Pedido #${id}`);
      });
    });

    document.querySelectorAll('[data-mcli]').forEach(b => {
      b.onclick = safe(async (e) => {
        e.stopPropagation();
        const t = tables.find(x => x.id === +b.dataset.mcli);
        if (!t || !t.order) return;
        const custs = await api('/customers');
        modal(`Vincular Cliente — Mesa #${t.number}`, `
          <p>Selecione um cliente para vincular ao pedido da <b>Mesa #${t.number}</b>:</p>
          <select id="vinc-cli" style="width:100%;margin-bottom:10px">
            <option value="">-- Nenhum / Consumidor Final --</option>
            ${custs.map(c => `<option value="${c.id}" ${t.order.customerName === c.name ? 'selected' : ''}>${esc(c.name)} (${esc(c.phone || 'S/ fone')})</option>`).join('')}
          </select>
        `, async () => {
          const cid = $('vinc-cli').value ? +$('vinc-cli').value : null;
          await api(`/orders/${t.order.id}`, 'PATCH', { customerId: cid });
          toast('Cliente vinculado à mesa!');
          load();
        });
      });
    });
  });

  load();
}

// ---------- Aba de Balcão (Estilo EiChefe terminalBalcao.tpl + vendasBalcao.tpl) ----------
let balcaoFilter = 'abertos'; // 'abertos' | 'prontos' | 'preparo' | 'fechados' | 'todos'
let balcaoSearch = '';
let balcaoViewMode = 'cards'; // 'cards' | 'padrao'

async function viewBalcao() {
  const load = safe(async () => {
    const [orders, tables] = await Promise.all([
      api('/orders'), api('/tables'),
    ]);

    const balcaoOrders = (orders || []).filter(o => o.type === 'balcao');
    const openBalcao = balcaoOrders.filter(o => !o.paid && o.status !== 'cancelado');
    const prontosBalcao = openBalcao.filter(o => o.status === 'pronto');
    const preparoBalcao = openBalcao.filter(o => ['pendente', 'preparo'].includes(o.status));
    const fechadosBalcao = balcaoOrders.filter(o => o.paid || o.status === 'entregue');

    const totalFaturamento = balcaoOrders.filter(o => o.status !== 'cancelado').reduce((s, o) => s + Number(o.totalAmount || 0), 0);
    const totalRecebido = balcaoOrders.reduce((s, o) => s + Number(o.paidAmount || 0), 0);
    const totalPendente = openBalcao.reduce((s, o) => s + Math.max(0, Number(o.totalAmount || 0) - Number(o.paidAmount || 0)), 0);

    const nrMesas = (tables || []).filter(t => t.isOpen).length;
    const nrDeliveries = (orders || []).filter(o => o.type === 'delivery' && !['entregue', 'cancelado'].includes(o.status)).length;

    const q = balcaoSearch.trim().toLowerCase();
    const filteredBalcao = balcaoOrders.filter(o => {
      if (balcaoFilter === 'abertos' && (o.paid || o.status === 'cancelado')) return false;
      if (balcaoFilter === 'prontos' && (o.status !== 'pronto' || o.paid)) return false;
      if (balcaoFilter === 'preparo' && (!['pendente', 'preparo'].includes(o.status) || o.paid)) return false;
      if (balcaoFilter === 'fechados' && (!o.paid && o.status !== 'entregue')) return false;

      if (q) {
        const idMatch = String(o.id).includes(q);
        const custMatch = (o.Customer?.name || '').toLowerCase().includes(q) || (o.Customer?.phone || '').includes(q);
        const notesMatch = (o.notes || '').toLowerCase().includes(q);
        const itemMatch = (o.items || []).some(it => (it.description || it.Product?.name || '').toLowerCase().includes(q) || (it.observations || '').toLowerCase().includes(q));
        if (!idMatch && !custMatch && !notesMatch && !itemMatch) return false;
      }
      return true;
    });

    const renderBalcaoCard = (o) => {
      const total = Number(o.totalAmount || 0);
      const paid = Number(o.paidAmount || 0);
      const rem = Math.max(0, +(total - paid).toFixed(2));
      const isPaid = o.paid || rem <= 0.01;
      const isPronto = o.status === 'pronto';
      const isPreparo = ['pendente', 'preparo'].includes(o.status);
      const elapsed = mins(Date.now() - new Date(o.createdAt));
      const cardClass = isPaid ? 'fechado' : (isPronto ? 'pronto' : '');

      return `
        <div class="cadaBalcaoCard ${cardClass}">
          <div class="card-header">
            <div class="comanda-num">
              <span>🛍️ #${o.id}</span>
              <span class="badge ${o.status}" style="font-size:11px;font-weight:700">${isPaid ? 'Pago' : (STATUS[o.status] || o.status)}</span>
            </div>
            <div class="muted" style="font-size:11.5px;font-weight:600">
              ⏱️ ${elapsed} min atrás
            </div>
          </div>

          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <div class="cliente-nome">${esc(o.Customer?.name || 'Cliente Avulso')}</div>
                ${o.Customer?.phone ? `<div class="cliente-phone">📞 ${esc(o.Customer.phone)}</div>` : ''}
              </div>
              <div style="text-align:right">
                <span class="muted" style="font-size:11px">${new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>

            ${o.notes ? `
              <div class="obs-box">
                📝 ${esc(o.notes)}
              </div>
            ` : ''}

            <div class="itens-box">
              ${(o.items || []).map(i => {
                const pq = Number(i.paidQuantity || 0);
                const tag = pq >= i.quantity ? ' <span class="badge pronto" style="font-size:10px">pago</span>' : pq > 0 ? ` <span class="badge preparo" style="font-size:10px">pago ${pq}/${i.quantity}</span>` : '';
                return `<div><b>${i.quantity}x</b> ${esc(i.description || i.Product?.name || 'Item')}${i.observations ? ` <span style="color:#d03982;font-size:11px">(${esc(i.observations)})</span>` : ''}${tag}</div>`;
              }).join('') || '<span class="muted">Nenhum item lançado</span>'}
            </div>
          </div>

          <div class="card-footer">
            <div>
              <div class="total-val">${brl(total)}</div>
              ${paid > 0 && !isPaid ? `<small style="color:#28a745;font-weight:700">Pago: ${brl(paid)} | Falta: ${brl(rem)}</small>` : ''}
              ${isPaid ? `<small style="color:#28a745;font-weight:700">💰 ${esc(o.paymentMethod || 'Pago')}</small>` : ''}
            </div>
            <div style="text-align:right">
              ${!isPaid ? `
                <button type="button" class="btn sm" data-badd="${o.id}" style="background:#029CC1;color:#fff;font-weight:700;padding:4px 9px;font-size:11.5px" title="Lançar Mais Itens nesta Comanda">➕ Itens</button>
                <button type="button" class="btn ok sm" data-bpay="${o.id}" style="font-weight:700;padding:4px 9px;font-size:11.5px" title="Receber / Faturar Conta">💰 Receber</button>
              ` : `
                <button type="button" class="btn sec sm" data-bpay="${o.id}" style="padding:4px 8px;font-size:11.5px">Ver Pgto</button>
              `}
            </div>
          </div>

          <div class="card-actions">
            ${!isPaid && isPreparo ? `
              <button type="button" class="btn sm" data-bready="${o.id}" style="background:#28a745;color:#fff;font-weight:700;font-size:11px;padding:3px 8px" title="Marcar pedido como pronto para retirada no balcão">✅ Pronto</button>
            ` : ''}

            ${isPronto && !['entregue', 'cancelado'].includes(o.status) ? `
              <button type="button" class="btn sm" data-bdeliver="${o.id}" style="background:#059669;color:#fff;font-weight:700;font-size:11px;padding:3px 8px" title="Marcar como entregue ao cliente">🏁 Entregar</button>
            ` : ''}

            <button type="button" class="btn sec sm" data-bpconta="${o.id}" style="font-size:11px;padding:3px 7px" title="Imprimir Cupom de Conferência">🖨️ Conta</button>
            <button type="button" class="btn sec sm" data-bpcomanda="${o.id}" style="font-size:11px;padding:3px 7px" title="Imprimir Comandas para Cozinha">🍕 Comanda</button>
            <button type="button" class="btn sm" data-bnfe="${o.id}" style="background:#0284c7;color:#fff;font-weight:700;font-size:11px;padding:3px 7px" title="Emitir Cupom Fiscal NFC-e">🧾 NFC-e</button>

            ${!['cancelado', 'entregue'].includes(o.status) ? `
              <button type="button" class="btn sec sm" data-bcancel="${o.id}" style="color:var(--danger);font-size:11px;padding:3px 7px" title="Cancelar Comanda">Cancelar</button>
            ` : ''}
          </div>
        </div>
      `;
    };

    view().innerHTML = `
      <div class="eichefe-balcao-container">
        <!-- Barra de Informações e Atalhos Estilo EiChefe (#englobaBarraInformacao) -->
        <div id="englobaBarraInformacao">
          <div id="englobaOpcoesTipoVenda">
            <div class="cadaTipoVenda" id="balcao-go-mesas" title="Ir para Mesas">
              <div class="tituloCadaTipoVenda">Mesas</div>
              <div class="qtdMesaAberta">${nrMesas}</div>
            </div>
            <div class="cadaTipoVenda tipoVendaAtual" title="Balcão Ativo">
              <div class="tituloCadaTipoVenda">Balcão</div>
              <div class="qtdMesaAberta">${openBalcao.length}</div>
            </div>
            <div class="cadaTipoVenda" id="balcao-go-delivery" title="Ir para Entregas">
              <div class="tituloCadaTipoVenda">Delivery</div>
              <div class="qtdMesaAberta">${nrDeliveries}</div>
            </div>
          </div>

          <div class="eichefe-shortcut-box" id="btn-novo-balcao-top" title="Abrir Nova Venda Balcão (F3)">
            <div>Nova Venda<span class="key-hint">(F3)</span></div>
            <div class="sc-icon">🛍️</div>
          </div>

          <div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap">
            <input id="balcao-search-inp" placeholder="🔍 Buscar comanda, cliente, fone ou item..." value="${esc(balcaoSearch)}" style="width:260px;padding:6px 10px;font-size:13px">
            <select id="select-balcao-view-mode" style="font-weight:700">
              <option value="cards" ${balcaoViewMode === 'cards' ? 'selected' : ''}>Modo Cartões (Grid)</option>
              <option value="padrao" ${balcaoViewMode === 'padrao' ? 'selected' : ''}>Modo Tabela (Lista)</option>
            </select>
          </div>
        </div>

        <!-- Cards de Resumo Métrico -->
        <div class="balcao-summary-cards">
          <div class="balcao-summary-card">
            <span class="label">Comandas Abertas</span>
            <span class="val" style="color:#029CC1">${openBalcao.length} <small style="font-size:12px;font-weight:400;color:#64748b">comandas</small></span>
          </div>
          <div class="balcao-summary-card" style="border-left-color:#f59e0b">
            <span class="label">Em Preparo (Cozinha)</span>
            <span class="val" style="color:#f59e0b">${preparoBalcao.length} <small style="font-size:12px;font-weight:400;color:#64748b">pedidos</small></span>
          </div>
          <div class="balcao-summary-card" style="border-left-color:#28a745">
            <span class="label">Prontas p/ Retirada</span>
            <span class="val" style="color:#28a745">${prontosBalcao.length} <small style="font-size:12px;font-weight:400;color:#64748b">prontos</small></span>
          </div>
          <div class="balcao-summary-card" style="border-left-color:#10b981">
            <span class="label">Faturamento Balcão</span>
            <span class="val" style="color:#10b981">${brl(totalFaturamento)}</span>
          </div>
          <div class="balcao-summary-card" style="border-left-color:#dc3545">
            <span class="label">Saldo em Aberto</span>
            <span class="val" style="color:#dc3545">${brl(totalPendente)}</span>
          </div>
        </div>

        <!-- Filtros Rápidos -->
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:4px">
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <button type="button" class="pill ${balcaoFilter === 'abertos' ? 'on' : ''}" data-bf="abertos">🟡 Em Aberto (${openBalcao.length})</button>
            <button type="button" class="pill ${balcaoFilter === 'prontos' ? 'on' : ''}" data-bf="prontos">✅ Prontas (${prontosBalcao.length})</button>
            <button type="button" class="pill ${balcaoFilter === 'preparo' ? 'on' : ''}" data-bf="preparo">🍳 Em Preparo (${preparoBalcao.length})</button>
            <button type="button" class="pill ${balcaoFilter === 'fechados' ? 'on' : ''}" data-bf="fechados">🟢 Pagas / Concluídas (${fechadosBalcao.length})</button>
            <button type="button" class="pill ${balcaoFilter === 'todos' ? 'on' : ''}" data-bf="todos">Todas (${balcaoOrders.length})</button>
          </div>
          <button type="button" class="btn ok sm" id="btn-nova-comanda-balcao" style="font-weight:700">➕ Nova Comanda Balcão</button>
        </div>

        <!-- Conteúdo: Modo Grid de Cartões ou Tabela -->
        ${balcaoViewMode === 'cards' ? `
          <div class="englobaBalcaoGrid">
            ${filteredBalcao.length ? filteredBalcao.map(renderBalcaoCard).join('') : `
              <div class="card" style="text-align:center;padding:40px 20px;grid-column:1/-1">
                <div style="font-size:42px;margin-bottom:10px">🛍️</div>
                <h3 style="color:#1e293b;margin-bottom:6px">Nenhuma comanda de balcão encontrada</h3>
                <p class="muted" style="margin-bottom:14px">Não há comandas de balcão correspondentes ao filtro atual.</p>
                <button type="button" class="btn ok" id="btn-empty-novo-balcao">➕ Iniciar Nova Venda Balcão (F3)</button>
              </div>
            `}
          </div>
        ` : `
          <div class="card scroll" style="max-height: calc(100vh - 270px)">
            <table>
              <thead>
                <tr>
                  <th style="width:70px">#</th>
                  <th>Cliente</th>
                  <th>Itens Lançados</th>
                  <th style="width:140px">Total / Saldo</th>
                  <th style="width:120px">Status</th>
                  <th style="width:130px">Hora / Tempo</th>
                  <th style="min-width:240px;text-align:right">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${filteredBalcao.length ? filteredBalcao.map(o => {
                  const total = Number(o.totalAmount || 0);
                  const paid = Number(o.paidAmount || 0);
                  const rem = Math.max(0, +(total - paid).toFixed(2));
                  const isPaid = o.paid || rem <= 0.01;
                  const elapsed = mins(Date.now() - new Date(o.createdAt));
                  return `
                    <tr style="${isPaid ? 'background:#f9fff9' : ''}">
                      <td><b>#${o.id}</b></td>
                      <td>
                        <b>${esc(o.Customer?.name || 'Cliente Avulso')}</b>
                        ${o.Customer?.phone ? `<div class="muted" style="font-size:11px">📞 ${esc(o.Customer.phone)}</div>` : ''}
                        ${o.notes ? `<div style="color:#92400e;font-size:11px">📝 ${esc(o.notes)}</div>` : ''}
                      </td>
                      <td>
                        ${(o.items || []).map(i => `${i.quantity}x ${esc(i.description || i.Product?.name || 'Item')}`).join('<br>')}
                      </td>
                      <td>
                        <b style="font-size:14px">${brl(total)}</b>
                        ${paid > 0 && !isPaid ? `<div style="color:#28a745;font-size:11px;font-weight:700">Pago: ${brl(paid)}</div>` : ''}
                        ${rem > 0 && !isPaid ? `<div style="color:#dc3545;font-size:11px;font-weight:700">Falta: ${brl(rem)}</div>` : ''}
                      </td>
                      <td>
                        <span class="badge ${o.status}">${isPaid ? 'Pago' : (STATUS[o.status] || o.status)}</span>
                        ${isPaid ? `<div><small style="color:#28a745;font-weight:700">💰 ${esc(o.paymentMethod || 'Pago')}</small></div>` : ''}
                      </td>
                      <td>
                        <div>${new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                        <small class="muted">${elapsed} min atrás</small>
                      </td>
                      <td style="text-align:right">
                        <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
                          ${!isPaid ? `
                            <button type="button" class="btn sm" data-badd="${o.id}" style="background:#029CC1;color:#fff;font-weight:700" title="Lançar Mais Itens">➕ Itens</button>
                            <button type="button" class="btn ok sm" data-bpay="${o.id}">💰 Receber</button>
                          ` : `
                            <button type="button" class="btn sec sm" data-bpay="${o.id}">Ver Pgto</button>
                          `}
                          <button type="button" class="btn sec sm" data-bpconta="${o.id}" title="Imprimir Cupom de Conta">🖨️ Conta</button>
                          <button type="button" class="btn sec sm" data-bpcomanda="${o.id}" title="Imprimir Comanda Cozinha">🍕 Comanda</button>
                          <button type="button" class="btn sm" data-bnfe="${o.id}" style="background:#0284c7;color:#fff;font-weight:700" title="Emitir Cupom Fiscal NFC-e">🧾 NFC-e</button>
                          ${!['cancelado', 'entregue'].includes(o.status) ? `
                            <button type="button" class="btn sec sm" data-bcancel="${o.id}" style="color:var(--danger)">Cancelar</button>
                          ` : ''}
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('') : `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">Nenhuma comanda de balcão encontrada</td></tr>`}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;

    // Listeners
    $('balcao-go-mesas').onclick = () => { tab = 'mesas'; render(); };
    $('balcao-go-delivery').onclick = () => { tab = 'delivery'; render(); };

    const goNovoBalcao = () => {
      initialOrderType = 'balcao';
      tab = 'pedido';
      render();
    };
    const btnTopNovo = $('btn-novo-balcao-top');
    if (btnTopNovo) btnTopNovo.onclick = goNovoBalcao;
    const btnMidNovo = $('btn-nova-comanda-balcao');
    if (btnMidNovo) btnMidNovo.onclick = goNovoBalcao;
    const btnEmptyNovo = $('btn-empty-novo-balcao');
    if (btnEmptyNovo) btnEmptyNovo.onclick = goNovoBalcao;

    const searchInp = $('balcao-search-inp');
    if (searchInp) {
      searchInp.oninput = () => {
        balcaoSearch = searchInp.value;
        load();
      };
    }

    const selViewMode = $('select-balcao-view-mode');
    if (selViewMode) {
      selViewMode.onchange = () => {
        balcaoViewMode = selViewMode.value;
        load();
      };
    }

    document.querySelectorAll('[data-bf]').forEach(el => {
      el.onclick = () => {
        balcaoFilter = el.dataset.bf;
        load();
      };
    });

    // Ações das Comandas
    document.querySelectorAll('[data-badd]').forEach(b => b.onclick = () => {
      const id = +b.dataset.badd;
      initialOrderId = id;
      initialOrderType = 'balcao';
      tab = 'pedido';
      render();
    });

    document.querySelectorAll('[data-bpay]').forEach(b => b.onclick = () => {
      openPaymentModal(+b.dataset.bpay, load);
    });

    document.querySelectorAll('[data-bready]').forEach(b => b.onclick = safe(async () => {
      const id = +b.dataset.bready;
      await api(`/orders/${id}/status`, 'PATCH', { status: 'pronto' });
      toast(`Comanda #${id} marcada como PRONTA para retirada!`);
      load();
    }));

    document.querySelectorAll('[data-bdeliver]').forEach(b => b.onclick = safe(async () => {
      const id = +b.dataset.bdeliver;
      await api(`/orders/${id}/delivered`, 'POST');
      toast(`Comanda #${id} entregue ao cliente com sucesso!`);
      load();
    }));

    document.querySelectorAll('[data-bpconta]').forEach(b => b.onclick = safe(async () => {
      const id = +b.dataset.bpconta;
      const r = await api(`/printers/print-order/${id}`, 'POST', { type: 'conta' });
      openThermalPreviewModal(r.jobs, `Conferência Balcão — Pedido #${id}`);
    }));

    document.querySelectorAll('[data-bpcomanda]').forEach(b => b.onclick = safe(async () => {
      const id = +b.dataset.bpcomanda;
      const r = await api(`/printers/print-order/${id}`, 'POST', { type: 'comanda', reprint: true });
      openThermalPreviewModal(r.jobs, `Comandas Cozinha — Pedido #${id}`);
    }));

    document.querySelectorAll('[data-bnfe]').forEach(b => b.onclick = () => {
      openNfeModal(+b.dataset.bnfe, load);
    });

    document.querySelectorAll('[data-bcancel]').forEach(b => b.onclick = safe(async () => {
      const id = +b.dataset.bcancel;
      if (confirm(`Tem certeza que deseja CANCELAR a comanda de balcão #${id}? O estoque dos produtos será estornado.`)) {
        await api(`/orders/${id}/status`, 'PATCH', { status: 'cancelado' });
        toast(`Comanda #${id} cancelada com sucesso.`);
        load();
      }
    }));
  });

  await load();
  timer = setInterval(load, 8000);
}

// ---------- Aba de Delivery Idêntica ao Terminal Gerente de Entregas do EiChefe (cabecalho.tpl + entregasKanban.tpl + entregasNovo.tpl) ----------
let deliveryViewMode = 'kanban'; // 'kanban' | 'padrao'
let deliverySearchFilter = '';

async function viewDelivery() {
  const load = safe(async () => {
    const [orders, tables, couriers] = await Promise.all([
      api('/orders'), api('/tables'), api('/config/couriers'),
    ]);
    const activeOrders = orders.filter(o => !['entregue', 'cancelado'].includes(o.status));
    const nrMesas = tables.filter(t => t.isOpen).length;
    const nrBalcao = activeOrders.filter(o => o.type === 'balcao').length;
    const allDeliveries = orders.filter(o => o.type === 'delivery' && o.status !== 'cancelado');
    const activeDeliveries = allDeliveries.filter(o => o.status !== 'entregue');

    const q = deliverySearchFilter.trim().toLowerCase();
    const filteredDeliveries = activeDeliveries.filter(o => {
      if (!q) return true;
      const name = (o.Customer?.name || '').toLowerCase();
      const phone = (o.Customer?.phone || '').toLowerCase();
      const bairro = (o.Neighborhood?.name || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || bairro.includes(q) || String(o.id) === q;
    });

    const emPreparo = filteredDeliveries.filter(o => ['pendente', 'preparo'].includes(o.status));
    const despachoRetirada = filteredDeliveries.filter(o => o.status === 'pronto');
    const emEntrega = filteredDeliveries.filter(o => o.status === 'saiu');

    // Renderiza cada cartão .cadaDisk idêntico ao entregasNovo.tpl do EiChefe
    const renderDiskCard = (o) => {
      const custName = (o.Customer?.name || 'CLIENTE DISK').slice(0, 18);
      const bairroName = (o.Neighborhood?.name || o.Customer?.neighborhood || 'Centro').slice(0, 18);
      const phone = o.Customer?.phone || '(44) ----';
      const total = Number(o.totalAmount || 0);
      const changeFor = Number(o.changeFor || 0);
      const troco = changeFor > total ? changeFor - total : 0;
      const isPronto = o.status === 'pronto';
      const isSaiu = o.status === 'saiu' || Boolean(o.CourierId);
      const tipoLabel = o.Courier?.name ? `🛵 ${o.Courier.name}` : 'DISK-ENTREGA';

      return `
        <div class="cadaDisk cadaDiskEntrega ${isSaiu ? 'cadaDiskEntregador' : ''}">
          <div class="bordaDisk ${isSaiu ? 'entregador' : ''} ${isPronto && !isSaiu ? 'pedido-pronto' : ''}">
            <div class="englobaTelNome2" data-dopen="${o.id}" title="Clique para ver itens / receber pedido #${o.id}">
              <div class="englobaNome">
                <span title="${esc(o.Customer?.name || '')}">${esc(custName)}</span>
                <div class="bairro-sub" title="${esc(bairroName)}">${esc(bairroName)}</div>
              </div>
              <div class="englobaTelefone">
                ${esc(phone)}
                <div class="englobaNumeroDisk">${o.id}</div>
              </div>
            </div>
            <div class="linhaSepara"></div>
            <div class="englobaBotoesEntrega">
              <div class="botaoTempo" data-dtempo="${o.id}" title="Horários do Pedido (#${o.id})"></div>
              <div class="botaoCliente" data-dcli="${o.id}" title="Dados do Cliente e Endereço (#${o.id})"></div>
              <div class="botaoEntrega" data-dentrega="${o.id}" title="Selecionar Entregador / Despachar Pedido (#${o.id})"></div>
              <div class="botaoImprimir" data-dimp="${o.id}" title="Imprimir Cupom de Entrega / Comanda (#${o.id})"></div>
              <div class="botaoPagar ${o.paid ? 'inativo' : ''}" data-dpagar="${o.id}" title="Receber / Dividir Pagamento (#${o.id})"></div>
              <div class="botaoFechar" data-dfechar="${o.id}" title="Finalizar Entrega / Baixar Pedido (#${o.id})"></div>
            </div>
            <div class="linhaSepara"></div>
            <div class="englobaTipoDelivery">
              <div class="tipo-delivery" title="${esc(tipoLabel)}">${esc(tipoLabel)}</div>
            </div>
            <div class="linhaSepara"></div>
            <div class="englobaValores">
              <div class="valor" title="Valor Devido">${brl(total)}</div>
              <div class="troco" data-dtroco="${o.id}" title="Valor Troco (clique p/ alterar Troco Para)">${troco > 0 ? brl(troco) : 'R$ 0,00'}</div>
            </div>
          </div>
        </div>
      `;
    };

    view().innerHTML = `
      <!-- Barra Superior Idêntica ao cabecalho.tpl (#englobaBarraInformacao) -->
      <div id="englobaBarraInformacao">
        <div id="englobaOpcoesTipoVenda">
          <div class="cadaTipoVenda" id="top-go-mesas" title="Ir para Mesas">
            <div class="tituloCadaTipoVenda">Mesas</div>
            <div class="qtdMesaAberta">${nrMesas}</div>
          </div>
          <div class="cadaTipoVenda" id="top-go-balcao" title="Ir para Balcão">
            <div class="tituloCadaTipoVenda">Balcão</div>
            <div class="qtdMesaAberta">${nrBalcao}</div>
          </div>
          <div class="cadaTipoVenda tipoVendaAtual" title="Pedidos de Delivery Ativos">
            <div class="tituloCadaTipoVenda">Pedidos</div>
            <div class="qtdMesaAberta">${activeDeliveries.length}</div>
          </div>
        </div>

        <div class="eichefe-shortcut-box" id="sc-balcao" title="Iniciar Venda Balcão (F3)">
          <div>Balcão<span class="key-hint">(F3)</span></div>
          <div class="sc-icon">🛍️</div>
        </div>

        <div class="eichefe-shortcut-box" id="sc-entrega" title="Iniciar Venda Disk Entrega (F4)">
          <div>Entrega<span class="key-hint">(F4)</span></div>
          <div class="sc-icon">🛵</div>
        </div>

        <div class="eichefe-shortcut-box" id="sc-prontos" title="Marcar Pedidos em Preparo como Prontos">
          <div>Prontos</div>
          <div class="sc-icon">✅</div>
        </div>

        <div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap">
          <input id="dlv-search" placeholder="🔍 Filtrar cliente, fone, bairro ou nº..." value="${esc(deliverySearchFilter)}" style="width:240px">
          <select id="selectModoVisualizacaoPedidos" style="font-weight:700">
            <option value="kanban" ${deliveryViewMode === 'kanban' ? 'selected' : ''}>Modo Kanban de pedidos</option>
            <option value="padrao" ${deliveryViewMode === 'padrao' ? 'selected' : ''}>Modo padrão de pedidos</option>
          </select>
        </div>
      </div>

      ${deliveryViewMode === 'kanban' ? `
        <!-- Layout Kanban de 3 Colunas Idêntico ao entregasKanban.tpl -->
        <div id="englobaEntregasKanban">
          <div class="kanban-col-eichefe">
            <div class="kanban-titulo-eichefe">
              <span class="t-label">Em Preparo</span>
              <span class="t-badge preparo">${emPreparo.length}</span>
            </div>
            <div class="englobaCadaMesaGrid">
              ${emPreparo.map(renderDiskCard).join('') || '<p class="muted">Nenhuma entrega em preparo</p>'}
            </div>
          </div>

          <div class="kanban-col-eichefe">
            <div class="kanban-titulo-eichefe">
              <span class="t-label">Despacho/Retirada</span>
              <span class="t-badge delivery">${despachoRetirada.length}</span>
            </div>
            <div class="englobaCadaMesaGrid">
              ${despachoRetirada.map(renderDiskCard).join('') || '<p class="muted">Nenhuma entrega aguardando despacho</p>'}
            </div>
          </div>

          <div class="kanban-col-eichefe">
            <div class="kanban-titulo-eichefe">
              <span class="t-label">Em Entrega</span>
              <span class="t-badge delivery">${emEntrega.length}</span>
            </div>
            <div class="englobaCadaMesaGrid">
              ${emEntrega.map(renderDiskCard).join('') || '<p class="muted">Nenhuma entrega em rota</p>'}
            </div>
          </div>
        </div>
      ` : `
        <!-- Modo Padrão de Pedidos (percorreEntregas.tpl) -->
        <div class="card">
          <div id="englobaCadaMesa">
            ${filteredDeliveries.map(renderDiskCard).join('') || '<p class="muted">Nenhuma entrega ativa no momento. Clique em "Entrega (F4)" acima para lançar um novo Disk-Entrega.</p>'}
          </div>
        </div>
      `}
    `;

    // Eventos da barra superior
    $('top-go-mesas').onclick = () => { tab = 'mesas'; render(); };
    $('top-go-balcao').onclick = () => { tab = 'balcao'; render(); };
    $('sc-balcao').onclick = () => { tab = 'balcao'; render(); };
    $('sc-entrega').onclick = () => { initialOrderType = 'delivery'; tab = 'pedido'; render(); };
    $('sc-prontos').onclick = safe(async () => {
      if (!emPreparo.length) return toast('Nenhum pedido em preparo no momento');
      for (const o of emPreparo) {
        await api(`/orders/${o.id}/status`, 'PATCH', { status: 'pronto' });
      }
      toast(`${emPreparo.length} pedido(s) movido(s) para Despacho/Retirada!`);
      load();
    });

    $('dlv-search').oninput = debounce(() => {
      deliverySearchFilter = $('dlv-search').value;
      load();
    }, 200);
    $('selectModoVisualizacaoPedidos').onchange = e => {
      deliveryViewMode = e.target.value;
      load();
    };

    // 1) Clicar no topo do cartão (.englobaTelNome2) abre os itens e pagamento do pedido
    document.querySelectorAll('[data-dopen]').forEach(el => el.onclick = () => {
      openPaymentModal(+el.dataset.dopen, load);
    });

    // 2) Botão Tempo (.botaoTempo -> abrirJanelaTempo)
    document.querySelectorAll('[data-dtempo]').forEach(el => el.onclick = () => {
      const o = allDeliveries.find(x => x.id === +el.dataset.dtempo);
      if (!o) return;
      const elapsed = mins(Date.now() - new Date(o.createdAt));
      modal(`Horários da Entrega #${o.id}`, `
        <table>
          <tr><th>Hora do Pedido</th><td>${new Date(o.createdAt).toLocaleString('pt-BR')}</td></tr>
          <tr><th>Tempo Decorrido</th><td><b>${elapsed} min</b></td></tr>
          <tr><th>Status Atual</th><td><span class="badge ${o.status}">${STATUS[o.status]}</span></td></tr>
          <tr><th>Saída p/ Entrega</th><td>${o.departedAt ? new Date(o.departedAt).toLocaleTimeString('pt-BR') : 'Ainda não saiu'}</td></tr>
          <tr><th>Entregador</th><td>${esc(o.Courier?.name || 'Não definido')}</td></tr>
        </table>
      `, () => {}, 'Fechar');
    });

    // 3) Botão Cliente (.botaoCliente -> dadosCliente.tpl)
    document.querySelectorAll('[data-dcli]').forEach(el => el.onclick = () => {
      const o = allDeliveries.find(x => x.id === +el.dataset.dcli);
      if (!o) return;
      modal(`Dados do Cliente — Entrega #${o.id}`, `
        <table>
          <tr><th>Nome</th><td><b>${esc(o.Customer?.name || 'Não informado')}</b></td></tr>
          <tr><th>Telefone</th><td><b>${esc(o.Customer?.phone || '-')}</b></td></tr>
          <tr><th>Logradouro / Endereço</th><td>${esc(o.address || o.Customer?.address || '-')}</td></tr>
          <tr><th>Bairro</th><td>${esc(o.Neighborhood?.name || o.Customer?.neighborhood || '-')}</td></tr>
          <tr><th>Taxa de Entrega</th><td>${brl(o.deliveryFee)}</td></tr>
          <tr><th>Cidade/Estado</th><td>Floresta/PR</td></tr>
          <tr><th>Itens do Pedido</th><td>${o.items.map(i => `${i.quantity}x ${esc(i.description)}`).join('<br>')}</td></tr>
        </table>
      `, () => {}, 'Fechar');
    });

    // 4) Botão Entrega (.botaoEntrega -> abrirJanelaEntregador / marcar pronto)
    document.querySelectorAll('[data-dentrega]').forEach(el => el.onclick = () => {
      const o = allDeliveries.find(x => x.id === +el.dataset.dentrega);
      if (!o) return;
      if (!couriers.length) return toast('Cadastre entregadores na aba Cadastros');
      modal(`Despachar Entrega #${o.id} — Selecionar Entregador`, `
        <p>Cliente: <b>${esc(o.Customer?.name || '')}</b> (${esc(o.address || '')})</p>
        <div class="row">
          <label><b>Entregador (Motoboy):</b></label>
          <select id="modal-courier-sel" style="flex:1">
            ${couriers.map(c => `<option value="${c.id}" ${o.CourierId === c.id ? 'selected' : ''}>${esc(c.name)} ${c.phone ? `(${esc(c.phone)})` : ''}</option>`).join('')}
          </select>
        </div>
        ${o.status !== 'pronto' && o.status !== 'saiu' ? `<p class="muted">Ou <button type="button" class="btn sec sm" id="btn-only-ready">Apenas marcar como Pronto (Despacho)</button></p>` : ''}
      `, async (ov) => {
        const cid = +ov.querySelector('#modal-courier-sel').value;
        await api(`/orders/${o.id}/dispatch`, 'POST', { courierId: cid });
        toast(`Entrega #${o.id} despachada para Entrega!`);
        load();
      }, '🛵 Despachar Entrega');

      const btnReady = document.getElementById('btn-only-ready');
      if (btnReady) {
        btnReady.onclick = safe(async () => {
          await api(`/orders/${o.id}/status`, 'PATCH', { status: 'pronto' });
          document.querySelector('.overlay')?.remove();
          toast(`Pedido #${o.id} movido para Despacho/Retirada!`);
          load();
        });
      }
    });

    // 5) Botão Imprimir (.botaoImprimir -> imprimirVendaJs)
    document.querySelectorAll('[data-dimp]').forEach(el => el.onclick = safe(async () => {
      const id = +el.dataset.dimp;
      const r = await api(`/printers/print-order/${id}`, 'POST', { type: 'conta' });
      openThermalPreviewModal(r.jobs, `Cupom Disk-Entrega — Pedido #${id}`);
    }));

    // 6) Botão Pagar (.botaoPagar -> abrirTelaPagamentoTerminalGerente)
    document.querySelectorAll('[data-dpagar]').forEach(el => el.onclick = () => {
      openPaymentModal(+el.dataset.dpagar, load);
    });

    // 7) Botão Fechar (.botaoFechar -> terminalGerente.fecharDisk)
    document.querySelectorAll('[data-dfechar]').forEach(el => el.onclick = () => {
      const o = allDeliveries.find(x => x.id === +el.dataset.dfechar);
      if (!o) return;
      modal(`Finalizar Disk-Entrega #${o.id}`, `
        <p>Deseja concluir e fechar a entrega <b>#${o.id}</b> de <b>${esc(o.Customer?.name || 'Cliente')}</b> (${brl(o.totalAmount)})?</p>
        <div class="row" style="margin-top:10px">
          <button type="button" class="btn danger sm" id="btn-cancel-disk">Cancelar Pedido</button>
        </div>
      `, async () => {
        await api(`/orders/${o.id}/delivered`, 'POST');
        toast(`Entrega #${o.id} finalizada com sucesso!`);
        load();
      }, '✅ Concluir Entrega');

      const btnCancel = document.getElementById('btn-cancel-disk');
      if (btnCancel) {
        btnCancel.onclick = safe(async () => {
          if (confirm(`Tem certeza que deseja CANCELAR a entrega #${o.id}?`)) {
            await api(`/orders/${o.id}/status`, 'PATCH', { status: 'cancelado' });
            document.querySelector('.overlay')?.remove();
            toast(`Entrega #${o.id} cancelada`);
            load();
          }
        });
      }
    });

    // 8) Clicar no Troco (.troco -> abrirJanelaTroco)
    document.querySelectorAll('[data-dtroco]').forEach(el => el.onclick = () => {
      const o = allDeliveries.find(x => x.id === +el.dataset.dtroco);
      if (!o) return;
      modal(`Alterar Troco — Entrega #${o.id}`, `
        <p>Valor Total do Pedido: <b>${brl(o.totalAmount)}</b></p>
        <div class="row">
          <label><b>Troco para (R$):</b></label>
          <input id="inp-new-troco" type="number" step="0.01" value="${esc(o.changeFor || '')}" placeholder="Ex: 100.00">
        </div>
      `, async (ov) => {
        const val = ov.querySelector('#inp-new-troco').value;
        await api(`/orders/${o.id}/troco`, 'PATCH', { changeFor: val });
        toast('Valor de troco atualizado!');
        load();
      }, 'Salvar Troco');
    });
  });

  await load();
  timer = setInterval(load, 8000);
}

// ---------- Fechamento e Divisao de Conta (EiChefe: fechaVenda/pagar.tpl + valoresVenda.tpl + valoresPagos.tpl) ----------
async function openPaymentModal(orderId, onRefresh) {
  const [orderInit, methods] = await Promise.all([api(`/orders/${orderId}`), api('/config/payment-methods')]);
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  document.body.appendChild(overlay);

  const close = () => {
    window.removeEventListener('keydown', handleGlobalKey);
    overlay.remove();
    // Limpa quaisquer outros overlays para a tela retornar limpa
    document.querySelectorAll('.overlay').forEach(el => el.remove());
    if (typeof onRefresh === 'function') {
      try {
        const res = onRefresh();
        if (res && typeof res.catch === 'function') {
          res.catch(() => render());
        }
      } catch (_) {
        render();
      }
    } else {
      render();
    }
  };
  overlay.onclick = e => { if (e.target === overlay) close(); };

  let o = orderInit;
  let splitCount = Math.max(1, Number(o.splitCount || 1));
  let payerName = o.Customer?.name || '';
  // Mapa item.id -> quantidade selecionada para pagar agora (0 = nao selecionado)
  const selectedQty = {};
  const selectedCustomAmounts = {};

  const availOf = it => Math.max(0, +(Number(it.quantity) - Number(it.paidQuantity || 0)).toFixed(4));
  const selectedTotal = () => (o.items || []).reduce((sum, it) => {
    if (selectedCustomAmounts[it.id] !== undefined && Number(selectedQty[it.id] || 0) > 0) {
      return sum + Number(selectedCustomAmounts[it.id]);
    }
    const q = Number(selectedQty[it.id] || 0);
    return sum + q * Number(it.unitPrice);
  }, 0);

  // Formas de pagamento estaticas espelhando fechaVenda/pagar.tpl
  const tilesConfig = [
    { key: 'dinheiro', label: 'DINHEIRO', iconClass: 'dinheiro', method: 'Dinheiro', hasPct: true },
    { key: 'cheque', label: 'CHEQUE', iconClass: 'cheque', method: 'Cheque', hasPct: true },
    { key: 'credito', label: 'CRÉDITO', iconClass: 'credito', method: 'Cartão de Crédito', hasPct: true },
    { key: 'debito', label: 'DÉBITO', iconClass: 'debito', method: 'Cartão de Débito', hasPct: true },
    { key: 'sodexo', label: 'REFEIÇÃO', iconClass: 'sodexo', method: 'Vale Alimentação', hasPct: true },
    { key: 'pix', label: 'PIX', iconClass: 'pix', method: 'PIX', hasPct: true },
    { key: 'online', label: 'ONLINE', iconClass: 'online', method: 'On-Line', hasPct: true },
    { key: 'brinde', label: 'BRINDE', iconClass: 'brinde', method: 'Brinde', hasPct: true },
    { key: 'desconto', label: 'DESCONTO', iconClass: 'troco', method: 'Desconto', hasPct: true },
    { key: 'assinadas', label: 'NOTAS ASSIN.', iconClass: 'assinadas', method: 'Notas Assinadas', hasPct: false },
  ];

  // Armazena valores digitados em cada forma de pagamento
  const tileVals = {};
  const tilePcts = {};

  const parseNum = (v) => {
    if (!v) return 0;
    const s = String(v).replace(/[^\d.,]/g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const handleGlobalKey = (e) => {
    if (document.querySelector('.modalConfirmarFechamentoOverlay')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      const activeEl = document.activeElement;
      // Se estiver digitando no campo de divisao ou cliente, confirma o campo em vez de faturar
      if (activeEl && (activeEl.id === 'numeroDividirConta' || activeEl.id === 'nomeCliente' || activeEl.id === 'cpfNota')) {
        activeEl.blur();
        return;
      }
      if (overlay.contains(activeEl)) {
        e.preventDefault();
        const faturarBtn = overlay.querySelector('#faturar');
        if (faturarBtn) faturarBtn.click();
      }
    } else if (e.key === 'F6') {
      e.preventDefault();
      const pConta = overlay.querySelector('#btn-print-conta');
      if (pConta) pConta.click();
    } else if (e.key === 'F8') {
      e.preventDefault();
      const pCom = overlay.querySelector('#btn-print-comanda');
      if (pCom) pCom.click();
    } else if (e.key === 'F9') {
      e.preventDefault();
      const faturarNfeBtn = overlay.querySelector('#faturar-nfe');
      if (faturarNfeBtn) faturarNfeBtn.click();
    }
  };
  window.addEventListener('keydown', handleGlobalKey);

  const drawModal = () => {
    const total = Number(o.totalAmount || 0);
    const paid = Number(o.paidAmount || 0);
    const remaining = Math.max(0, +(total - paid).toFixed(2));
    const selSum = +selectedTotal().toFixed(2);
    const hasSel = selSum > 0;
    const baseTarget = hasSel ? selSum : remaining;

    // Divisao automatica em partes / cotas (quantas foram pagas e quantas faltam)
    const cotaBase = splitCount > 0 ? +(total / splitCount).toFixed(2) : total;
    let partesPagas = 0;
    if (paid > 0 && cotaBase > 0) {
      if (remaining <= 0.01) {
        partesPagas = splitCount;
      } else {
        partesPagas = Math.min(splitCount - 1, Math.floor((paid + 0.05) / cotaBase));
      }
    }
    const partesRestantes = Math.max(0, splitCount - partesPagas);
    const nextCota = partesRestantes === 1 ? remaining : (partesRestantes > 0 ? Math.min(remaining, cotaBase) : 0);

    // Monta os botoes/pilulas visuais de cada parte
    let pillsHtml = '';
    for (let i = 1; i <= splitCount; i++) {
      const cotaVal = (i === splitCount && partesRestantes === 1) ? remaining : cotaBase;
      if (i <= partesPagas) {
        pillsHtml += `<span class="pillParte paga" title="Pessoa ${i} ja pagou sua parte de ${brl(cotaBase)}">✓ Pessoa ${i} (Paga)</span>`;
      } else if (i === partesPagas + 1) {
        pillsHtml += `<button type="button" class="pillParte proxima" data-cota="${i}" data-val="${nextCota}" title="Clique para cobrar a parte da Pessoa ${i} (${brl(nextCota)})">👉 Pagar Pessoa ${i} (${brl(nextCota)})</button>`;
      } else {
        pillsHtml += `<span class="pillParte pendente" title="Pessoa ${i} pendente (${brl(cotaVal)})">Pessoa ${i} (${brl(cotaVal)})</span>`;
      }
    }

    const titleLocal = o.Table ? `Mesa ${o.Table.number}` : (o.Customer?.name || TYPE[o.type] || `Pedido #${o.id}`);

    overlay.innerHTML = `<div id="pagamentoCor">
      <div class="englobaTitulos">
        <div class="tituloPagamento">
          PAGAMENTOS <span class="subInfo">— ${esc(titleLocal)} (#${o.id})</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn sec sm" id="btn-print-conta" title="Atalho F6 no EiChefe" style="font-size:12px;padding:3px 8px">🖨️ (F6) Conferência</button>
          <button class="btn sec sm" id="btn-print-comanda" title="Imprimir comandas (F8)" style="font-size:12px;padding:3px 8px">🍕 (F8) Comandas</button>
          <div id="fecharTela" class="fechar">(ESC) FECHAR PAGAMENTO</div>
        </div>
      </div>

      <!-- Fileira de Formas de Pagamento (EiChefe .cadaFormaPagamento) -->
      <div id="englobaFormaPagamentoFechaVenda">
        ${tilesConfig.map(t => `
          <div class="cadaFormaPagamento ${tileVals[t.key] > 0 ? 'formaSeleciona' : ''}" data-tile="${t.key}">
            <div class="iconeFormaPagamento" data-fill="${t.key}" title="Clique para preencher saldo restante">
              <div class="${t.iconClass}"></div>
            </div>
            <div class="nomeFormaPagamento" title="${t.label}">${t.label}</div>
            <input type="text" class="valorPagamento" data-val="${t.key}" placeholder="R$ 0,00" value="${tileVals[t.key] !== undefined && tileVals[t.key] !== '' ? (typeof tileVals[t.key] === 'number' ? tileVals[t.key].toFixed(2).replace('.', ',') : tileVals[t.key]) : ''}">
            ${t.hasPct ? `<input type="text" class="valorPagamento percentual" data-pct="${t.key}" placeholder="0 %" value="${tilePcts[t.key] || ''}">` : ''}
          </div>
        `).join('')}

        <!-- Card Cliente Opcional -->
        <div class="cadaFormaPagamento" style="width:84px">
          <div class="iconeFormaPagamento" title="Identificar cliente / pagador">
            <div class="clienteOpcional"></div>
          </div>
          <div class="nomeFormaPagamento">CLIENTE</div>
          <input type="text" class="valorPagamento" id="nomeCliente" placeholder="Nome" value="${esc(payerName)}" style="width:72px;font-size:11px">
        </div>

        <!-- Card CPF na Nota (NFC-e Automática) -->
        <div class="cadaFormaPagamento" style="width:110px;background:#f0f9ff;border-color:#bae6fd">
          <div class="iconeFormaPagamento" title="CPF/CNPJ na Nota Fiscal" style="font-size:18px;line-height:28px">
            🧾
          </div>
          <div class="nomeFormaPagamento" style="color:#0369a1;font-weight:700">CPF NA NOTA</div>
          <input type="text" class="valorPagamento" id="cpfNota" placeholder="Opcional" value="${esc(o.customerCpf || '')}" style="width:96px;font-size:10px;text-align:center">
        </div>
      </div>

      <!-- Bloco de Informações e Botão de Faturar -->
      <div class="englobaInfoEAction">
        <div id="infoPagamento">
          <div id="infoEsquerda">
            <div id="quadradoDividir">
              <div class="dividirHeaderRow">
                <div id="quadroDividirTitulo">Qt Pessoas a Dividir:</div>
                <div class="stepperWrapper">
                  <button type="button" class="spBtn" id="sp-dec" title="Diminuir pessoas">−</button>
                  <input type="text" id="numeroDividirConta" class="numeroDividir" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${splitCount}">
                  <button type="button" class="spBtn" id="sp-inc" title="Aumentar pessoas">+</button>
                </div>
                ${partesRestantes > 0 ? `
                  <button type="button" class="btnCotaRapida" id="btn-cota-auto" title="Preencher o valor da próxima cota (${brl(nextCota)})">
                    ⚡ Pagar Cota (${brl(nextCota)})
                  </button>
                ` : ''}
              </div>

              <div class="blocoProgressoPartes">
                <div class="statusPartesTexto">
                  <span class="badgePartesPagas">
                    📊 <b>${partesPagas} de ${splitCount}</b> parte(s) paga(s)
                  </span>
                  <span class="badgePartesFaltam ${partesRestantes === 0 ? 'quitado' : ''}">
                    ${partesRestantes === 0 ? '✅ Conta 100% quitada!' : `Faltam: <b>${partesRestantes}</b> (${brl(remaining)})`}
                  </span>
                </div>
                <div class="pillsPartes">
                  ${pillsHtml}
                </div>
              </div>

              <div class="blocoDividirContaTotal">
                <div class="totalPagamento">Valor Total: <span id="infoValorTotal">${brl(total)}</span></div>
                <div class="totalPagamento">Total Pago: <strong id="infoTotalPago">${brl(paid)}</strong></div>
              </div>
            </div>

            <div class="blocoImprimirDivisao">
              <div class="totalPagamento">Imprimir Divisão <div id="imprimirPagamento" title="Imprimir Divisão / Conferência"></div></div>
            </div>

            ${!o.paid ? `
              <div style="margin-top:8px">
                <button type="button" class="btn sm" id="btn-modal-add-items" style="background:#029CC1;color:#fff;font-weight:700;width:100%;padding:6px 10px;font-size:12px;border:none;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px" title="Lançar Mais Itens nesta Comanda / Mesa">
                  ➕ Lançar Mais Itens
                </button>
              </div>
            ` : ''}
          </div>

          <div id="infoDireita">
            <div class="box-cell box1" id="box-por-pessoa" title="Clique para aplicar 1 cota (${brl(nextCota)}) no pagamento">
              <div id="porPessoaTitulo">POR PESSOA</div>
              <div id="valorPorPessoa">${brl(cotaBase)}</div>
              <div style="font-size:10px;color:#0d6efd;font-weight:bold;margin-top:2px;cursor:pointer">
                ${splitCount > 1 ? `⚡ Aplicar Cota (${brl(nextCota)})` : '⚡ Aplicar Total'}
              </div>
            </div>
            <div class="box-cell box1">
              <div id="devidoTitulo">DEVIDO</div>
              <div id="valorDevido" class="valorDevidoTempoReal">${brl(baseTarget)}</div>
            </div>
            <div class="box-cell box1">
              <div id="devidoTitulo" class="valorTrocoPessoa" style="color: #4e9801;">TROCO</div>
              <div id="valorTroco" class="valorTrocoTempoReal" style="color: #4e9801;">R$ 0,00</div>
            </div>
          </div>
        </div>

        <div id="englobaInfoPagamentos" style="display:flex;gap:10px;align-items:stretch">
          <div class="cadaQuadroAcoes concluir" id="faturar" title="Concluir e Faturar Pagamento (ENTER)" style="flex:1">
            <div id="baixarIcone" class="faturar"></div>
            <div class="tituloQuadroAcao">FATURAR<br/><strong>(ENTER)</strong></div>
          </div>
          <div class="cadaQuadroAcoes" id="faturar-nfe" style="flex:1;background:#0284c7;color:#fff;cursor:pointer;border-radius:6px;padding:8px 6px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.15)" title="Faturar e Emitir Cupom Fiscal NFC-e (F9)">
            <div style="font-size:20px;line-height:1">🧾</div>
            <div class="tituloQuadroAcao" style="color:#fff;font-weight:700;font-size:12px;margin-top:2px">FATURAR + NFC-e<br/><strong>(F9)</strong></div>
          </div>
        </div>
      </div>

      <!-- Acordeão para Baixa / Seleção de Itens Específicos (EiChefe totalBaixarItens / botoesPagarListaProdutos) -->
      ${(() => {
        const hasSplitItem = (o.items || []).some(it => it.splitInfo);
        const isOpen = hasSel || hasSplitItem;
        return `
      <details class="pagamentoItensArea" ${isOpen ? 'open' : ''}>
        <summary>📦 Selecionar ou Dividir itens específicos (${hasSel ? `Selecionado: ${brl(selSum)}` : hasSplitItem ? 'Divisões de itens ativas' : 'Clique para selecionar/dividir itens'})</summary>
        <div style="margin-top:8px">
          <div class="row" style="justify-content:space-between;margin-bottom:6px">
            <span class="muted" style="font-size:12px">Pague ou divida o valor de itens individuais entre pessoas (estilo Ei Chefe):</span>
            <div style="display:flex;gap:6px">
              <button class="btn sec sm" id="sel-all" type="button" style="padding:2px 6px;font-size:11px">Marcar pendentes</button>
              <button class="btn sec sm" id="sel-none" type="button" style="padding:2px 6px;font-size:11px">Limpar</button>
            </div>
          </div>
          <table style="font-size:12px;margin:0">
            <tr>
              <th style="width:28px"></th>
              <th>Item</th>
              <th style="text-align:right">Unit.</th>
              <th style="text-align:center">Qtd</th>
              <th style="text-align:center">Pago</th>
              <th style="text-align:center">Pagar Agora</th>
              <th style="text-align:center">Dividir Item</th>
              <th style="text-align:right">Subtotal</th>
            </tr>
            ${(o.items || []).filter(it => it.status !== 'cancelado').map(it => {
              const avail = availOf(it);
              const cur = Number(selectedQty[it.id] || 0);
              const isPaid = avail <= 0.009;
              const customSub = selectedCustomAmounts[it.id] !== undefined && cur > 0
                ? Number(selectedCustomAmounts[it.id])
                : +(cur * Number(it.unitPrice)).toFixed(2);

              let divisaoHtml = '';
              if (it.splitInfo) {
                const sPeople = Number(it.splitInfo.splitPeople || 2);
                const sQty = Number(it.splitInfo.splitQty || 1);
                const pQty = Number(it.splitInfo.partQty || (sQty / sPeople));
                const pAmt = Number(it.splitInfo.partAmount || ((Number(it.unitPrice) * sQty) / sPeople));
                const partsPaid = Math.min(sPeople, Math.round(Number(it.paidQuantity || 0) / pQty));
                const isDone = partsPaid >= sPeople;

                divisaoHtml = `
                  <div style="display:inline-flex;align-items:center;gap:4px">
                    <span class="btn-edit-lista btn-qtde-min-max ${isDone ? 'cores-qtd-pago' : ''}" title="Cotas Pagas: ${partsPaid} de ${sPeople}">
                      ${partsPaid}/${sPeople}
                    </span>
                    ${!isDone ? `
                      <button type="button" class="btnPagarCotaItem" data-pay-cota-item="${it.id}" title="Pagar Cota ${partsPaid + 1} de ${sPeople} (${brl(pAmt)})">
                        ⚡ Cota ${partsPaid + 1} (${brl(pAmt)})
                      </button>
                      <button type="button" class="btnCancelaDivisaoItem" data-cancel-split-item="${it.id}" title="Cancelar Divisão deste Item">
                        ✕
                      </button>
                    ` : '<span class="cores-qtd-pago" style="font-size:10px;font-weight:bold;padding:2px 6px;border-radius:10px">PAGO</span>'}
                  </div>
                `;
              } else if (!isPaid) {
                divisaoHtml = `
                  <button type="button" class="btn-dividir" data-split-item="${it.id}" title="Dividir este item por pessoas">
                    <span class="icon-dividir">➗</span> Dividir Item
                  </button>
                `;
              } else {
                divisaoHtml = `<span class="muted" style="font-size:11px" title="Pago Sem Divisão">SD</span>`;
              }

              return `<tr class="${isPaid ? 'item-paid' : cur > 0 ? 'item-sel' : ''}">
                <td><input type="checkbox" data-chk="${it.id}" ${cur > 0 ? 'checked' : ''} ${isPaid ? 'disabled' : ''}></td>
                <td>
                  <b>${esc(it.description || it.Product?.name)}</b>
                  ${it.observations ? ` <span class="muted">(${esc(it.observations)})</span>` : ''}
                  ${it.splitInfo ? ` <span style="font-size:11px;color:#8116d7;font-weight:bold">(${it.splitInfo.splitPeople} partes de ${brl(it.splitInfo.partAmount)})</span>` : ''}
                </td>
                <td style="text-align:right">${brl(it.unitPrice)}</td>
                <td style="text-align:center">${it.quantity}</td>
                <td style="text-align:center">${Number(it.paidQuantity || 0)}</td>
                <td style="text-align:center">${isPaid ? '<span class="badge pronto">Pago</span>' : `
                  <div style="display:inline-flex;align-items:center;gap:3px">
                    <button class="btn sec sm" data-qdec="${it.id}" type="button" style="padding:1px 6px">-</button>
                    <input type="number" step="any" min="0" max="${avail}" data-qinp="${it.id}" value="${cur}" style="width:45px;text-align:center;padding:2px">
                    <button class="btn sec sm" data-qinc="${it.id}" type="button" style="padding:1px 6px">+</button>
                    <span class="muted">/ ${avail}</span>
                  </div>`}
                </td>
                <td style="text-align:center">
                  ${divisaoHtml}
                  ${!isPaid ? `
                    <button type="button" class="btn-cancel-item-pay" data-cancel-item-pay="${it.id}" title="Cancelar este item (EiChefe F4)" style="border:1px solid #dc3545;background:#fff;color:#dc3545;border-radius:14px;padding:2px 7px;font-size:11px;margin-left:4px;cursor:pointer;font-weight:bold">
                      ✕ Cancelar
                    </button>
                  ` : ''}
                </td>
                <td style="text-align:right"><b>${brl(customSub)}</b></td>
              </tr>`;
            }).join('')}
          </table>
        </div>
      </details>
        `;
      })()}

      <!-- Histórico de Pagamentos já Feitos (valoresPagos.tpl) -->
      ${(o.payments && o.payments.length > 0) ? `
        <div id="soPagamentosFeitos">
          <div class="tituloHistorico">Histórico de Pagamentos Registrados nesta Conta</div>
          ${o.payments.map(p => `
            <div class="cadaPagamentoFeito">
              <div class="infoPag">
                <span class="muted">${new Date(p.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                <b>${esc(p.payerName || 'Caixa')}</b>
                <span>${esc(p.paymentMethod)}</span>
                ${(p.itemsJson && p.itemsJson.length > 0) ? `<span class="muted" style="font-size:11px">(${p.itemsJson.map(x => `${x.quantity}x ${esc(x.description)}`).join(', ')})</span>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:10px">
                <span class="infoValor">${brl(p.amount)}</span>
                <button class="btnEstorno" data-del-pay="${p.id}" title="Estornar/Remover Pagamento">X</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>`;

    // Recalcular totais e troco em tempo real
    const recalcTotals = () => {
      let sumEntered = 0;
      let cashEntered = 0;

      tilesConfig.forEach(t => {
        const inp = overlay.querySelector(`[data-val="${t.key}"]`);
        const v = parseNum(inp ? inp.value : tileVals[t.key]);
        tileVals[t.key] = inp && inp.value !== '' ? inp.value : (v > 0 ? v : '');
        sumEntered += v;
        if (t.key === 'dinheiro') cashEntered = v;

        const card = overlay.querySelector(`.cadaFormaPagamento[data-tile="${t.key}"]`);
        if (card) {
          if (v > 0) card.classList.add('formaSeleciona');
          else card.classList.remove('formaSeleciona');
        }
      });

      const dueEl = overlay.querySelector('#valorDevido');
      const trocoEl = overlay.querySelector('#valorTroco');
      const ppEl = overlay.querySelector('#valorPorPessoa');

      const currentTarget = hasSel ? selSum : remaining;

      if (sumEntered <= currentTarget) {
        const left = +(currentTarget - sumEntered).toFixed(2);
        if (dueEl) dueEl.textContent = brl(left);
        if (trocoEl) trocoEl.textContent = brl(0);
      } else {
        if (dueEl) dueEl.textContent = brl(0);
        const over = +(sumEntered - currentTarget).toFixed(2);
        if (trocoEl) trocoEl.textContent = brl(over);
      }

      if (ppEl) {
        ppEl.textContent = brl(cotaBase);
      }
    };

    // Listeners dos inputs de valor (R$)
    tilesConfig.forEach(t => {
      const inp = overlay.querySelector(`[data-val="${t.key}"]`);
      if (inp) {
        inp.oninput = () => {
          tileVals[t.key] = inp.value;
          recalcTotals();
        };
        inp.onfocus = () => inp.select();
      }

      // Listeners dos inputs de porcentagem (%)
      const inpPct = overlay.querySelector(`[data-pct="${t.key}"]`);
      if (inpPct) {
        inpPct.oninput = () => {
          tilePcts[t.key] = inpPct.value;
          const p = parseNum(inpPct.value);
          const currentTarget = hasSel ? selSum : remaining;
          if (p > 0) {
            const calculated = +(currentTarget * (p / 100)).toFixed(2);
            if (inp) inp.value = calculated.toFixed(2).replace('.', ',');
            tileVals[t.key] = calculated;
          } else {
            if (inp) inp.value = '';
            tileVals[t.key] = '';
          }
          recalcTotals();
        };
        inpPct.onfocus = () => inpPct.select();
      }

      // Clique no cone da forma de pagamento (preenche o saldo devido remanescente)
      const fillBtn = overlay.querySelector(`[data-fill="${t.key}"]`);
      if (fillBtn) {
        fillBtn.onclick = () => {
          const currentTarget = hasSel ? selSum : remaining;
          // Soma outras formas
          let otherSum = 0;
          tilesConfig.forEach(oT => {
            if (oT.key !== t.key) otherSum += parseNum(tileVals[oT.key]);
          });
          const needed = Math.max(0, +(currentTarget - otherSum).toFixed(2));
          if (inp) {
            inp.value = needed.toFixed(2).replace('.', ',');
            tileVals[t.key] = needed;
            inp.focus();
            inp.select();
          }
          recalcTotals();
        };
      }
    });

    // Nome do cliente
    const inpCliente = overlay.querySelector('#nomeCliente');
    if (inpCliente) {
      inpCliente.oninput = e => { payerName = e.target.value; };
    }

    // Fechar tela
    overlay.querySelector('#fecharTela').onclick = close;

    // Impressão
    overlay.querySelector('#btn-print-conta').onclick = safe(async () => {
      const r = await api(`/printers/print-order/${o.id}`, 'POST', { type: 'conta' });
      openThermalPreviewModal(r.jobs, `Conferência de Conta — ${titleLocal}`);
    });
    overlay.querySelector('#btn-print-comanda').onclick = safe(async () => {
      const r = await api(`/printers/print-order/${o.id}`, 'POST', { type: 'comanda', reprint: true });
      openThermalPreviewModal(r.jobs, `Comandas por Setor — ${titleLocal}`);
    });
    const btnImpDiv = overlay.querySelector('#imprimirPagamento');
    if (btnImpDiv) {
      btnImpDiv.onclick = overlay.querySelector('#btn-print-conta').onclick;
    }

    const btnModalAddItems = overlay.querySelector('#btn-modal-add-items');
    if (btnModalAddItems) {
      btnModalAddItems.onclick = () => {
        close();
        initialOrderId = o.id;
        initialOrderType = o.type || 'balcao';
        if (o.TableId) initialTableId = o.TableId;
        tab = 'pedido';
        render();
      };
    }

    // Divisão por pessoas
    const saveSplit = safe(async (n) => {
      splitCount = Math.max(1, Math.min(99, parseInt(n, 10) || 1));
      o.splitCount = splitCount;
      const updated = await api(`/orders/${o.id}/split`, 'PATCH', { splitCount });
      if (updated) {
        o = updated;
        splitCount = Math.max(1, Number(o.splitCount || splitCount));
      }
      drawModal();
    });
    const spDec = overlay.querySelector('#sp-dec');
    if (spDec) spDec.onclick = () => saveSplit(splitCount - 1);
    const spInc = overlay.querySelector('#sp-inc');
    if (spInc) spInc.onclick = () => saveSplit(splitCount + 1);

    const inpDividir = overlay.querySelector('#numeroDividirConta');
    if (inpDividir) {
      inpDividir.onfocus = () => inpDividir.select();
      inpDividir.oninput = () => {
        inpDividir.value = inpDividir.value.replace(/\D/g, '');
        const val = parseInt(inpDividir.value, 10);
        if (val && val >= 1 && val <= 99 && val !== splitCount) {
          clearTimeout(inpDividir._splitTimer);
          inpDividir._splitTimer = setTimeout(() => {
            saveSplit(val);
          }, 500);
        }
      };
      inpDividir.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          clearTimeout(inpDividir._splitTimer);
          const val = parseInt(inpDividir.value, 10) || 1;
          saveSplit(val);
        }
      };
      inpDividir.onblur = () => {
        clearTimeout(inpDividir._splitTimer);
        const val = parseInt(inpDividir.value, 10) || 1;
        if (val !== splitCount) {
          saveSplit(val);
        } else {
          inpDividir.value = splitCount;
        }
      };
    }

    // Aplicação automática de 1 cota da divisão
    const applyCota = (cotaNum, val) => {
      const amountToUse = val || nextCota;
      if (amountToUse <= 0.009) return;

      // Se já houver alguma forma com valor, mantém; senão usa Dinheiro
      let targetKey = 'dinheiro';
      for (const t of tilesConfig) {
        if (tileVals[t.key] > 0) { targetKey = t.key; break; }
      }

      // Limpa outros campos
      tilesConfig.forEach(t => {
        tileVals[t.key] = '';
        tilePcts[t.key] = '';
        const card = overlay.querySelector(`.cadaFormaPagamento[data-tile="${t.key}"]`);
        if (card) card.classList.remove('formaSeleciona');
        const inp = overlay.querySelector(`[data-val="${t.key}"]`);
        if (inp) inp.value = '';
        const pct = overlay.querySelector(`[data-pct="${t.key}"]`);
        if (pct) pct.value = '';
      });

      tileVals[targetKey] = amountToUse;
      const inp = overlay.querySelector(`[data-val="${targetKey}"]`);
      if (inp) {
        inp.value = amountToUse.toFixed(2).replace('.', ',');
        inp.focus();
        inp.select();
      }
      const card = overlay.querySelector(`.cadaFormaPagamento[data-tile="${targetKey}"]`);
      if (card) card.classList.add('formaSeleciona');

      // Preenche nome do cliente/cota automaticamente
      const cNum = cotaNum || (partesPagas + 1);
      const inpCliente = overlay.querySelector('#nomeCliente');
      if (inpCliente && !payerName) {
        payerName = `Pessoa ${cNum} (Cota ${cNum}/${splitCount})`;
        inpCliente.value = payerName;
      }

      recalcTotals();
      toast(`Cota ${cNum} (${brl(amountToUse)}) preenchida em ${targetKey.toUpperCase()}! Pressione ENTER para faturar.`);
    };

    const btnCotaAuto = overlay.querySelector('#btn-cota-auto');
    if (btnCotaAuto) {
      btnCotaAuto.onclick = () => applyCota(partesPagas + 1, nextCota);
    }

    overlay.querySelectorAll('.pillParte.proxima').forEach(btn => {
      btn.onclick = () => {
        const cNum = +btn.dataset.cota;
        const val = +btn.dataset.val;
        applyCota(cNum, val);
      };
    });

    const boxPorPessoa = overlay.querySelector('#box-por-pessoa');
    if (boxPorPessoa) {
      boxPorPessoa.onclick = () => applyCota(partesPagas + 1, nextCota);
    }

    // Itens Selecionados
    const btnSelAll = overlay.querySelector('#sel-all');
    if (btnSelAll) {
      btnSelAll.onclick = () => {
        (o.items || []).forEach(it => {
          const a = availOf(it);
          if (a > 0) {
            delete selectedCustomAmounts[it.id];
            selectedQty[it.id] = a;
          }
        });
        drawModal();
      };
    }
    const btnSelNone = overlay.querySelector('#sel-none');
    if (btnSelNone) {
      btnSelNone.onclick = () => {
        Object.keys(selectedQty).forEach(k => delete selectedQty[k]);
        Object.keys(selectedCustomAmounts).forEach(k => delete selectedCustomAmounts[k]);
        drawModal();
      };
    }

    overlay.querySelectorAll('[data-chk]').forEach(chk => chk.onchange = () => {
      const id = +chk.dataset.chk;
      const it = (o.items || []).find(x => x.id === id);
      delete selectedCustomAmounts[id];
      selectedQty[id] = chk.checked ? availOf(it) : 0;
      drawModal();
    });
    overlay.querySelectorAll('[data-qdec]').forEach(b => b.onclick = () => {
      const id = +b.dataset.qdec;
      delete selectedCustomAmounts[id];
      selectedQty[id] = Math.max(0, Number(selectedQty[id] || 0) - 1);
      drawModal();
    });
    overlay.querySelectorAll('[data-qinc]').forEach(b => b.onclick = () => {
      const id = +b.dataset.qinc;
      const it = (o.items || []).find(x => x.id === id);
      delete selectedCustomAmounts[id];
      selectedQty[id] = Math.min(availOf(it), Number(selectedQty[id] || 0) + 1);
      drawModal();
    });
    overlay.querySelectorAll('[data-qinp]').forEach(inp => inp.onchange = () => {
      const id = +inp.dataset.qinp;
      const it = (o.items || []).find(x => x.id === id);
      delete selectedCustomAmounts[id];
      selectedQty[id] = Math.max(0, Math.min(availOf(it), Number(inp.value || 0)));
      drawModal();
    });

    // Modal Divisão de Valores por Item (EiChefe ModalDivisaoValores)
    const openModalDivisaoValores = (item) => {
      const avail = availOf(item);
      if (avail <= 0.009) {
        toast('Item já está totalmente pago!');
        return;
      }

      let qtdeDividir = Math.max(1, Math.min(avail, 1));
      let qtdePessoas = 2;

      const modalDiv = document.createElement('div');
      modalDiv.className = 'modalDivisaoOverlay';

      const renderModalContent = () => {
        const valorUnitario = Number(item.unitPrice);
        const podeDividir = qtdeDividir > 0 && qtdePessoas >= 2;
        const valorPorPessoa = podeDividir ? +((valorUnitario * qtdeDividir) / qtdePessoas).toFixed(2) : 0;
        const partQty = podeDividir ? +(qtdeDividir / qtdePessoas).toFixed(4) : 0;

        modalDiv.innerHTML = `
          <div class="modalDivisaoBox" id="modalDivisaoItens">
            <div class="modalDivisaoHeader">
              <div>
                <h3>Dividir Item</h3>
                <small>Por favor, selecione quantos itens do produto serão divididos e por quantas pessoas quer dividir essa quantidade</small>
              </div>
              <div class="fecharModalDivisao" id="modalDivClose" title="Fechar (ESC)">✕</div>
            </div>

            <div class="modalDivisaoBody">
              <table class="table-dividir-valores">
                <thead>
                  <tr>
                    <th class="qtde">Qtde</th>
                    <th>Produto</th>
                    <th style="text-align:right">Unitário</th>
                    <th class="qtde-dividir" style="text-align:center">Qtde a Dividir</th>
                    <th class="qtde-pessoas" style="text-align:center">Qtde Pessoas</th>
                    <th class="total">Valor Por Pessoa</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="qtde" align="center">
                      ${qtdeDividir === 0 ? avail : `
                        <span style="text-decoration:line-through;padding-right:4px;color:#999">${avail}</span>
                        <b style="color:#333">${+(avail - qtdeDividir).toFixed(2)}</b>
                      `}
                    </td>
                    <td><b>${esc(item.description || item.Product?.name)}</b></td>
                    <td style="text-align:right">${brl(valorUnitario)}</td>
                    <td align="center">
                      <div style="display:inline-flex;align-items:center;gap:3px">
                        <input type="text" class="numero" id="modalInpQtdeDiv" value="${qtdeDividir}">
                        <button type="button" class="btn-edit-lista" id="modalSubQtdeDiv" title="Diminuir">−</button>
                        <button type="button" class="btn-edit-lista" id="modalAddQtdeDiv" title="Aumentar">+</button>
                        <button type="button" class="btn-edit-lista btn-tudo" id="modalAllQtdeDiv" title="Marcar Todos">T</button>
                      </div>
                    </td>
                    <td align="center">
                      <div style="display:inline-flex;align-items:center;gap:3px">
                        <input type="text" class="numero" id="modalInpPessoasDiv" value="${qtdePessoas}">
                        <button type="button" class="btn-edit-lista" id="modalSubPessoasDiv" title="Diminuir">−</button>
                        <button type="button" class="btn-edit-lista" id="modalAddPessoasDiv" title="Aumentar">+</button>
                      </div>
                    </td>
                    <td align="center">
                      <div class="badge badge-success total" id="modalBadgeTotal">
                        ${brl(valorPorPessoa)}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="modalDivisaoFooter">
              <button type="button" class="btn sec" id="modalBtnCancel">Cancelar</button>
              <button type="button" class="btn sec" id="modalBtnSalvar" ${!podeDividir ? 'disabled' : ''} style="font-weight:600">
                Salvar Divisão
              </button>
              <button type="button" class="btn btn-faturar-cota" id="modalBtnDividirEPagar" ${!podeDividir ? 'disabled' : ''}>
                ⚡ Dividir e Pagar 1ª Cota (${brl(valorPorPessoa)})
              </button>
            </div>
          </div>
        `;

        const closeDivModal = () => {
          window.removeEventListener('keydown', handleDivModalKey);
          modalDiv.remove();
        };

        const handleDivModalKey = (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeDivModal();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (podeDividir) {
              const btnPay = modalDiv.querySelector('#modalBtnDividirEPagar');
              if (btnPay) btnPay.click();
            }
          }
        };
        window.addEventListener('keydown', handleDivModalKey);

        modalDiv.querySelector('#modalDivClose').onclick = closeDivModal;
        modalDiv.querySelector('#modalBtnCancel').onclick = closeDivModal;

        modalDiv.querySelector('#modalSubQtdeDiv').onclick = () => {
          if (qtdeDividir > 1) { qtdeDividir--; renderModalContent(); }
        };
        modalDiv.querySelector('#modalAddQtdeDiv').onclick = () => {
          if (qtdeDividir < avail) { qtdeDividir++; renderModalContent(); }
        };
        modalDiv.querySelector('#modalAllQtdeDiv').onclick = () => {
          qtdeDividir = avail;
          renderModalContent();
        };
        const inpQ = modalDiv.querySelector('#modalInpQtdeDiv');
        if (inpQ) {
          inpQ.onchange = () => {
            const val = parseInt(inpQ.value, 10);
            qtdeDividir = Math.max(1, Math.min(avail, isNaN(val) ? 1 : val));
            renderModalContent();
          };
        }

        modalDiv.querySelector('#modalSubPessoasDiv').onclick = () => {
          if (qtdePessoas > 2) { qtdePessoas--; renderModalContent(); }
        };
        modalDiv.querySelector('#modalAddPessoasDiv').onclick = () => {
          qtdePessoas++;
          renderModalContent();
        };
        const inpP = modalDiv.querySelector('#modalInpPessoasDiv');
        if (inpP) {
          inpP.onchange = () => {
            const val = parseInt(inpP.value, 10);
            qtdePessoas = Math.max(2, Math.min(99, isNaN(val) ? 2 : val));
            renderModalContent();
          };
        }

        // Salvar Divisão
        modalDiv.querySelector('#modalBtnSalvar').onclick = safe(async () => {
          const updated = await api(`/orders/${o.id}/items/${item.id}/split`, 'POST', {
            splitQty: qtdeDividir,
            splitPeople: qtdePessoas,
          });
          if (updated) o = updated;
          closeDivModal();
          toast(`Item "${item.description}" dividido em ${qtdePessoas} pessoas!`);
          drawModal();
        });

        // Dividir e Pagar 1ª Cota Agora
        modalDiv.querySelector('#modalBtnDividirEPagar').onclick = safe(async () => {
          const updated = await api(`/orders/${o.id}/items/${item.id}/split`, 'POST', {
            splitQty: qtdeDividir,
            splitPeople: qtdePessoas,
          });
          if (updated) o = updated;
          closeDivModal();

          selectedQty[item.id] = partQty;
          selectedCustomAmounts[item.id] = valorPorPessoa;

          let targetKey = 'dinheiro';
          for (const t of tilesConfig) {
            if (tileVals[t.key] > 0) { targetKey = t.key; break; }
          }
          tilesConfig.forEach(t => {
            tileVals[t.key] = '';
            tilePcts[t.key] = '';
          });
          tileVals[targetKey] = valorPorPessoa;
          payerName = `Pessoa 1/${qtdePessoas} (${item.description})`;

          drawModal();
          toast(`⚡ 1ª Cota (${brl(valorPorPessoa)}) selecionada em ${targetKey.toUpperCase()}! Pressione ENTER para faturar.`);
        });
      };

      renderModalContent();
      document.body.appendChild(modalDiv);
    };

    // Ações de divisão na lista de itens
    overlay.querySelectorAll('[data-split-item]').forEach(b => {
      b.onclick = () => {
        const itId = +b.dataset.splitItem;
        const it = (o.items || []).find(x => x.id === itId);
        if (it) openModalDivisaoValores(it);
      };
    });

    overlay.querySelectorAll('[data-cancel-split-item]').forEach(b => {
      b.onclick = safe(async () => {
        const itId = +b.dataset.cancelSplitItem;
        const it = (o.items || []).find(x => x.id === itId);
        if (!it) return;
        if (Number(it.paidQuantity || 0) > 0) {
          if (!confirm(`Este item já possui pagamentos parciais registrados. Deseja cancelar a divisão e manter o valor pago?`)) return;
        }
        const updated = await api(`/orders/${o.id}/items/${it.id}/split`, 'DELETE');
        if (updated) o = updated;
        delete selectedQty[it.id];
        delete selectedCustomAmounts[it.id];
        toast(`Divisão de "${it.description}" cancelada.`);
        drawModal();
      });
    });

    overlay.querySelectorAll('[data-pay-cota-item]').forEach(b => {
      b.onclick = () => {
        const itId = +b.dataset.payCotaItem;
        const it = (o.items || []).find(x => x.id === itId);
        if (!it || !it.splitInfo) return;

        const sPeople = Number(it.splitInfo.splitPeople || 2);
        const sQty = Number(it.splitInfo.splitQty || 1);
        const pQty = Number(it.splitInfo.partQty || (sQty / sPeople));
        const pAmt = Number(it.splitInfo.partAmount || ((Number(it.unitPrice) * sQty) / sPeople));
        const partsPaid = Math.min(sPeople, Math.round(Number(it.paidQuantity || 0) / pQty));
        const nextPart = partsPaid + 1;
        if (nextPart > sPeople) {
          toast('Todas as cotas deste item já foram pagas!');
          return;
        }

        // Seleciona a cota deste item
        selectedQty[it.id] = pQty;
        selectedCustomAmounts[it.id] = pAmt;

        // Preenche na forma de pagamento ativa ou Dinheiro
        let targetKey = 'dinheiro';
        for (const t of tilesConfig) {
          if (tileVals[t.key] > 0) { targetKey = t.key; break; }
        }
        tilesConfig.forEach(t => {
          tileVals[t.key] = '';
          tilePcts[t.key] = '';
        });
        tileVals[targetKey] = pAmt;
        payerName = `Pessoa ${nextPart}/${sPeople} (${it.description})`;

        drawModal();
        toast(`⚡ Cota ${nextPart}/${sPeople} (${brl(pAmt)}) selecionada em ${targetKey.toUpperCase()}! Pressione ENTER para faturar.`);
      };
    });

    // Cancelar item diretamente da tela de pagamento (EiChefe F4)
    overlay.querySelectorAll('[data-cancel-item-pay]').forEach(b => {
      b.onclick = () => {
        const itId = +b.dataset.cancelItemPay;
        const it = (o.items || []).find(x => x.id === itId);
        if (!it) return;
        openModalCancelarItem(o, it, (updatedOrder) => {
          delete selectedQty[it.id];
          delete selectedCustomAmounts[it.id];
          const remainingActive = (updatedOrder.items || []).filter(x => x.status !== 'cancelado');
          if (updatedOrder.status === 'cancelado' || remainingActive.length === 0) {
            toast('Mesa liberada (todos os itens cancelados).');
            close();
          } else {
            o = updatedOrder;
            drawModal();
          }
        });
      };
    });

    // Estorno de pagamento individual
    overlay.querySelectorAll('[data-del-pay]').forEach(btn => {
      btn.onclick = safe(async () => {
        const payId = btn.dataset.delPay;
        if (!confirm('Deseja realmente estornar este pagamento?')) return;
        o = await api(`/orders/${o.id}/payments/${payId}`, 'DELETE');
        toast('Pagamento estornado com sucesso!');
        drawModal();
      });
    });

    // Lógica compartilhada de faturamento
    const faturarConta = async (shouldEmitNfe = false) => {
      const currentTarget = hasSel ? selSum : remaining;
      if (currentTarget <= 0.009) {
        toast('Conta já está totalmente paga!');
        close();
        if (shouldEmitNfe) openNfeModal(o.id, onRefresh);
        return;
      }

      const itemsToSend = Object.entries(selectedQty)
        .filter(([, q]) => Number(q) > 0)
        .map(([orderItemId, quantity]) => {
          const itPayload = { orderItemId: +orderItemId, quantity: +quantity };
          if (selectedCustomAmounts[orderItemId] !== undefined) {
            itPayload.amount = Number(selectedCustomAmounts[orderItemId]);
          }
          return itPayload;
        });

      // Coleta pagamentos informados nas caixas
      const paymentsToPay = [];
      let totalBatch = 0;
      let cashVal = 0;

      tilesConfig.forEach(t => {
        const v = parseNum(tileVals[t.key]);
        if (v > 0) {
          paymentsToPay.push({ paymentMethod: t.method, amount: v });
          totalBatch += v;
          if (t.key === 'dinheiro') cashVal = v;
        }
      });

      // Se houver troco em dinheiro, desconta o troco do valor faturado em dinheiro
      let changeVal = 0;
      if (totalBatch > currentTarget && cashVal > 0) {
        const over = +(totalBatch - currentTarget).toFixed(2);
        changeVal = over;
        const cashEntry = paymentsToPay.find(p => p.paymentMethod === 'Dinheiro');
        if (cashEntry) {
          cashEntry.amount = Math.max(0, +(cashEntry.amount - over).toFixed(2));
        }
      }

      // Se o operador não digitou nada em nenhuma forma, assume Dinheiro com o saldo total devido
      let payload = {};
      let payingAmount = 0;
      if (paymentsToPay.length === 0) {
        payingAmount = currentTarget;
        payload = {
          paymentMethod: 'Dinheiro',
          amount: currentTarget,
          items: itemsToSend,
          payerName: payerName || null,
        };
      } else if (paymentsToPay.length === 1) {
        payingAmount = paymentsToPay[0].amount;
        payload = {
          paymentMethod: paymentsToPay[0].paymentMethod,
          amount: paymentsToPay[0].amount,
          items: itemsToSend,
          payerName: payerName || null,
        };
      } else {
        payingAmount = paymentsToPay.reduce((acc, p) => acc + p.amount, 0);
        payload = {
          payments: paymentsToPay,
          items: itemsToSend,
          payerName: payerName || null,
        };
      }

      const inpCpf = overlay.querySelector('#cpfNota');
      const cpfVal = inpCpf ? inpCpf.value.trim() : (o.customerCpf || null);
      if (cpfVal) payload.customerCpf = cpfVal;

      const executePayment = async () => {
        o = await api(`/orders/${o.id}/pay`, 'POST', payload);

        // Limpa campos digitados
        tilesConfig.forEach(t => { delete tileVals[t.key]; delete tilePcts[t.key]; });
        Object.keys(selectedQty).forEach(k => delete selectedQty[k]);
        Object.keys(selectedCustomAmounts).forEach(k => delete selectedCustomAmounts[k]);

        if (o.paid) {
          const mesaDesc = o.Table ? `Mesa #${o.Table.number}` : `Pedido #${o.id}`;
          const nfeMsg = o.nfeStatus === 'emitida' ? ' (NFC-e emitida e impressa! 🧾)' : '';
          toast(`✅ ${mesaDesc} faturada e liberada com sucesso!${nfeMsg}`);
          close();
          if (shouldEmitNfe && o.nfeStatus !== 'emitida') {
            openNfeModal(o.id, onRefresh);
          }
        } else {
          toast('Pagamento registrado com sucesso!');
          drawModal();
          if (shouldEmitNfe && o.nfeStatus !== 'emitida') {
            openNfeModal(o.id, onRefresh);
          }
        }
      };

      const isTable = o.type === 'mesa' || !!o.TableId || !!o.Table;
      const willCloseTable = isTable && ((!hasSel && payingAmount >= remaining - 0.05) || (paid + payingAmount >= total - 0.05));

      if (willCloseTable) {
        const tableNum = o.Table ? o.Table.number : (o.TableId || '?');
        let methodDesc = '';
        if (paymentsToPay.length === 0) {
          methodDesc = 'Dinheiro';
        } else {
          methodDesc = paymentsToPay.map(p => `${p.paymentMethod} (${brl(p.amount)})`).join(' + ');
        }

        confirmCloseTable({
          tableNumber: tableNum,
          orderId: o.id,
          totalAmount: total,
          alreadyPaid: paid,
          amountPaying: payingAmount,
          changeAmount: changeVal,
          paymentMethodDesc: methodDesc,
          payerName: payerName || null,
          onConfirm: () => {
            executePayment();
          },
        });
        return;
      }

      await executePayment();
    };

    // Faturar Simples (Enter)
    const btnFaturar = overlay.querySelector('#faturar');
    if (btnFaturar) {
      btnFaturar.onclick = safe(() => faturarConta(false));
    }

    // Faturar com NFC-e (F9)
    const btnFaturarNfe = overlay.querySelector('#faturar-nfe');
    if (btnFaturarNfe) {
      btnFaturarNfe.onclick = safe(() => faturarConta(true));
    }

    recalcTotals();
  };

  drawModal();
}

// ---------- Pedidos & Vendas (detalheVenda.tpl e terminalGerente do EiChefe) ----------
let pedidosSearch = '';
let pedidosTypeFilter = 'todos';
let pedidosStatusFilter = 'todos';

async function viewPedidos() {
  const load = safe(async () => {
    const [orders, couriers, tables] = await Promise.all([
      api('/orders'), api('/config/couriers'), api('/tables'),
    ]);

    // Totais gerais
    const totalOrders = orders.length;
    const mesaOrdersCount = orders.filter(o => o.type === 'mesa').length;
    const balcaoOrdersCount = orders.filter(o => o.type === 'balcao').length;
    const deliveryOrdersCount = orders.filter(o => o.type === 'delivery').length;

    const openOrders = orders.filter(o => !o.paid && o.status !== 'cancelado');
    const closedOrders = orders.filter(o => o.paid || o.status === 'entregue');
    const canceledOrders = orders.filter(o => o.status === 'cancelado');

    const totalFaturamento = orders.filter(o => o.status !== 'cancelado').reduce((s, o) => s + Number(o.totalAmount || 0), 0);
    const totalRecebido = orders.reduce((s, o) => s + Number(o.paidAmount || 0), 0);
    const totalPendente = openOrders.reduce((s, o) => s + Math.max(0, Number(o.totalAmount || 0) - Number(o.paidAmount || 0)), 0);

    // Filtragem
    const q = pedidosSearch.trim().toLowerCase();
    const filteredOrders = orders.filter(o => {
      // Tipo
      if (pedidosTypeFilter !== 'todos' && o.type !== pedidosTypeFilter) return false;

      // Status
      if (pedidosStatusFilter === 'abertos' && (o.paid || o.status === 'cancelado')) return false;
      if (pedidosStatusFilter === 'fechados' && (!o.paid && o.status !== 'entregue')) return false;
      if (pedidosStatusFilter === 'cancelados' && o.status !== 'cancelado') return false;

      // Busca
      if (q) {
        const idMatch = String(o.id).includes(q);
        const mesaMatch = (o.Table && String(o.Table.number).includes(q)) || (o.TableId && String(o.TableId).includes(q));
        const custMatch = o.Customer?.name?.toLowerCase().includes(q) || o.Customer?.phone?.toLowerCase().includes(q) || (o.address || '').toLowerCase().includes(q);
        const itemMatch = (o.items || []).some(it => (it.description || it.Product?.name || '').toLowerCase().includes(q));
        if (!idMatch && !mesaMatch && !custMatch && !itemMatch) return false;
      }
      return true;
    });

    view().innerHTML = `
      <div class="card">
        <div class="pedidos-header-bar">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div>
              <h3 style="margin:0">📋 Pedidos & Vendas</h3>
              <span class="muted" style="font-size:12px">Gerenciamento completo de comandas, mesas e entregas (estilo EiChefe Gestão)</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <input id="pedidos-search" placeholder="🔍 Buscar nº, mesa, cliente, item..." value="${esc(pedidosSearch)}" style="width:260px;padding:6px 10px;font-size:13px">
              <button class="btn ok sm" id="btn-novo-pedido-pedidos">➕ Novo Pedido</button>
            </div>
          </div>

          <!-- Totalizadores no Topo -->
          <div class="pedidos-summary-cards">
            <div class="pedidos-summary-card">
              <span class="label">Total de Vendas</span>
              <span class="val">${totalOrders} <small style="font-size:12px;font-weight:400;color:#666">pedidos</small></span>
            </div>
            <div class="pedidos-summary-card">
              <span class="label">Total Faturamento</span>
              <span class="val" style="color:#029CC1">${brl(totalFaturamento)}</span>
            </div>
            <div class="pedidos-summary-card">
              <span class="label">Total Recebido</span>
              <span class="val" style="color:#28a745">${brl(totalRecebido)}</span>
            </div>
            <div class="pedidos-summary-card">
              <span class="label">Saldo em Aberto</span>
              <span class="val" style="color:#d9534f">${brl(totalPendente)}</span>
            </div>
          </div>

          <!-- Filtros de Tipo e Status -->
          <div class="pedidos-filters-row">
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <button type="button" class="pill ${pedidosTypeFilter === 'todos' ? 'on' : ''}" data-ptf="todos">Todos (${totalOrders})</button>
              <button type="button" class="pill ${pedidosTypeFilter === 'mesa' ? 'on' : ''}" data-ptf="mesa">🍽️ Salão (${mesaOrdersCount})</button>
              <button type="button" class="pill ${pedidosTypeFilter === 'balcao' ? 'on' : ''}" data-ptf="balcao">🛍️ Balcão (${balcaoOrdersCount})</button>
              <button type="button" class="pill ${pedidosTypeFilter === 'delivery' ? 'on' : ''}" data-ptf="delivery">🛵 Delivery (${deliveryOrdersCount})</button>
            </div>

            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <button type="button" class="pill ${pedidosStatusFilter === 'todos' ? 'on' : ''}" data-psf="todos">Todos Status</button>
              <button type="button" class="pill ${pedidosStatusFilter === 'abertos' ? 'on' : ''}" data-psf="abertos">🟡 Em Aberto (${openOrders.length})</button>
              <button type="button" class="pill ${pedidosStatusFilter === 'fechados' ? 'on' : ''}" data-psf="fechados">🟢 Fechados / Pagos (${closedOrders.length})</button>
              <button type="button" class="pill ${pedidosStatusFilter === 'cancelados' ? 'on' : ''}" data-psf="cancelados">🔴 Cancelados (${canceledOrders.length})</button>
            </div>
          </div>
        </div>

        <div class="scroll" style="max-height: calc(100vh - 280px)">
          <table>
            <thead>
              <tr>
                <th style="width:70px">#</th>
                <th style="width:110px">Tipo</th>
                <th>Local / Cliente</th>
                <th>Itens Lançados</th>
                <th style="width:140px">Total / Saldo</th>
                <th style="width:130px">Status</th>
                <th style="min-width:260px;text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${filteredOrders.length ? filteredOrders.map(o => {
                const total = Number(o.totalAmount || 0);
                const paid = Number(o.paidAmount || 0);
                const rem = Math.max(0, +(total - paid).toFixed(2));
                const isClosed = o.paid || o.status === 'entregue' || o.status === 'cancelado';
                return `
                  <tr style="${o.status === 'cancelado' ? 'opacity:0.65;background:#fff5f5' : (o.paid ? 'background:#f9fff9' : '')}">
                    <td>
                      <b>#${o.id}</b>
                      <div class="muted" style="font-size:11px">${new Date(o.createdAt).toLocaleDateString('pt-BR')} ${new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td>${typeChip(o.type)}</td>
                    <td>
                      ${o.type === 'mesa' ? `<b>Mesa #${o.Table ? o.Table.number : (o.TableId || '-')}</b>` : esc(o.Customer?.name || 'Cliente Avulso')}
                      ${o.Customer?.phone ? `<div class="muted" style="font-size:11px">📞 ${esc(o.Customer.phone)}</div>` : ''}
                      ${o.splitCount > 1 ? `<div class="muted" style="font-size:11px">÷ ${o.splitCount} pessoas (${brl(total / o.splitCount)}/pess.)</div>` : ''}
                      ${o.type === 'delivery' ? `<div class="muted" style="font-size:11px">${esc(o.address || '')} - ${esc(o.Neighborhood?.name || '')}${o.changeFor ? '<br>Troco p/ ' + brl(o.changeFor) : ''}</div>` : ''}
                    </td>
                    <td>
                      ${(o.items || []).map(i => {
                        const pq = Number(i.paidQuantity || 0);
                        const tag = pq >= i.quantity ? ' <span class="badge pronto" style="font-size:10px">pago</span>' : pq > 0 ? ` <span class="badge preparo" style="font-size:10px">pago ${pq}/${i.quantity}</span>` : '';
                        return `${i.quantity}x ${esc(i.description || i.Product?.name || 'Item')}${i.observations ? ` <span style="color:#ff6600;font-size:11px">(${esc(i.observations)})</span>` : ''}${tag}`;
                      }).join('<br>')}
                    </td>
                    <td>
                      <b style="font-size:14px">${brl(total)}</b>
                      ${Number(o.deliveryFee) ? `<div class="muted" style="font-size:11px">Taxa: ${brl(o.deliveryFee)}</div>` : ''}
                      ${paid > 0 ? `<div style="color:#28a745;font-size:11.5px;font-weight:700">Pago: ${brl(paid)}</div>` : ''}
                      ${rem > 0 && !o.paid ? `<div style="color:#dc3545;font-size:11.5px;font-weight:800">Falta: ${brl(rem)}</div>` : ''}
                    </td>
                    <td>
                      <span class="badge ${o.status}">${STATUS[o.status] || o.status}</span>
                      ${o.paid ? `<div><small style="color:#28a745;font-weight:700">💰 ${esc(o.paymentMethod || 'Pago')}</small></div>` : ''}
                      ${o.Courier ? `<div class="muted" style="font-size:11px">🛵 ${esc(o.Courier.name)}</div>` : ''}
                    </td>
                    <td style="text-align:right">
                      <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
                        ${!o.paid && o.status !== 'cancelado' ? `
                          <button type="button" class="btn ok sm" data-pay="${o.id}">💰 Receber</button>
                          <button type="button" class="btn sm" data-add-items="${o.id}" style="background:#029CC1;color:#fff;font-weight:700" title="Lançar Mais Itens neste Pedido / Comanda">➕ Itens</button>
                        ` : ''}

                        ${isClosed ? `
                          <button type="button" class="btn sm" data-reopen="${o.id}" style="background:#CA7C0B;color:#fff;font-weight:700" title="Reabrir Mesa ou Venda Fechada (estilo EiChefe)">🔄 Reabrir</button>
                        ` : ''}

                        ${(o.payments && o.payments.length && o.paid) ? `
                          <button type="button" class="btn sec sm" data-pay="${o.id}">Ver Pgto</button>
                        ` : ''}

                        ${o.type === 'delivery' && o.status === 'pronto' ? `
                          <select data-c="${o.id}" style="font-size:11px;padding:2px 4px">${couriers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
                          <button type="button" class="btn sm" data-disp="${o.id}">Saiu</button>
                        ` : ''}

                        ${o.status === 'saiu' || (o.type !== 'delivery' && o.status === 'pronto') ? `
                          <button type="button" class="btn sm" data-deliver="${o.id}">Entregue</button>
                        ` : ''}

                        <button type="button" class="btn sec sm" data-pconta="${o.id}" title="Imprimir Cupom de Conta (F6)">🖨️ Conta</button>
                        <button type="button" class="btn sec sm" data-pcomanda="${o.id}" title="Imprimir Comandas por Setor">🍕 Comanda</button>
                        <button type="button" class="btn sm" data-nfe="${o.id}" style="background:#0284c7;color:#fff;font-weight:700" title="Emitir Cupom Fiscal NFC-e">🧾 NFC-e</button>

                        ${!['cancelado', 'entregue'].includes(o.status) ? `
                          <button type="button" class="btn sec sm" data-cancel="${o.id}" style="color:var(--danger)">Cancelar</button>
                        ` : ''}

                        <button type="button" class="btn danger sm" data-delete-order="${o.id}" title="Excluir Permanentemente este Pedido">🗑️</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('') : `<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Nenhum pedido encontrado com os filtros selecionados</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Filtros e busca
    const searchInput = $('pedidos-search');
    if (searchInput) {
      searchInput.oninput = () => {
        pedidosSearch = searchInput.value;
        load();
      };
    }

    $('btn-novo-pedido-pedidos').onclick = () => { tab = 'pedido'; render(); };

    document.querySelectorAll('[data-ptf]').forEach(el => {
      el.onclick = () => {
        pedidosTypeFilter = el.dataset.ptf;
        load();
      };
    });

    document.querySelectorAll('[data-psf]').forEach(el => {
      el.onclick = () => {
        pedidosStatusFilter = el.dataset.psf;
        load();
      };
    });

    // Ações de pagamento e impressão
    document.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => openPaymentModal(+b.dataset.pay, load));

    document.querySelectorAll('[data-add-items]').forEach(b => b.onclick = () => {
      const id = +b.dataset.addItems;
      const ord = orders.find(x => x.id === id);
      initialOrderId = id;
      initialOrderType = ord?.type || 'balcao';
      if (ord?.TableId) initialTableId = ord.TableId;
      tab = 'pedido';
      render();
    });

    document.querySelectorAll('[data-pconta]').forEach(b => b.onclick = safe(async () => {
      const r = await api(`/printers/print-order/${b.dataset.pconta}`, 'POST', { type: 'conta' });
      openThermalPreviewModal(r.jobs, `Cupom de Conta — Pedido #${b.dataset.pconta}`);
    }));

    document.querySelectorAll('[data-pcomanda]').forEach(b => b.onclick = safe(async () => {
      const r = await api(`/printers/print-order/${b.dataset.pcomanda}`, 'POST', { type: 'comanda' });
      openThermalPreviewModal(r.jobs, `Comandas por Setor — Pedido #${b.dataset.pcomanda}`);
    }));

    document.querySelectorAll('[data-nfe]').forEach(b => b.onclick = () => {
      openNfeModal(+b.dataset.nfe, load);
    });

    document.querySelectorAll('[data-cancel]').forEach(b => b.onclick = safe(async () => {
      if (confirm('Cancelar este pedido? O estoque será estornado.')) {
        await api(`/orders/${b.dataset.cancel}/status`, 'PATCH', { status: 'cancelado' });
        toast('Pedido cancelado');
        load();
      }
    }));

    document.querySelectorAll('[data-deliver]').forEach(b => b.onclick = safe(async () => {
      await api(`/orders/${b.dataset.deliver}/delivered`, 'POST');
      load();
    }));

    document.querySelectorAll('[data-disp]').forEach(b => b.onclick = safe(async () => {
      const sel = document.querySelector(`[data-c="${b.dataset.disp}"]`);
      if (!sel) return toast('Cadastre um entregador em Cadastros');
      await api(`/orders/${b.dataset.disp}/dispatch`, 'POST', { courierId: +sel.value });
      load();
    }));

    // REABRIR PEDIDO / MESA FECHADA (EiChefe)
    document.querySelectorAll('[data-reopen]').forEach(b => b.onclick = safe(async () => {
      const id = +b.dataset.reopen;
      const o = orders.find(x => x.id === id);
      if (!o) return;

      if (o.type === 'mesa') {
        const curTable = tables.find(t => t.id === o.TableId || t.number === o.Table?.number);
        const isTableOccupied = curTable && curTable.isOpen && curTable.order && curTable.order.id !== o.id;

        if (isTableOccupied) {
          const freeTables = tables.filter(t => !t.isOpen);
          if (!freeTables.length) return toast('Não há mesas livres no salão para reabrir este pedido.');

          modal(`Reabrir Atendimento de Mesa — Pedido #${o.id}`, `
            <div style="font-size:13px">
              <div style="background:#fff3cd;border:1px solid #ffeeba;color:#856404;padding:8px 10px;border-radius:4px;margin-bottom:10px">
                ⚠️ A <b>Mesa #${curTable.number}</b> original já está ocupada por outro atendimento no salão.
              </div>
              <p>Selecione uma mesa livre para reabrir este pedido:</p>
              <select id="rb-target-table" style="width:100%;font-size:14px;font-weight:700;padding:6px;margin-bottom:10px">
                ${freeTables.map(t => `<option value="${t.id}">Mesa #${t.number} (Livre)</option>`).join('')}
              </select>
              <div style="margin-top:10px">
                <label style="cursor:pointer;display:flex;align-items:center;gap:6px">
                  <input type="checkbox" id="rb-reset-pay"> Zerar pagamentos já efetuados (recomeçar a conta do zero)
                </label>
              </div>
            </div>
          `, async () => {
            const tableId = +$('rb-target-table').value;
            const resetPayments = $('rb-reset-pay').checked;
            await api(`/orders/${o.id}/reopen`, 'POST', { tableId, resetPayments });
            toast(`Pedido #${o.id} reaberto na mesa com sucesso!`);
            load();
          }, 'Reabrir Mesa');
        } else {
          modal(`Reabrir Atendimento de Mesa — Pedido #${o.id}`, `
            <div style="font-size:13px">
              <p>Deseja <b>REABRIR</b> o atendimento da <b>Mesa #${curTable ? curTable.number : (o.TableId || '')}</b> (Pedido #${o.id})?</p>
              <p class="muted">A mesa voltará a constar como ocupada no salão, permitindo lançar mais pizzas/produtos ou reajustar a conta.</p>
              <div style="margin-top:10px">
                <label style="cursor:pointer;display:flex;align-items:center;gap:6px">
                  <input type="checkbox" id="rb-reset-pay"> Zerar pagamentos já efetuados (recomeçar a conta do zero)
                </label>
              </div>
            </div>
          `, async () => {
            const resetPayments = $('rb-reset-pay').checked;
            await api(`/orders/${o.id}/reopen`, 'POST', { tableId: curTable ? curTable.id : o.TableId, resetPayments });
            toast(`Pedido #${o.id} reaberto na Mesa #${curTable ? curTable.number : ''} com sucesso!`);
            load();
          }, 'Reabrir Mesa');
        }
      } else {
        modal(`Reabrir Venda #${o.id} (${TYPE[o.type] || o.type})`, `
          <div style="font-size:13px">
            <p>Deseja <b>REABRIR</b> a venda <b>#${o.id}</b> (${TYPE[o.type] || o.type}) de <b>${esc(o.Customer?.name || 'Cliente')}</b>?</p>
            <p class="muted">O pedido voltará para o status "Em Preparo", permitindo adicionar novos itens, alterar dados ou receber novamente.</p>
            <div style="margin-top:10px">
              <label style="cursor:pointer;display:flex;align-items:center;gap:6px">
                <input type="checkbox" id="rb-reset-pay"> Zerar pagamentos já efetuados
              </label>
            </div>
          </div>
        `, async () => {
          const resetPayments = $('rb-reset-pay').checked;
          await api(`/orders/${o.id}/reopen`, 'POST', { resetPayments });
          toast(`Venda #${o.id} reaberta com sucesso!`);
          load();
        }, 'Reabrir Venda');
      }
    }));

    // EXCLUIR / REMOVER PEDIDO PERMANENTEMENTE
    document.querySelectorAll('[data-delete-order]').forEach(b => b.onclick = safe(async () => {
      const id = +b.dataset.deleteOrder;
      const o = orders.find(x => x.id === id);
      if (!o) return;

      modal(`Excluir Pedido #${o.id}`, `
        <div style="font-size:13px">
          <p>Tem certeza que deseja <b>EXCLUIR permanentemente</b> o Pedido <b>#${o.id}</b> (${TYPE[o.type] || o.type} — ${brl(o.totalAmount || 0)})?</p>
          <div style="background:#fee2e2;border:1px solid #fecaca;padding:10px;border-radius:6px;color:#991b1b;margin-top:10px;font-size:12px">
            ⚠️ <b>Atenção:</b> Esta ação não pode ser desfeita. Todos os itens e pagamentos vinculados serão apagados do sistema. Se a mesa estiver ocupada por este pedido, ela será liberada automaticamente.
          </div>
        </div>
      `, async () => {
        await api(`/orders/${o.id}`, 'DELETE');
        toast(`Pedido #${o.id} excluído com sucesso!`);
        load();
      }, 'Excluir Definitivamente');
    }));
  });

  await load();
  timer = setInterval(load, 10000);
}

// ---------- Cozinha: colunas por etapa (estilo BaseColunasKDS do EiChefe) ----------
async function viewCozinha() {
  const load = safe(async () => {
    const { orders, stages } = await api('/kitchen/pending');
    const now = Date.now();
    const cols = [{ id: null, name: 'Fila' }, ...stages];
    const cards = cols.map(() => []);
    for (const o of orders) for (const i of o.items) {
      if (i.status === 'pronto') continue;
      const ci = i.status === 'fila' ? 0 : Math.max(1, cols.findIndex(c => c.id === i.CurrentStageId));
      cards[ci].push({ o, i });
    }
    view().innerHTML = `<div class="kds-board">${cols.map((c, ci) => `
      <div class="kds-col"><h4>${esc(c.name)} <span class="count">${cards[ci].length}</span></h4>
        ${cards[ci].map(({ o, i }) => {
          const age = mins(now - new Date(o.createdAt));
          const nextName = ci === 0 ? (stages[0]?.name || 'Pronto') : (stages[ci] ? stages[ci].name : 'Pronto');
          return `<div class="kds-card ${o.type}">
            <div class="top"><b>#${o.id}</b> ${typeChip(o.type)}<span class="${age > 30 ? 'late' : 'muted'}">${age} min</span></div>
            <div class="muted">${o.Table ? 'Mesa ' + o.Table.number : esc(o.Customer?.name || o.Neighborhood?.name || '')}</div>
            <div><b>${i.quantity}x</b> ${esc(i.description || i.Product?.name)}</div>
            ${i.observations ? `<div><i>${esc(i.observations)}</i></div>` : ''}
            <button class="btn ${ci === 0 ? '' : 'ok'} sm" data-adv="${i.id}">→ ${esc(nextName)}</button></div>`;
        }).join('') || '<p class="muted">Vazio</p>'}
      </div>`).join('')}</div>`;
    document.querySelectorAll('[data-adv]').forEach(b => b.onclick = safe(async () => {
      await api(`/kitchen/items/${b.dataset.adv}/advance`, 'POST'); load();
    }));
  });
  await load();
  timer = setInterval(load, 5000);
}

// ---------- Produtos (nao-pizza) ----------
async function viewProdutos() {
  let q = ''; let cat = '';
  const [products, cats] = await Promise.all([api('/products?all=1'), api('/products/categories')]);
  const admin = me.role === 'admin';
  const draw = () => {
    const rows = products.filter(p => (!cat || String(p.CategoryId) === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
    view().innerHTML = `
      ${admin ? `<div class="card"><h3>Novo produto</h3><div class="row">
        <input id="n" placeholder="Nome"><input id="d" placeholder="Descricao">
        <input id="pr" type="number" step="0.01" placeholder="Preco" style="width:100px">
        <select id="c">${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <input id="st" type="number" placeholder="Estoque (opcional)" style="width:150px">
        <label><input type="checkbox" id="kit" checked> Passa pela cozinha</label>
        <button class="btn" id="add">Adicionar</button></div>
        <div class="row"><input id="nc" placeholder="Nova categoria"><button class="btn sec" id="addc">Criar categoria</button></div></div>` : ''}
      <div class="card"><div class="row"><input id="q" placeholder="Buscar produto" value="${esc(q)}">
        <select id="fc"><option value="">Todas as categorias</option>${cats.map(c => `<option value="${c.id}" ${String(c.id) === cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <span class="muted">${rows.length} produtos</span></div>
      <div class="scroll" style="max-height:560px"><table><tr><th>Produto</th><th>Categoria</th><th>Preco</th><th>Estoque</th><th>Cozinha</th><th></th></tr>
      ${rows.map(p => `<tr style="${p.active ? '' : 'opacity:.4'}"><td>${esc(p.name)}</td><td>${esc(p.Category?.name || '')}</td><td>${brl(p.price)}</td>
        <td>${p.stockControl ? p.stock : '-'}</td><td>${p.kitchen ? 'sim' : 'nao'}</td>
        <td>${admin ? `<button class="btn sec sm" data-e="${p.id}">Preco</button> <button class="btn sec sm" data-del="${p.id}">Desativar</button>` : ''}</td></tr>`).join('')}</table></div></div>`;
    $('q').oninput = debounce(() => { q = $('q').value; draw(); const e = $('q'); e.focus(); e.setSelectionRange(e.value.length, e.value.length); }, 200);
    $('fc').onchange = () => { cat = $('fc').value; draw(); };
    if (!admin) return;
    $('add').onclick = safe(async () => {
      const st = $('st').value;
      await api('/products', 'POST', { name: $('n').value, description: $('d').value, price: $('pr').value, CategoryId: $('c').value, kitchen: $('kit').checked, stockControl: st !== '', stock: st === '' ? 0 : +st });
      render();
    });
    $('addc').onclick = safe(async () => { if ($('nc').value) { await api('/products/categories', 'POST', { name: $('nc').value }); render(); } });
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = safe(async () => { await api('/products/' + b.dataset.del, 'DELETE'); render(); }));
    document.querySelectorAll('[data-e]').forEach(b => b.onclick = safe(async () => {
      const v = prompt('Novo preco:'); if (v) { await api('/products/' + b.dataset.e, 'PUT', { price: v }); render(); }
    }));
  };
  draw();
}

// ---------- Clientes ----------
async function viewClientes() {
  const bairros = await api('/config/neighborhoods');
  view().innerHTML = `
    <div class="card"><h3>Novo cliente</h3><div class="row">
      <input id="n" placeholder="Nome"><input id="t" placeholder="Telefone"><input id="a" placeholder="Endereco">
      <select id="b"><option value="">Bairro...</option>${bairros.map(b => `<option>${esc(b.name)}</option>`).join('')}</select>
      <button class="btn" id="add">Adicionar</button></div></div>
    <div class="card"><div class="row"><input id="q" placeholder="Buscar por nome ou telefone" style="width:320px"><span class="muted" id="cnt"></span></div>
      <div id="list"></div></div>`;
  const search = safe(async () => {
    const list = await api('/customers?limit=100&q=' + encodeURIComponent($('q').value.trim()));
    $('cnt').textContent = list.length === 100 ? 'mostrando 100 (refine a busca)' : `${list.length} cliente(s)`;
    $('list').innerHTML = `<table><tr><th>Nome</th><th>Telefone</th><th>Endereco</th><th>Bairro</th></tr>
      ${list.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.address)}</td><td>${esc(c.neighborhood)}</td></tr>`).join('')}</table>`;
  });
  $('q').oninput = debounce(search, 250);
  $('add').onclick = safe(async () => {
    if (!$('n').value) return toast('Nome obrigatorio');
    await api('/customers', 'POST', { name: $('n').value, phone: $('t').value, address: $('a').value, neighborhood: $('b').value });
    toast('Cliente adicionado'); search();
  });
  search();
}

// ---------- Cadastros (admin) ----------
async function viewCadastros() {
  const load = safe(async () => {
    const [menu, bairros, couriers, stages, payments] = await Promise.all([
      api('/pizza/menu'), api('/config/neighborhoods'), api('/config/couriers'), api('/config/stages'), api('/config/payment-methods'),
    ]);
    const { sizes, flavors, crusts } = menu;
    view().innerHTML = `
      <div class="card"><h3>Tamanhos</h3>
        <table><tr><th>Nome</th><th>Max. sabores</th><th></th></tr>${sizes.map(s => `<tr><td>${esc(s.name)}</td><td>${s.maxFlavors}</td><td><button class="btn sec sm" data-del="/pizza/sizes|${s.id}">Desativar</button></td></tr>`).join('')}</table>
        <div class="row" style="margin-top:8px"><input id="sn" placeholder="Nome"><input id="sm" type="number" min="1" value="1" style="width:90px"><button class="btn" id="sadd">Adicionar</button></div></div>

      <div class="card"><h3>Sabores e precos por tamanho (${flavors.length})</h3>
        <div class="row"><input id="ff" placeholder="Filtrar sabor"></div>
        <div class="scroll" style="max-height:420px"><table id="ft"><tr><th>Sabor</th>${sizes.map(s => `<th>${esc(s.name)}</th>`).join('')}<th></th></tr>
        ${flavors.map(f => `<tr data-name="${esc(f.name.toLowerCase())}"><td>${esc(f.name)}</td>${sizes.map(s => {
          const p = f.prices.find(x => x.SizeId === s.id);
          return `<td><input class="pr" type="number" step="0.01" style="width:80px" data-f="${f.id}" data-s="${s.id}" value="${p ? p.price : ''}"></td>`;
        }).join('')}<td><button class="btn sec sm" data-del="/pizza/flavors|${f.id}">Desativar</button></td></tr>`).join('')}</table></div>
        <div class="row" style="margin-top:8px"><button class="btn" id="saveprices">Salvar precos</button></div>
        <div class="row"><input id="fn" placeholder="Novo sabor"><input id="fd" placeholder="Ingredientes" style="flex:1">
          <select id="fk"><option value="salgada">Salgada</option><option value="doce">Doce</option></select>
          ${sizes.map(s => `<input class="np" data-s="${s.id}" type="number" step="0.01" placeholder="${esc(s.name)}" style="width:100px">`).join('')}
          <button class="btn" id="fadd">Adicionar sabor</button></div></div>

      <div class="card"><h3>Bordas</h3>
        <table>${crusts.map(c => `<tr><td>${esc(c.name)}</td><td>${brl(c.price)}</td><td><button class="btn sec sm" data-del="/pizza/crusts|${c.id}">Desativar</button></td></tr>`).join('')}</table>
        <div class="row" style="margin-top:8px"><input id="cn" placeholder="Nome"><input id="cp" type="number" step="0.01" placeholder="Preco" style="width:100px"><button class="btn" id="cadd">Adicionar</button></div></div>

      <div class="card"><h3>Bairros e taxa de entrega (${bairros.length})</h3>
        <div class="row"><input id="bfl" placeholder="Filtrar bairro"><input id="allfee" type="number" step="0.5" placeholder="Taxa p/ todos" style="width:130px"><button class="btn sec" id="applyall">Aplicar a todos</button></div>
        <div class="scroll" style="max-height:320px"><table id="bt">${bairros.map(b => `<tr data-name="${esc(b.name.toLowerCase())}"><td>${esc(b.name)}</td><td><input type="number" step="0.5" style="width:90px" data-fee="${b.id}" value="${b.fee}"></td><td><button class="btn sec sm" data-del="/config/neighborhoods|${b.id}">Desativar</button></td></tr>`).join('')}</table></div>
        <div class="row" style="margin-top:8px"><button class="btn" id="savefees">Salvar taxas</button></div>
        <div class="row"><input id="bn" placeholder="Bairro"><input id="bf" type="number" step="0.5" placeholder="Taxa" style="width:100px"><button class="btn" id="badd">Adicionar</button></div></div>

      <div class="card"><h3>Formas de pagamento</h3>
        <table>${payments.map(p => `<tr><td>${esc(p.name)}</td><td><button class="btn sec sm" data-del="/config/payment-methods|${p.id}">Desativar</button></td></tr>`).join('')}</table>
        <div class="row" style="margin-top:8px"><input id="pn" placeholder="Nova forma"><button class="btn" id="padd">Adicionar</button></div></div>

      <div class="card"><h3>Entregadores</h3>
        <table>${couriers.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone || '')}</td><td><button class="btn sec sm" data-del="/config/couriers|${c.id}">Desativar</button></td></tr>`).join('') || '<tr><td class="muted">Nenhum entregador cadastrado</td></tr>'}</table>
        <div class="row" style="margin-top:8px"><input id="en" placeholder="Nome"><input id="ep" placeholder="Telefone"><button class="btn" id="eadd">Adicionar</button></div></div>

      <div class="card"><h3>Etapas da cozinha (KDS)</h3>
        <table><tr><th>Ordem</th><th>Etapa</th><th>Meta (min)</th><th></th></tr>${stages.map(s => `<tr><td>${s.position}</td><td>${esc(s.name)}</td><td>${s.targetMinutes}</td><td><button class="btn sec sm" data-del="/config/stages|${s.id}">Desativar</button></td></tr>`).join('')}</table>
        <div class="row" style="margin-top:8px"><input id="kn" placeholder="Nome"><input id="kp" type="number" placeholder="Ordem" value="${stages.length + 1}" style="width:80px"><input id="kt" type="number" placeholder="Meta min" value="5" style="width:90px"><button class="btn" id="kadd">Adicionar</button></div></div>`;

    document.querySelectorAll('[data-del]').forEach(b => { const [u, id] = b.dataset.del.split('|'); b.onclick = safe(async () => { if (confirm('Desativar?')) { await api(`${u}/${id}`, 'DELETE'); load(); } }); });
    const filter = (inputId, tableId) => { $(inputId).oninput = () => { const q = $(inputId).value.toLowerCase(); document.querySelectorAll(`#${tableId} tr[data-name]`).forEach(r => r.style.display = r.dataset.name.includes(q) ? '' : 'none'); }; };
    filter('ff', 'ft'); filter('bfl', 'bt');
    $('sadd').onclick = safe(async () => { await api('/pizza/sizes', 'POST', { name: $('sn').value, maxFlavors: +$('sm').value }); load(); });
    $('cadd').onclick = safe(async () => { await api('/pizza/crusts', 'POST', { name: $('cn').value, price: $('cp').value || 0 }); load(); });
    $('badd').onclick = safe(async () => { await api('/config/neighborhoods', 'POST', { name: $('bn').value, fee: $('bf').value || 0 }); load(); });
    $('padd').onclick = safe(async () => { await api('/config/payment-methods', 'POST', { name: $('pn').value }); load(); });
    $('eadd').onclick = safe(async () => { await api('/config/couriers', 'POST', { name: $('en').value, phone: $('ep').value }); load(); });
    $('kadd').onclick = safe(async () => { await api('/config/stages', 'POST', { name: $('kn').value, position: +$('kp').value, targetMinutes: +$('kt').value }); load(); });
    $('fadd').onclick = safe(async () => {
      const prices = {}; document.querySelectorAll('.np').forEach(i => { if (i.value !== '') prices[i.dataset.s] = i.value; });
      await api('/pizza/flavors', 'POST', { name: $('fn').value, description: $('fd').value, kind: $('fk').value, prices }); load();
    });
    $('saveprices').onclick = safe(async () => {
      const byFlavor = {};
      document.querySelectorAll('.pr').forEach(i => { (byFlavor[i.dataset.f] ||= {})[i.dataset.s] = i.value; });
      for (const [id, prices] of Object.entries(byFlavor)) await api('/pizza/flavors/' + id, 'PUT', { prices });
      toast('Precos salvos'); load();
    });
    $('applyall').onclick = () => { const v = $('allfee').value; if (v !== '') document.querySelectorAll('[data-fee]').forEach(i => i.value = v); };
    $('savefees').onclick = safe(async () => {
      for (const i of document.querySelectorAll('[data-fee]')) await api('/config/neighborhoods/' + i.dataset.fee, 'PUT', { fee: i.value });
      toast('Taxas salvas'); load();
    });
  });
  await load();
}

// ---------- Dashboard (indicadores do Dashboard do EiChefe) ----------
async function viewDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  view().innerHTML = `<div class="card"><div class="row"><b>Periodo:</b> <input type="date" id="f" value="${week}"> ate <input type="date" id="t" value="${today}"><button class="btn" id="go">Filtrar</button></div></div><div id="rep"></div>`;
  const list = (rows, fmt = v => v) => rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right">${fmt(v)}</td></tr>`).join('') || '<tr><td class="muted">Sem dados</td></tr>';
  const top = arr => list(arr.map(x => [x.name, x.qty.toFixed(x.qty % 1 ? 1 : 0)]));
  const load = safe(async () => {
    const r = await api(`/reports/sales?from=${$('f').value}&to=${$('t').value}`);
    const maxH = Math.max(...r.byHour, 1);
    $('rep').innerHTML = `
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
        <div class="card kpi"><div class="label">Vendas (R$)</div><div class="value">${brl(r.total)}</div></div>
        <div class="card kpi"><div class="label">Numero de vendas</div><div class="value">${r.count}</div></div>
        <div class="card kpi"><div class="label">Ticket medio</div><div class="value">${brl(r.ticketMedio)}</div></div>
        <div class="card kpi salao"><div class="label">Salao</div><div class="value">${brl(r.byType.mesa)}</div></div>
        <div class="card kpi delivery"><div class="label">Delivery</div><div class="value">${brl(r.byType.delivery)}</div></div>
        <div class="card kpi balcao"><div class="label">Retirada / Balcao</div><div class="value">${brl(r.byType.balcao)}</div></div>
        <div class="card kpi"><div class="label">Preparo medio</div><div class="value">${r.avgPrepMinutes.toFixed(1)} min</div></div>
        <div class="card kpi"><div class="label">Entrega media</div><div class="value">${r.avgDeliveryMinutes.toFixed(1)} min</div></div>
      </div>
      <div class="split">
        <div class="card"><h3>Vendas por horario</h3><div class="bars" style="margin-bottom:22px">${r.byHour.map((v, h) => `<div class="bar" title="${h}h: ${brl(v)}" style="height:${(v / maxH) * 100}%"><span>${h}</span></div>`).join('')}</div>
          <h3>Vendas por dia</h3><table>${list(Object.entries(r.byDay), brl)}</table></div>
        <div class="card"><h3>Total por pagamento</h3><table>${list(Object.entries(r.byPayment), brl)}</table>
          <h3 style="margin-top:14px">Top entregadores</h3><table>${list(Object.entries(r.couriers).map(([n, c]) => [n, `${c.count} entregas / ${brl(c.fees)}`]))}</table></div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
        <div class="card"><h3>Top pizzas (sabores)</h3><table>${top(r.topFlavors)}</table></div>
        <div class="card"><h3>Top comidas</h3><table>${top(r.topFood)}</table></div>
        <div class="card"><h3>Top bebidas</h3><table>${top(r.topDrinks)}</table></div>
      </div>`;
  });
  $('go').onclick = load;
  load();
}

// Converte as tags ESC/POS do EiChefe ({B}, {DH}, {BIG}) em spans estilizados (TUDO EM NEGRITO)
function formatThermalEscPos(text) {
  return esc(text || '')
    .replace(/\{BIG\}([\s\S]*?)\{\/BIG\}/g, '<span class="esc-big">$1</span>')
    .replace(/\{DH\}([\s\S]*?)\{\/DH\}/g, '<span class="esc-dh">$1</span>')
    .replace(/\{B\}([\s\S]*?)\{\/B\}/g, '<span class="esc-b">$1</span>');
}

// Imprime os cupons térmicos em janela/iframe limpa (sem corte de modal/scroll e com tudo em negrito)
function printThermalJobs(jobs) {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: 72mm auto; margin: 0mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    max-width: 72mm;
    background: #fff;
    color: #000;
    font-family: 'Courier New', Consolas, monospace;
    font-size: 12.5px;
    font-weight: 800;
    line-height: 1.28;
  }
  .ticket {
    width: 100%;
    padding: 2mm 2mm 8mm 2mm;
    white-space: pre-wrap;
    word-break: break-word;
    font-weight: 800;
    page-break-after: always;
  }
  .ticket:last-child { page-break-after: auto; }
  .esc-b { font-weight: 900; }
  .esc-dh {
    display: inline-block;
    font-size: 15px;
    font-weight: 900;
    line-height: 1.3;
  }
  .esc-big {
    display: block;
    font-size: 18px;
    font-weight: 900;
    line-height: 1.28;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
</head>
<body>
  ${jobs.map(j => `<div class="ticket">${formatThermalEscPos(j.content)}</div>`).join('')}
</body>
</html>`;

  let frame = document.getElementById('thermal-print-frame');
  if (frame) frame.remove();
  frame = document.createElement('iframe');
  frame.id = 'thermal-print-frame';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }, 150);
}

// ---------- Visualização de Bobina Térmica + Impressão Estilo EiChefe ----------
function openThermalPreviewModal(jobs, title = 'Impressão Térmica') {
  if (!jobs || !jobs.length) return toast('Nenhum cupom gerado');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };

  overlay.innerHTML = `<div class="modal" style="max-width:420px">
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <h3 style="margin:0;font-size:15px">🖨️ ${esc(title)}</h3>
      <div class="row" style="margin:0;gap:6px">
        <button class="btn ok sm" id="btn-browser-print">🖨️ Imprimir</button>
        <button class="btn sec sm" data-close>Fechar</button>
      </div>
    </div>
    <div id="thermal-print-area" class="scroll" style="max-height:74vh">
      ${jobs.map(j => `
        <div class="thermal-meta">
          <span><b>${esc(j.printer_name)}</b> → <code>${esc(j.printer_path)}</code></span>
          <span class="badge pronto">Tudo em Negrito</span>
        </div>
        <div class="thermal-roll">${formatThermalEscPos(j.content)}</div>
      `).join('')}
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-close]').onclick = close;
  overlay.querySelector('#btn-browser-print').onclick = () => printThermalJobs(jobs);
}

// ---------- Impressoras Térmicas (Idêntico ao impressoras.tpl + roteamento do EiChefe) ----------
async function viewImpressoras() {
  const IFACE_NAMES = { 3: 'USB / Spooler Windows', 4: 'Rede TCP/IP (Socket 9100)' };
  const MODEL_NAMES = { 11: 'Bematech (ESC/Bema)', 13: 'Epson (ESC/POS)' };
  const SEP_NAMES = { n: 'Agrupado na mesma comanda', p: 'Separado por Produto (1 ficha por item)' };

  const load = safe(async () => {
    const { servers, physical, printers, categories, jobs } = await api('/printers');
    view().innerHTML = `
      <div class="card">
        <h3>SERVIDORES DE IMPRESSÃO (impressoraservidor)</h3>
        <p class="muted">No EiChefe, o PHP grava os cupons na fila <code>impressao</code> e envia via Socket para o agente Java na porta <code>9998</code> ou direto via TCP/IP <code>9100</code>.</p>
        <table>
          <tr><th>NOME</th><th>ENDEREÇO IP</th><th>PORTA</th><th>TIPO</th><th>STATUS SOCKET</th><th>AÇÃO</th></tr>
          ${servers.map(s => `<tr class="eichefe-printer-row">
            <td><b>${esc(s.name)}</b></td>
            <td><code>${esc(s.ip)}</code></td>
            <td><code>${s.port}</code></td>
            <td style="text-transform:uppercase">${esc(s.type)}</td>
            <td><span id="srv-st-${s.id}" class="muted">Verificando...</span></td>
            <td><button class="btn sec sm" data-tsrv="${s.id}">Testar Socket</button></td>
          </tr>`).join('')}
        </table>
      </div>

      <div class="card">
        <h3>IMPRESSORAS FÍSICAS (impressorafisica)</h3>
        <table>
          <tr><th>#</th><th>NOME DA IMPRESSORA</th><th>CAMINHO / IP</th><th>COLUNAS (NR LINHAS)</th><th>MODELO / ESC</th><th>INTERFACE</th><th>SERVIDOR</th><th>STATUS</th><th>AÇÃO</th></tr>
          ${physical.map(p => `<tr class="eichefe-printer-row">
            <td><b>#${p.id}</b></td>
            <td><b>${esc(p.name)}</b></td>
            <td><input data-ppath="${p.id}" value="${esc(p.path)}" style="width:145px"></td>
            <td><input type="number" data-pcols="${p.id}" value="${p.columns}" style="width:70px"> cols</td>
            <td>${esc(MODEL_NAMES[p.model_code] || p.char_type.toUpperCase())}</td>
            <td>${esc(IFACE_NAMES[p.interface_type] || ' Padrão')}</td>
            <td>${esc(p.server?.name || 'Caixa')}</td>
            <td><span id="phys-st-${p.id}" class="muted">Verificando...</span></td>
            <td>
              <button class="btn sm" data-savephys="${p.id}">Salvar</button>
              <button class="btn ok sm" data-tprint="${p.id}">🖨️ Testar</button>
            </td>
          </tr>`).join('')}
        </table>
      </div>

      <div class="split">
        <div class="card">
          <h3>SETORES / IMPRESSORAS LÓGICAS (impressora)</h3>
          <p class="muted">Mapeia os setores de produção para uma impressora física, definindo guilhotina e aviso sonoro (beep).</p>
          <table>
            <tr><th>#</th><th>SETOR</th><th>IMPRESSORA FÍSICA DESTINO</th><th>GUILHOTINA</th><th>BEEP</th><th>TESTAR</th></tr>
            ${printers.map(l => `<tr>
              <td><b>#${l.id}</b></td>
              <td><b>${esc(l.name)}</b></td>
              <td>
                <select data-lphys="${l.id}">
                  ${physical.map(p => `<option value="${p.id}" ${p.id === l.PhysicalPrinterId ? 'selected' : ''}>#${p.id} ${esc(p.name)} (${esc(p.path)})</option>`).join('')}
                </select>
              </td>
              <td>${l.cutter === '2' ? 'Corte Total' : l.cutter === '1' ? 'Parcial' : 'Não'}</td>
              <td>${l.beep}x</td>
              <td><button class="btn sec sm" data-tlprint="${l.id}">🖨️ Testar</button></td>
            </tr>`).join('')}
          </table>
        </div>

        <div class="card">
          <div class="row" style="justify-content:space-between">
            <h3 style="margin:0">ROTEAMENTO POR CATEGORIA (subcategoria)</h3>
            <button class="btn ok sm" id="save-routing">Salvar Roteamento</button>
          </div>
          <p class="muted">Define em qual impressora cada categoria sai e se imprime ficha separada por produto (<code>imprimirSeparado = 'p'</code>).</p>
          <div class="scroll" style="max-height:310px">
            <table>
              <tr><th>CATEGORIA</th><th>IMPRESSORA (codimpressora)</th><th>MODO DE IMPRESSÃO</th></tr>
              ${categories.map(c => `<tr>
                <td><b>${esc(c.name)}</b></td>
                <td>
                  <select data-cat-p="${c.id}">
                    ${printers.map(l => `<option value="${l.id}" ${l.id === c.PrinterId ? 'selected' : ''}>#${l.id} ${esc(l.name)} (${esc(l.physical?.path || '')})</option>`).join('')}
                  </select>
                </td>
                <td>
                  <select data-cat-s="${c.id}">
                    ${Object.entries(SEP_NAMES).map(([k, v]) => `<option value="${k}" ${k === (c.print_separate || 'n') ? 'selected' : ''}>${esc(v)}</option>`).join('')}
                  </select>
                </td>
              </tr>`).join('')}
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>FILA E HISTÓRICO DE IMPRESSÕES TÉRMICAS (tabela impressao / vendaimpressa)</h3>
        <table>
          <tr><th>#Job</th><th>Data/Hora</th><th>Pedido</th><th>Tipo</th><th>Impressora Destino</th><th>Caminho / IP</th><th>Operador</th><th>Status</th><th>Ação</th></tr>
          ${jobs.map(j => `<tr>
            <td><b>#${j.id}</b></td>
            <td>${new Date(j.createdAt).toLocaleString('pt-BR')}</td>
            <td>${j.order_id ? `<b>#${j.order_id}</b>` : '-'}</td>
            <td><span class="badge pronto">${esc(j.job_type.toUpperCase())}</span> ${j.reprinted ? '<span class="muted">(Reimp.)</span>' : ''}</td>
            <td>${esc(j.printer_name)}</td>
            <td><code>${esc(j.printer_path)}</code></td>
            <td>${esc(j.operator_name || '-')}</td>
            <td><span class="impressoraOn">Enviado (${esc(j.status)})</span></td>
            <td><button class="btn sec sm" data-vjob="${j.id}">👁️ Ver Cupom</button></td>
          </tr>`).join('') || '<tr><td colspan="9" class="muted">Nenhuma impressão registrada ainda. Clique em "Testar" acima ou imprima um pedido.</td></tr>'}
        </table>
      </div>
    `;

    // Auto-testa status de sockets e impressoras físicas igual ao jQuery(function(){ testarSocketNovamente... }) do impressoras.tpl
    const checkSrv = async (id) => {
      const el = $(`srv-st-${id}`);
      if (!el) return;
      el.textContent = 'Testando...';
      const r = await api('/printers/test-status', 'POST', { kind: 'server', id });
      el.className = r.online ? 'impressoraOn' : 'impressoraOff';
      el.textContent = r.online ? `ONLINE (${r.detail})` : `OFFLINE (${r.detail})`;
    };
    const checkPhys = async (id) => {
      const el = $(`phys-st-${id}`);
      if (!el) return;
      el.textContent = 'Testando...';
      const r = await api('/printers/test-status', 'POST', { kind: 'physical', id });
      el.className = r.online ? 'impressoraOn' : 'impressoraOff';
      el.textContent = r.online ? `ONLINE (${r.detail})` : `FILA LOCAL (${r.detail})`;
    };
    servers.forEach(s => checkSrv(s.id));
    physical.forEach(p => checkPhys(p.id));

    document.querySelectorAll('[data-tsrv]').forEach(b => b.onclick = () => checkSrv(+b.dataset.tsrv));
    document.querySelectorAll('[data-savephys]').forEach(b => b.onclick = safe(async () => {
      const id = +b.dataset.savephys;
      const path = document.querySelector(`[data-ppath="${id}"]`).value;
      const columns = +document.querySelector(`[data-pcols="${id}"]`).value;
      await api(`/printers/physical/${id}`, 'PUT', { path, columns });
      toast('Impressora física atualizada!');
      checkPhys(id);
    }));
    document.querySelectorAll('[data-lphys]').forEach(sel => sel.onchange = safe(async () => {
      await api(`/printers/logical/${sel.dataset.lphys}`, 'PUT', { PhysicalPrinterId: +sel.value });
      toast('Setor vinculado à impressora física!');
    }));
    document.querySelectorAll('[data-tprint]').forEach(b => b.onclick = safe(async () => {
      const r = await api(`/printers/test-print/${b.dataset.tprint}`, 'POST');
      toast(r.hwDetail);
      openThermalPreviewModal([r.job], 'Teste de Impressora Física');
      load();
    }));
    document.querySelectorAll('[data-tlprint]').forEach(b => b.onclick = safe(async () => {
      const r = await api(`/printers/test-print/${b.dataset.tlprint}`, 'POST');
      toast(r.hwDetail);
      openThermalPreviewModal([r.job], 'Teste de Impressora de Setor');
      load();
    }));
    $('save-routing').onclick = safe(async () => {
      const mappings = categories.map(c => ({
        categoryId: c.id,
        PrinterId: +document.querySelector(`[data-cat-p="${c.id}"]`).value,
        print_separate: document.querySelector(`[data-cat-s="${c.id}"]`).value,
      }));
      await api('/printers/routing', 'PUT', { mappings });
      toast('Roteamento de impressão salvo!');
      load();
    });
    document.querySelectorAll('[data-vjob]').forEach(b => b.onclick = () => {
      const job = jobs.find(x => x.id === +b.dataset.vjob);
      if (job) openThermalPreviewModal([job], `Cupom #${job.id} — ${job.printer_name}`);
    });
  });
  await load();
}

// ---------- Funcionários (Cadastro e Permissões idênticos ao EiChefe Gestão) ----------
async function viewFuncionarios() {
  const load = safe(async () => {
    const [employees, cargos] = await Promise.all([
      api('/employees'),
      api('/employees/cargos'),
    ]);

    const total = employees.length;
    const ativos = employees.filter(e => e.active).length;
    const comCaixa = employees.filter(e => e.comCaixa && e.active).length;
    const comComissao = employees.filter(e => e.comissao && e.active).length;

    // Helpers para estilizar badges de cargo
    const getCargoBadgeClass = (nome = '') => {
      const n = nome.toLowerCase();
      if (n.includes('gerente')) return 'badge-cargo gerente';
      if (n.includes('caixa')) return 'badge-cargo caixa';
      if (n.includes('garçom') || n.includes('garcom')) return 'badge-cargo garcom';
      if (n.includes('atendente')) return 'badge-cargo atendente';
      if (n.includes('cozinha') || n.includes('kds')) return 'badge-cargo cozinha';
      if (n.includes('entregador')) return 'badge-cargo entregador';
      return 'badge-cargo';
    };

    view().innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="margin:0;font-size:22px;color:var(--text);display:flex;align-items:center;gap:8px">
            👥 Cadastro de Funcionários
            <span class="badge" style="font-size:13px;background:#e9ecef">${total} cadastrados</span>
          </h2>
          <span class="muted" style="font-size:13px">Gestão de colaboradores, cargos, níveis de acesso, caixas e comissões integrados ao EiChefe</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ok" id="btn-new-emp" style="display:flex;align-items:center;gap:6px">
            <span>➕</span> Novo Funcionário
          </button>
          <button class="btn sec" id="btn-sync-eichefe" style="display:flex;align-items:center;gap:6px" title="Importa/Atualiza os funcionários diretamente do banco do EiChefe">
            <span>📥</span> Sincronizar EiChefe
          </button>
        </div>
      </div>

      <!-- KPIs do Módulo de Funcionários -->
      <div class="emp-kpi-grid">
        <div class="emp-kpi-card">
          <div class="emp-lbl">Total Colaboradores</div>
          <div class="emp-val">${total}</div>
        </div>
        <div class="emp-kpi-card ok">
          <div class="emp-lbl">Ativos no Sistema</div>
          <div class="emp-val" style="color:var(--success)">${ativos}</div>
        </div>
        <div class="emp-kpi-card caixa">
          <div class="emp-lbl">Operadores de Caixa</div>
          <div class="emp-val" style="color:#0056b3">${comCaixa}</div>
        </div>
        <div class="emp-kpi-card comissao">
          <div class="emp-lbl">Recebem Comissão</div>
          <div class="emp-val" style="color:#fd7e14">${comComissao}</div>
        </div>
      </div>

      <!-- Card com Filtros e Tabela de Funcionários -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <div style="display:flex;gap:10px;flex-wrap:wrap;flex:1">
            <input id="emp-filter-q" placeholder="🔍 Buscar por nome, usuário ou cargo..." style="min-width:260px;flex:1">
            <select id="emp-filter-cargo" style="width:170px">
              <option value="">Todos os Cargos</option>
              ${cargos.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select>
            <select id="emp-filter-status" style="width:150px">
              <option value="">Todos os Status</option>
              <option value="true" selected>Apenas Ativos</option>
              <option value="false">Apenas Inativos</option>
            </select>
          </div>
          <div class="muted" id="emp-count-info">${ativos} funcionários listados</div>
        </div>

        <div class="scroll" style="max-height:560px">
          <table id="emp-table">
            <thead>
              <tr>
                <th style="width:90px">Status</th>
                <th>Nome / Usuário</th>
                <th>Cargo / Função</th>
                <th>Opera Caixa</th>
                <th>Comissão</th>
                <th>Acessos Especiais</th>
                <th>PIN / Crachá</th>
                <th style="text-align:right">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${renderEmployeeRows(employees, getCargoBadgeClass)}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Filtros em tempo real no cliente
    const applyFilter = () => {
      const q = ($('emp-filter-q').value || '').toLowerCase().trim();
      const selCargo = $('emp-filter-cargo').value;
      const selStatus = $('emp-filter-status').value;

      const filtered = employees.filter(e => {
        const matchesQ = !q || (e.name && e.name.toLowerCase().includes(q)) || (e.username && e.username.toLowerCase().includes(q)) || (e.cargoNome && e.cargoNome.toLowerCase().includes(q));
        const matchesCargo = !selCargo || String(e.cargoId) === selCargo;
        const matchesStatus = selStatus === '' || String(e.active) === selStatus;
        return matchesQ && matchesCargo && matchesStatus;
      });

      document.querySelector('#emp-table tbody').innerHTML = renderEmployeeRows(filtered, getCargoBadgeClass);
      $('emp-count-info').textContent = `${filtered.length} funcionários encontrados`;
      bindRowActions();
    };

    $('emp-filter-q').oninput = applyFilter;
    $('emp-filter-cargo').onchange = applyFilter;
    $('emp-filter-status').onchange = applyFilter;

    // Ações
    $('btn-new-emp').onclick = () => openEmployeeModal(null, cargos, load);
    $('btn-sync-eichefe').onclick = safe(async () => {
      if (!confirm('Deseja sincronizar e importar os funcionários cadastrados no banco do EiChefe?')) return;
      toast('Sincronizando com EiChefe MySQL...');
      const r = await api('/employees/sync-eichefe', 'POST');
      toast(r.message || `${r.imported} importados, ${r.updated} atualizados`);
      load();
    });

    const bindRowActions = () => {
      document.querySelectorAll('[data-edit-emp]').forEach(b => {
        b.onclick = () => {
          const emp = employees.find(x => x.id === +b.dataset.editEmp);
          if (emp) openEmployeeModal(emp, cargos, load);
        };
      });
      document.querySelectorAll('[data-toggle-emp]').forEach(b => {
        b.onclick = safe(async () => {
          const id = +b.dataset.toggleEmp;
          const emp = employees.find(x => x.id === id);
          const actionText = emp?.active ? 'desativar' : 'ativar';
          if (!confirm(`Deseja ${actionText} o colaborador ${emp?.name || ''}?`)) return;
          const r = await api(`/employees/${id}/toggle-active`, 'PATCH');
          toast(r.message);
          load();
        });
      });
    };

    bindRowActions();
  });

  await load();
}

function renderEmployeeRows(list, getCargoBadgeClass) {
  if (!list.length) {
    return '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">Nenhum funcionário encontrado</td></tr>';
  }
  return list.map(e => `
    <tr style="${!e.active ? 'opacity:0.65;background:#fcfcfc' : ''}">
      <td>
        <span class="status-pill ${e.active ? 'ativo' : 'inativo'}">
          ${e.active ? '● Ativo' : '○ Inativo'}
        </span>
      </td>
      <td>
        <div style="font-weight:700;color:var(--text);font-size:14px">${esc(e.name)}</div>
        <div class="muted" style="font-size:12px">@${esc(e.username)}</div>
      </td>
      <td>
        <span class="${getCargoBadgeClass(e.cargoNome)}">
          ${esc(e.cargoNome || 'Garçom')}
        </span>
      </td>
      <td>
        ${e.comCaixa ? '<span style="color:#0056b3;font-weight:700">💵 Sim</span>' : '<span class="muted">Não</span>'}
      </td>
      <td>
        ${e.comissao ? `<span style="color:#fd7e14;font-weight:700">⭐ ${Number(e.taxaCalculo || 10).toFixed(1)}%</span>` : '<span class="muted">Não</span>'}
      </td>
      <td>
        ${e.acessoFinanceiro ? '<span class="perm-tag on" title="Acesso aos relatórios financeiros">📊 Financeiro</span>' : ''}
        ${e.acessoEstoque ? '<span class="perm-tag on" title="Acesso ao controle de estoque">📦 Estoque</span>' : ''}
        ${!e.acessoFinanceiro && !e.acessoEstoque ? '<span class="muted" style="font-size:11px">Padrão</span>' : ''}
      </td>
      <td>
        ${e.pin ? `<span style="font-family:monospace;background:#f1f2f8;padding:2px 6px;border-radius:4px">PIN: ${esc(e.pin)}</span>` : ''}
        ${e.codigoInterno ? `<span class="muted" style="font-size:11px;display:block">ID: ${e.codigoInterno}</span>` : ''}
        ${!e.pin && !e.codigoInterno ? '<span class="muted">-</span>' : ''}
      </td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn sec sm" data-edit-emp="${e.id}" style="margin-right:4px">✏️ Editar</button>
        <button class="btn ${e.active ? 'sec' : 'ok'} sm" data-toggle-emp="${e.id}">
          ${e.active ? 'Desativar' : 'Ativar'}
        </button>
      </td>
    </tr>
  `).join('');
}

// Modal Completo de Cadastro / Edição de Funcionário Estilo EiChefe
function openEmployeeModal(emp, cargos, onSaved) {
  const isEdit = Boolean(emp);
  const overlay = document.createElement('div');
  overlay.className = 'overlay';

  overlay.innerHTML = `
    <div class="modal" style="max-width:580px;width:95%">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #e9ecef;padding-bottom:10px;margin-bottom:16px">
        <h3 style="margin:0;font-size:18px;color:var(--text)">
          ${isEdit ? `✏️ Editar Funcionário: ${esc(emp.name)}` : '➕ Novo Funcionário (Estilo EiChefe)'}
        </h3>
        <button type="button" class="btn sec sm" data-close style="border:0;font-size:16px;cursor:pointer">✕</button>
      </div>

      <form id="form-emp" onsubmit="return false">
        <!-- Dados Básicos -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;color:var(--muted)">NOME COMPLETO *</label>
            <input id="emp-name" value="${esc(emp?.name || '')}" placeholder="Ex: Stephany, Ibrain..." style="width:100%" required>
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;color:var(--muted)">NOME DE USUÁRIO (LOGIN) *</label>
            <input id="emp-user" value="${esc(emp?.username || '')}" placeholder="Ex: stephany, ibrain" style="width:100%" required>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;color:var(--muted)">
              SENHA DE ACESSO ${isEdit ? '<small style="font-weight:normal">(Vazio = manter atual)</small>' : '*'}
            </label>
            <input id="emp-pass" type="password" placeholder="${isEdit ? '••••••••' : 'Digite a senha'}" style="width:100%">
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;color:var(--muted)">PIN RÁPIDO (4 DÍGITOS)</label>
            <input id="emp-pin" type="text" maxlength="6" value="${esc(emp?.pin || '')}" placeholder="Ex: 1234" style="width:100%">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1.2fr 0.8fr;gap:12px;margin-bottom:12px">
          <div>
            <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;color:var(--muted)">CARGO / NÍVEL DO EICHEFE *</label>
            <select id="emp-cargo" style="width:100%">
              ${cargos.map(c => `
                <option value="${c.id}" ${(emp?.cargoId || 1) === c.id ? 'selected' : ''}>
                  ${esc(c.name)} (Nível ${c.nivel})
                </option>
              `).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;color:var(--muted)">CÓD. INTERNO / RFID</label>
            <input id="emp-cod-int" type="number" value="${emp?.codigoInterno || ''}" placeholder="Ex: 101" style="width:100%">
          </div>
        </div>

        <!-- Painel de Permissões Operacionais do EiChefe -->
        <div class="emp-perm-panel">
          <h4>⚙️ Permissões Operacionais e Financeiras</h4>

          <div class="emp-perm-row">
            <label for="emp-com-caixa">
              <input type="checkbox" id="emp-com-caixa" ${emp?.comCaixa ? 'checked' : ''}>
              <span>Permitir Operar / Abrir Caixa (comCaixa)</span>
            </label>
            <span class="muted" style="font-size:11px">Abertura de gaveta e sangria</span>
          </div>

          <div class="emp-perm-row">
            <label for="emp-comissao">
              <input type="checkbox" id="emp-comissao" ${emp?.comissao ? 'checked' : ''}>
              <span>Recebe Comissão sobre Vendas (comissao)</span>
            </label>
            <div style="display:flex;align-items:center;gap:4px">
              <span style="font-size:11px;color:var(--muted)">Taxa %:</span>
              <input type="number" step="0.5" id="emp-taxa" value="${emp?.taxaCalculo !== undefined && emp?.taxaCalculo !== null ? emp.taxaCalculo : '10.00'}" style="width:70px;padding:3px 6px;text-align:right">
            </div>
          </div>

          <div class="emp-perm-row">
            <label for="emp-acesso-fin">
              <input type="checkbox" id="emp-acesso-fin" ${emp?.acessoFinanceiro ? 'checked' : ''}>
              <span>Acesso ao Módulo Financeiro</span>
            </label>
            <span class="muted" style="font-size:11px">Faturamento e fechamentos</span>
          </div>

          <div class="emp-perm-row">
            <label for="emp-acesso-est">
              <input type="checkbox" id="emp-acesso-est" ${emp?.acessoEstoque ? 'checked' : ''}>
              <span>Acesso ao Módulo de Estoque</span>
            </label>
            <span class="muted" style="font-size:11px">Entradas e inventário</span>
          </div>

          <div class="emp-perm-row">
            <label for="emp-active">
              <input type="checkbox" id="emp-active" ${emp?.active !== false ? 'checked' : ''}>
              <span style="font-weight:700">Colaborador Ativo no Sistema</span>
            </label>
            <span class="muted" style="font-size:11px">Permite autenticação</span>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;border-top:1px solid #dee2e6;padding-top:14px">
          <button type="button" class="btn sec" data-close>Cancelar</button>
          <button type="button" class="btn ok" id="emp-save-btn">
            💾 ${isEdit ? 'Salvar Alterações' : 'Cadastrar Funcionário'}
          </button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  overlay.onclick = e => { if (e.target === overlay) close(); };

  // Ao mudar o cargo, preenche automaticamente as permissões padrão do EiChefe
  const cargoSelect = overlay.querySelector('#emp-cargo');
  cargoSelect.onchange = () => {
    const cid = +cargoSelect.value;
    const c = cargos.find(x => x.id === cid);
    if (!c) return;
    if (!isEdit) {
      overlay.querySelector('#emp-com-caixa').checked = Boolean(c.defaultComCaixa);
      overlay.querySelector('#emp-comissao').checked = Boolean(c.defaultComissao);
      overlay.querySelector('#emp-acesso-fin').checked = Boolean(c.defaultAcessoFinanceiro);
      overlay.querySelector('#emp-acesso-est').checked = Boolean(c.defaultAcessoEstoque);
    }
  };

  overlay.querySelector('#emp-save-btn').onclick = safe(async () => {
    const name = overlay.querySelector('#emp-name').value.trim();
    const username = overlay.querySelector('#emp-user').value.trim().toLowerCase();
    const password = overlay.querySelector('#emp-pass').value;
    const pin = overlay.querySelector('#emp-pin').value.trim();
    const cargoId = +overlay.querySelector('#emp-cargo').value;
    const codigoInterno = overlay.querySelector('#emp-cod-int').value.trim();
    const comCaixa = overlay.querySelector('#emp-com-caixa').checked;
    const comissao = overlay.querySelector('#emp-comissao').checked;
    const taxaCalculo = +overlay.querySelector('#emp-taxa').value || 10.00;
    const acessoFinanceiro = overlay.querySelector('#emp-acesso-fin').checked;
    const acessoEstoque = overlay.querySelector('#emp-acesso-est').checked;
    const active = overlay.querySelector('#emp-active').checked;

    if (!name || !username) {
      return toast('Preencha o Nome e o Nome de Usuário');
    }
    if (!isEdit && !password && !pin) {
      return toast('Informe uma Senha ou um PIN para o novo funcionário');
    }

    const payload = {
      name,
      username,
      pin: pin || null,
      cargoId,
      comCaixa,
      comissao,
      taxaCalculo,
      acessoFinanceiro,
      acessoEstoque,
      active,
      codigoInterno: codigoInterno ? +codigoInterno : null,
    };
    if (password) payload.password = password;

    if (isEdit) {
      await api(`/employees/${emp.id}`, 'PUT', payload);
      toast('Funcionário atualizado com sucesso!');
    } else {
      await api('/employees', 'POST', payload);
      toast('Funcionário cadastrado com sucesso!');
    }

    close();
    if (onSaved) onSaved();
  });
}

// ==========================================
// MÓDULO FISCAL — NFC-e (Projeto Nf-e / SEFAZ)
// ==========================================

// Modal Completo de Emissão de NFC-e (Nota Fiscal Consumidor)
async function openNfeModal(orderId, onDone) {
  try {
    const [order, config, preview] = await Promise.all([
      api(`/orders/${orderId}`),
      api('/fiscal/config'),
      api(`/fiscal/preview/${orderId}`),
    ]);

    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const close = () => overlay.remove();

    const isRunning = config.isFiscalAppRunning;
    const runningBadge = isRunning
      ? `<span style="display:inline-flex;align-items:center;gap:6px;background:#dcfce7;color:#166534;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700">🟢 Projeto Nf-e Desktop Conectado</span>`
      : `<span style="display:inline-flex;align-items:center;gap:6px;background:#fef3c7;color:#92400e;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700">🟡 Projeto Nf-e Desktop em Standby</span>`;

    overlay.innerHTML = `
      <div class="modal" style="max-width:680px;width:95%">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #e9ecef;padding-bottom:12px;margin-bottom:14px">
          <div>
            <h3 style="margin:0;font-size:18px;color:#252c38">🧾 Emissão de NFC-e (Nota Fiscal de Consumidor)</h3>
            <span class="muted" style="font-size:12px">Pedido #${order.id} (${TYPE[order.type] || order.type}) — Total: <b>${brl(order.totalAmount)}</b></span>
          </div>
          <div>${runningBadge}</div>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:8px;margin-bottom:14px">
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <div style="flex:1;min-width:240px">
              <label style="display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:4px">
                CPF ou CNPJ na Nota <small class="muted">(opcional — em branco para Não Identificado)</small>:
              </label>
              <input type="text" id="nfe-cpf" placeholder="Ex: 000.000.000-00" value="${esc(order.customerCpf || '')}" style="width:100%;font-size:14px;padding:8px">
            </div>
            <div style="flex:1;min-width:240px">
              <label style="display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:4px">
                Nome do Cliente <small class="muted">(opcional)</small>:
              </label>
              <input type="text" id="nfe-nome" placeholder="Nome impresso na nota" value="${esc(order.customerName || order.Customer?.name || '')}" style="width:100%;font-size:14px;padding:8px">
            </div>
          </div>
        </div>

        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:13px;font-weight:700;color:#334155">Itens e Tributação (Classificação Fiscal SEFAZ-PR)</span>
            <span class="muted" style="font-size:11px">${(preview.produtos || []).length} item(ns)</span>
          </div>
          <div style="max-height:180px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px">
            <table style="font-size:12px;margin:0;width:100%">
              <thead>
                <tr style="background:#f1f5f9">
                  <th>Item</th>
                  <th style="text-align:center">NCM</th>
                  <th style="text-align:center">CFOP</th>
                  <th style="text-align:center">Qtd</th>
                  <th style="text-align:right">Vlr. Unit</th>
                  <th style="text-align:right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${(preview.produtos || []).map(p => `
                  <tr>
                    <td><b>${esc(p.nome)}</b></td>
                    <td style="text-align:center"><code style="background:#e0f2fe;color:#0369a1;padding:2px 4px;border-radius:4px;font-size:11px">${p.ncm}</code></td>
                    <td style="text-align:center"><code style="background:#fef08a;color:#854d0e;padding:2px 4px;border-radius:4px;font-size:11px">${p.cfop}</code></td>
                    <td style="text-align:center">${p.qtde}</td>
                    <td style="text-align:right">${brl(p.valor)}</td>
                    <td style="text-align:right"><b>${brl(Number(p.qtde) * Number(p.valor))}</b></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;background:#eff6ff;padding:10px 14px;border-radius:8px;margin-bottom:16px;border:1px solid #bfdbfe">
          <div style="font-size:12px;color:#1e40af">
            🏪 <b>Emissor:</b> ${esc(config.name)} (CNPJ: ${esc(config.cnpj)})<br/>
            🖨️ <b>Impressão:</b> Danfe NFC-e via Projeto Nf-e Desktop
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:#1e40af">VALOR TOTAL DA NOTA</div>
            <div style="font-size:20px;font-weight:800;color:#1e3a8a">${brl(order.totalAmount)}</div>
          </div>
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button type="button" class="btn sec" id="nfe-cancel">Fechar</button>
          <button type="button" class="btn ok" id="nfe-emit" style="background:#0284c7;font-weight:700;font-size:14px;padding:8px 18px">
            🚀 Emitir NFC-e e Imprimir Cupom
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#nfe-cancel').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    overlay.querySelector('#nfe-emit').onclick = safe(async () => {
      const btn = overlay.querySelector('#nfe-emit');
      btn.disabled = true;
      btn.textContent = '⏳ Emitindo NFC-e...';

      const cpf = overlay.querySelector('#nfe-cpf').value.trim();
      const name = overlay.querySelector('#nfe-nome').value.trim();

      const res = await api(`/fiscal/emit/${orderId}`, 'POST', { cpf, name, mode: 'scanner' });
      toast(`🧾 ${res.message}`);
      close();
      if (typeof onDone === 'function') onDone();
    });
  } catch (err) {
    toast(`Erro ao carregar prévia fiscal: ${err.message}`);
  }
}

// Tela Completa do Módulo Fiscal
async function viewFiscal() {
  const [config, pending, orders] = await Promise.all([
    api('/fiscal/config'),
    api('/fiscal/pending'),
    api('/orders'),
  ]);

  const recentOrders = orders
    .filter(o => o.status !== 'cancelado')
    .slice(0, 30);

  const isRunning = config.isFiscalAppRunning;

  view().innerHTML = `
    <div style="max-width:1100px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
        <div>
          <h2 style="margin:0 0 4px 0">🧾 Módulo Fiscal — NFC-e (SEFAZ-PR)</h2>
          <span class="muted" style="font-size:13px">Integração nativa com Projeto Nf-e Desktop (Like Sistemas)</span>
        </div>
        <div style="display:flex;gap:10px">
          ${!isRunning ? `
            <button class="btn ok" id="btn-start-nfe-app" style="background:#16a34a;font-weight:700">
              ▶️ Iniciar Projeto Nf-e Desktop
            </button>
          ` : `
            <button class="btn sec" id="btn-refresh-fiscal">🔄 Atualizar Status</button>
          `}
        </div>
      </div>

      <!-- Cards de Status -->
      <div class="row" style="gap:14px;margin-bottom:20px;flex-wrap:wrap">
        <div class="card" style="flex:1;min-width:220px;border-left:4px solid ${isRunning ? '#16a34a' : '#d97706'}">
          <div class="muted" style="font-size:12px;font-weight:700">STATUS DO EXECUTÁVEL</div>
          <div style="font-size:18px;font-weight:800;color:${isRunning ? '#166534' : '#92400e'};margin-top:4px">
            ${isRunning ? '🟢 Conectado / Rodando' : '🟡 Standby / Fechado'}
          </div>
          <div class="muted" style="font-size:11px;margin-top:4px">projetonfe-desktop.exe</div>
        </div>

        <div class="card" style="flex:1;min-width:220px;border-left:4px solid #0284c7">
          <div class="muted" style="font-size:12px;font-weight:700">EMPRESA EMISSORA</div>
          <div style="font-size:18px;font-weight:800;color:#0369a1;margin-top:4px">${esc(config.name)}</div>
          <div class="muted" style="font-size:11px;margin-top:4px">CNPJ: ${esc(config.cnpj)} | Emissor #${config.codigoEmissor}</div>
        </div>

        <div class="card" style="flex:1;min-width:220px;border-left:4px solid #8b5cf6">
          <div class="muted" style="font-size:12px;font-weight:700">PASTA DE INTEGRAÇÃO</div>
          <div style="font-size:13px;font-weight:700;color:#6d28d9;margin-top:4px;word-break:break-all">${esc(config.srcFolder)}</div>
          <div class="muted" style="font-size:11px;margin-top:4px">Scanner ativo a cada 3 segundos</div>
        </div>

        <div class="card" style="flex:1;min-width:180px;border-left:4px solid #059669">
          <div class="muted" style="font-size:12px;font-weight:700">NOTAS HOJE NA PASTA</div>
          <div style="font-size:24px;font-weight:800;color:#047857;margin-top:4px">${config.todayPendingCount}</div>
          <div class="muted" style="font-size:11px;margin-top:4px">Arquivos gerados hoje</div>
        </div>
      </div>

      <!-- Emissão Rápida por Pedido Recente -->
      <div class="card" style="margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div>
            <h3 style="margin:0;font-size:16px">⚡ Pedidos Recentes para Emissão de Cupom Fiscal</h3>
            <span class="muted" style="font-size:12px">Selecione qualquer pedido para transmitir à SEFAZ e disparar impressão no caixa</span>
          </div>
        </div>

        <div style="overflow-x:auto">
          <table style="width:100%;font-size:13px">
            <thead>
              <tr style="background:#f8fafc">
                <th style="width:70px">ID</th>
                <th>Tipo</th>
                <th>Cliente / Mesa</th>
                <th>Total</th>
                <th>Pagamento</th>
                <th style="text-align:center">Status Fiscal</th>
                <th style="text-align:right">Ação</th>
              </tr>
            </thead>
            <tbody>
              ${recentOrders.map(o => {
                const isNfeEmitida = o.nfeStatus === 'emitida';
                return `
                  <tr>
                    <td><b>#${o.id}</b></td>
                    <td>${typeChip(o.type)}</td>
                    <td>${esc(o.Table ? `Mesa #${o.Table.number}` : o.Customer?.name || o.customerName || 'Balcão')}</td>
                    <td><b>${brl(o.totalAmount)}</b></td>
                    <td>${esc(o.paymentMethod || 'Aberto')}</td>
                    <td style="text-align:center">
                      ${isNfeEmitida
                        ? `<span class="badge pronto" title="Arquivo: ${esc(o.nfeFile || '')}">✅ Emitida</span>`
                        : `<span class="badge" style="background:#f1f5f9;color:#64748b">Não emitida</span>`}
                    </td>
                    <td style="text-align:right">
                      <button class="btn sm" data-emit-nfe="${o.id}" style="background:#0284c7;color:#fff;font-weight:700">
                        🧾 ${isNfeEmitida ? 'Reemitir NFC-e' : 'Emitir NFC-e'}
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Arquivos Fiscais de Hoje -->
      <div class="card">
        <h3 style="margin:0 0 10px 0;font-size:16px">📁 Arquivos JSON de NFC-e na Pasta de Hoje</h3>
        ${pending.length > 0 ? `
          <div style="overflow-x:auto">
            <table style="width:100%;font-size:12px">
              <thead>
                <tr style="background:#f8fafc">
                  <th>Nome do Arquivo</th>
                  <th>Horário</th>
                  <th>Tamanho</th>
                  <th style="text-align:right">Caminho</th>
                </tr>
              </thead>
              <tbody>
                ${pending.map(f => `
                  <tr>
                    <td><code style="font-weight:700;color:#0369a1">${esc(f.file)}</code></td>
                    <td>${new Date(f.time).toLocaleTimeString('pt-BR')}</td>
                    <td>${(f.size / 1024).toFixed(1)} KB</td>
                    <td style="text-align:right;font-family:monospace;font-size:11px" class="muted">${esc(f.path)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="muted" style="padding:14px;text-align:center">Nenhum arquivo na pasta de hoje até o momento.</div>
        `}
      </div>
    </div>
  `;

  // Listeners
  const btnStart = $('btn-start-nfe-app');
  if (btnStart) {
    btnStart.onclick = safe(async () => {
      const res = await api('/fiscal/launch', 'POST');
      toast(res.message);
      setTimeout(viewFiscal, 1000);
    });
  }

  const btnRefresh = $('btn-refresh-fiscal');
  if (btnRefresh) {
    btnRefresh.onclick = () => viewFiscal();
  }

  document.querySelectorAll('[data-emit-nfe]').forEach(btn => {
    btn.onclick = () => openNfeModal(+btn.dataset.emitNfe, () => viewFiscal());
  });
}


render();
