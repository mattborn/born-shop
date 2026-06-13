// --- Data ---------------------------------------------------------------
let MENU = []

const DEFAULTS = {
  currency: '$',
  footer: 'Thank you — come again! 🎈',
  location: 'East Peoria, IL',
  orderNo: 1,
  phone: '(309) 555-0142',
  server: 'Sam',
  store: 'Little Shop',
  taxRate: 9.25,
}

const STATUSES = ['New', 'Preparing', 'Ready', 'Done']
const KDS_ACTION = { New: 'Start preparing', Preparing: 'Order up!', Ready: 'All done' } // what the next tap does
const PAY_STEPS = ['Connecting…', 'Reading card…', 'Contacting bank…', 'Authorizing…']
const TIPS = [0, 0.15, 0.18, 0.2]
const BIZ_TABS = [
  { id: 'orders', label: 'Orders' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'settings', label: 'Settings' },
]
const SETTINGS_FIELDS = [
  { key: 'store', label: 'Store name' },
  { key: 'server', label: 'Server name' },
  { key: 'location', label: 'Location' },
  { key: 'phone', label: 'Phone' },
  { key: 'taxRate', label: 'Tax rate (%)', type: 'number' },
  { key: 'currency', label: 'Currency symbol' },
  { key: 'orderNo', label: 'Next order #', type: 'number' },
  { key: 'footer', label: 'Receipt footer' },
]
const GREETINGS = [
  (c) => `Welcome to ${c.store}! I'm ${c.server} — what can I get started for you? 😊`,
  (c) => `Hi there! ${c.server} here at ${c.store}. What would you like today? 🍔`,
  (c) => `Howdy! Thanks for stopping by ${c.store}. I'm ${c.server} — what can I get for you? 🎈`,
  (c) => `Good to see you! I'm ${c.server} and I'll be taking care of you. What sounds good today? 🌟`,
]

const COLORS = ['#16a34a', '#db2777', '#2563eb', '#d97706', '#7c3aed', '#dc2626', '#0d9488', '#ca8a04']
const EMOJIS = ['🍔', '🍕', '🌮', '🍜', '🍩', '🧁', '🍦', '🥪', '🍳', '🍟', '🥨', '🍰']

// --- State --------------------------------------------------------------
const load = (k, fallback) => JSON.parse(localStorage.getItem(k)) ?? fallback
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v))
const skey = (base, id = active) => `${base}:${id}` // menu-scoped storage key

let menus = [] // all menu entities: seed (from menus.json) + user-created
let active = null // active menu id, or null for the Pick-a-Menu screen
let config = { ...DEFAULTS }
let cart = []
let orders = []
let view = 'order'
let pending = null // item awaiting modifier selection
let paying = false
let tip = 0 // tip in dollars
let tipKey = 0 // selected tip button: a TIPS percent, or 'custom'
let businessTab = 'orders' // active Business sub-tab
let stock = {} // stockUnitId -> count; absent means unlimited
let purchases = [] // replenishment invoices
let selectedInvoice = null // invoice no shown on the Purchases tab
let checkoutAt = null // timestamp captured when Charge is pressed
let payment = null // card/auth or cash details generated when a payment is approved
let payMethod = null // 'cash' | 'card' chosen on the payment screen

const saveCart = () => save(skey('pos-cart'), cart)
const saveOrders = () => save(skey('pos-orders'), orders)
const saveConfig = () => save(skey('pos-config'), config)
const saveStock = () => save(skey('pos-stock'), stock)
const savePurchases = () => save(skey('pos-purchases'), purchases)
const saveMenus = () => save('pos-menus', menus.filter((m) => !m.seed)) // only persist user-created menus

const $ = (id) => document.getElementById(id)
const money = (n) => config.currency + n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
const round = (n) => Math.round(n * 100) / 100 // round to whole cents
const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const el = (tag, props = {}, kids = []) => {
  const node = Object.assign(document.createElement(tag), props)
  kids.forEach((k) => node.append(k))
  return node
}

// --- Stock --------------------------------------------------------------
const optId = (id, kind, name) => `${id}::${kind}::${name}`
const left = (id) => (id in stock ? stock[id] : Infinity) // remaining count; Infinity = unlimited

// An item is unavailable if it (or every option of a required group) is out.
const available = (item) => {
  if (left(item.id) <= 0) return false
  if (item.sizes && item.sizes.every((s) => left(optId(item.id, 'size', s.name)) <= 0)) return false
  if (item.choices && item.choices.every((c) => left(optId(item.id, 'choice', c.name)) <= 0)) return false
  return true
}

// A human-readable stock status for a remaining count (Infinity = untracked → just "In stock").
const LOW_STOCK = 3
const STATUS = (n) => (n <= 0 ? { cls: 'out', label: 'Out of stock' } : n <= LOW_STOCK ? { cls: 'low', label: 'Low stock' } : { cls: 'ok', label: 'In stock' })

// Representative remaining for an item: its own count, or the total across flavor choices when those carry the stock.
const itemStock = (item) => (item.choices && !(item.id in stock) ? item.choices.reduce((s, c) => s + left(optId(item.id, 'choice', c.name)), 0) : left(item.id))

// Build the starting stock map from the menu definition (only units that declare a stock).
const initialStock = () => {
  const s = {}
  const add = (id, n) => n != null && (s[id] = n)
  MENU.forEach((cat) =>
    cat.items.forEach((it) => {
      add(it.id, it.stock)
      ;(it.sizes || []).forEach((sz) => add(optId(it.id, 'size', sz.name), sz.stock))
      ;(it.choices || []).forEach((c) => add(optId(it.id, 'choice', c.name), c.stock))
      ;(it.mods || []).forEach((m) => add(optId(it.id, 'mod', m.name), m.stock))
    }),
  )
  return s
}

// --- Cart ---------------------------------------------------------------
const lineTotal = (l) => (l.price + l.mods.reduce((s, m) => s + m.price, 0)) * l.qty
const totals = () => {
  const subtotal = round(cart.reduce((s, l) => s + lineTotal(l), 0))
  const tax = round(subtotal * (config.taxRate / 100))
  return { subtotal, tax, total: round(subtotal + tax) }
}

const addToCart = (item, { choice = null, mods = [], size = null } = {}) => {
  const labels = [size?.name, choice?.name].filter(Boolean)
  const key = `${item.id}|${[size?.name, choice?.name, ...mods.map((m) => m.name).sort()].filter(Boolean).join('|')}`
  const cost = (item.cost || 0) + (size?.cost || 0) + (choice?.cost || 0) + mods.reduce((s, m) => s + (m.cost || 0), 0)
  const found = cart.find((l) => l.key === key)
  if (found) found.qty++
  else cart.push({ choice: choice?.name ?? null, cost, emoji: item.emoji, itemId: item.id, key, mods, name: labels.length ? `${item.name} (${labels.join(', ')})` : item.name, price: size ? size.price : item.price, qty: 1, size: size?.name ?? null })
  persistCart()
}

const changeQty = (key, delta) => {
  const l = cart.find((x) => x.key === key)
  if (!l) return
  l.qty += delta
  if (l.qty < 1) cart = cart.filter((x) => x.key !== key)
  persistCart()
}

const persistCart = () => {
  saveCart()
  render()
}

const commitOrder = (method, tipAmt = 0) => {
  const { subtotal, tax, total } = totals()
  orders.push({ cost: cart.reduce((s, l) => s + l.cost * l.qty, 0), items: cart, method, no: config.orderNo, payment, server: config.server, status: 'New', subtotal, tax, time: checkoutAt ?? new Date().toISOString(), tip: tipAmt, total: total + tipAmt })
  saveOrders()
  cart.forEach((l) => {
    const dec = (id) => id in stock && (stock[id] = Math.max(0, stock[id] - l.qty))
    dec(l.itemId)
    if (l.size) dec(optId(l.itemId, 'size', l.size))
    if (l.choice) dec(optId(l.itemId, 'choice', l.choice))
    l.mods.forEach((m) => dec(optId(l.itemId, 'mod', m.name)))
  })
  saveStock()
  config.orderNo = Number(config.orderNo) + 1
  saveConfig()
  cart = []
  saveCart()
  tip = 0
  tipKey = 0
  payment = null
  payMethod = null
}

// --- Views --------------------------------------------------------------
const setView = (v) => {
  view = v
  if (v !== 'payment') paying = false
  render()
}

const render = () => {
  $('landing').hidden = !!active
  $('topbar').hidden = !active
  $('main').hidden = !active
  if (!active) return renderLanding()
  $('brand-emoji').textContent = findMenu(active)?.emoji ?? '🛒'
  $('brand').textContent = config.store
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('active', b.dataset.view === view))
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view))
  ;({ business: renderBusiness, kitchen: renderKitchen, order: renderOrder, payment: renderPayment }[view] || renderOrder)()
}

// --- Menus (named entities) ---------------------------------------------
const clone = (x) => JSON.parse(JSON.stringify(x))
const findMenu = (id) => menus.find((m) => m.id === id)

// Resolve a menu's full categories by walking its base chain, then applying its own extras.
const resolveMenu = (id) => {
  const m = findMenu(id)
  if (!m) return []
  const cats = m.categories ? clone(m.categories) : resolveMenu(m.base ?? 'diner')
  ;(m.extras || []).forEach((ex) => {
    const cat = cats.find((c) => c.name === ex.category)
    if (cat) cat.items.push(...clone(ex.items))
    else cats.push({ items: clone(ex.items), name: ex.category })
  })
  return cats
}

const enterMenu = (id) => {
  const m = findMenu(id)
  if (!m) return
  active = id
  localStorage.setItem('pos-active', id)
  config = { ...DEFAULTS, store: m.name, ...load(skey('pos-config'), {}) }
  cart = load(skey('pos-cart'), [])
  orders = load(skey('pos-orders'), [])
  MENU = resolveMenu(id)
  const saved = load(skey('pos-stock'), {})
  stock = Object.keys(saved).length ? saved : initialStock() // seed from the menu definition until there's a live count
  if (!Object.keys(saved).length) saveStock()
  purchases = load(skey('pos-purchases'), [])
  view = 'order'
  tip = 0
  tipKey = 0
  render()
}

const exitToLanding = () => {
  active = null
  localStorage.removeItem('pos-active')
  render()
}

const renderLanding = () => {
  const grid = $('landing-grid')
  grid.replaceChildren()
  const today = new Date().toDateString()
  menus.forEach((m) => {
    const count = load(skey('pos-orders', m.id), []).filter((o) => new Date(o.time).toDateString() === today).length
    const card = el('div', { className: 'r-card', onclick: () => enterMenu(m.id) }, [
      el('span', { className: 'r-emoji', textContent: m.emoji }),
      el('span', { className: 'r-name', textContent: m.name }),
      el('span', { className: 'r-menu', textContent: m.base ? `based on ${findMenu(m.base)?.name ?? 'Default Diner'}` : 'Base menu' }),
      el('span', { className: 'r-stat', textContent: count ? `${count} order${count === 1 ? '' : 's'} today` : 'No orders yet' }),
    ])
    card.style.setProperty('--r', m.color)
    if (!m.locked && !m.seed) {
      const del = el('button', { className: 'r-del', textContent: '×', title: 'Delete menu' })
      del.onclick = (e) => {
        e.stopPropagation()
        if (!confirm(`Delete ${m.name}? Its saved orders stay until cleared.`)) return
        menus = menus.filter((x) => x.id !== m.id)
        saveMenus()
        render()
      }
      card.prepend(del)
    }
    grid.append(card)
  })
  grid.append(el('div', { className: 'r-card r-new', onclick: openNewMenu }, [
    el('span', { className: 'r-emoji', textContent: '＋' }),
    el('span', { className: 'r-name', textContent: 'New menu' }),
  ]))
}

const openNewMenu = () => {
  const f = $('new-form')
  f.name.value = ''
  f.emoji.value = EMOJIS[menus.length % EMOJIS.length]
  f.base.replaceChildren(...menus.map((m) => el('option', { textContent: m.name, value: m.id })))
  $('new-overlay').hidden = false
  setTimeout(() => f.name.focus(), 0)
}

$('new-create').onclick = () => {
  const f = $('new-form')
  const name = f.name.value.trim()
  if (!name) return f.name.focus()
  const m = { base: f.base.value, color: COLORS[menus.length % COLORS.length], emoji: f.emoji.value.trim() || '🍴', extras: [], id: 'm' + Date.now().toString(36), name }
  menus.push(m)
  saveMenus()
  $('new-overlay').hidden = true
  enterMenu(m.id)
}
$('new-cancel').onclick = () => ($('new-overlay').hidden = true)
$('home-btn').onclick = exitToLanding

// --- Order (server) -----------------------------------------------------
const renderMenu = () => {
  const grid = $('grid')
  grid.replaceChildren()
  MENU.forEach((cat) => {
    const tiles = el('div', { className: 'cat-grid' })
    cat.items.forEach((item) => {
      const ok = available(item)
      const n = itemStock(item)
      const tile = el('button', { className: 'tile' + (ok ? '' : ' sold'), onclick: ok ? () => pick(item) : null }, [
        el('span', { className: 'emoji', textContent: item.emoji }),
        el('span', { className: 'name', textContent: item.name }),
        el('span', { className: 'price', textContent: ok ? (item.sizes ? 'from ' + money(Math.min(...item.sizes.map((s) => s.price))) : money(item.price)) : 'Out of stock' }),
      ])
      if (ok && n !== Infinity && n <= LOW_STOCK) tile.append(el('span', { className: 'badge', textContent: 'Low stock' }))
      tiles.append(tile)
    })
    grid.append(el('section', { className: 'cat' }, [el('h2', { textContent: cat.name }), tiles]))
  })
}

// Subtotal / tax / (tip) / total block, reused inline on the payment receipt and pinned on the order screen.
const totalsBlock = ({ full = false, tipAmt = 0 } = {}) => {
  const { subtotal, tax, total } = totals()
  const rows = [
    el('div', {}, [el('span', { textContent: 'Subtotal' }), el('span', { textContent: money(subtotal) })]),
    el('div', {}, [el('span', { textContent: `Tax (${config.taxRate}%)` }), el('span', { textContent: money(tax) })]),
  ]
  if (full && tipAmt) rows.push(el('div', {}, [el('span', { textContent: 'Tip' }), el('span', { textContent: money(tipAmt) })]))
  rows.push(el('div', { className: 'r-grand' }, [el('span', { textContent: 'Total' }), el('span', { textContent: money(total + (full ? tipAmt : 0)) })]))
  return el('div', { className: 'r-totals' }, rows)
}

// Build the order/receipt into `box`. Order screen = itemized list (editable, no chrome — totals are pinned separately);
// payment screen = the full receipt (store header, meta, totals, tip, footer; read-only).
const buildReceipt = (box, { editable = false, full = false, tipAmt = 0, pay = null } = {}) => {
  box.replaceChildren()
  if (full) {
    box.append(el('div', { className: 'r-head' }, [
      el('div', { className: 'store', textContent: config.store }),
      el('div', { className: 'r-meta', textContent: config.location }),
      el('div', { className: 'r-meta', textContent: config.phone }),
    ]))
    box.append(el('hr', { className: 'r-rule' }))
    box.append(el('div', { className: 'r-meta', textContent: `Order #${config.orderNo}` }))
    box.append(el('div', { className: 'r-meta', textContent: `Server: ${config.server}` }))
    box.append(el('div', { className: 'r-meta', textContent: new Date(checkoutAt ?? Date.now()).toLocaleString() }))
    box.append(el('hr', { className: 'r-rule' }))
  }

  if (!cart.length) {
    box.append(el('div', { className: 'r-empty', textContent: 'Tap items to start an order 🛍️' }))
    return
  }

  cart.forEach((l) => {
    const line = el('div', { className: 'r-line' }, [
      el('span', { className: 'r-qty', textContent: `${l.qty}×` }),
      el('span', { textContent: `${l.emoji} ${l.name}` }),
      el('span', { className: 'r-amt', textContent: money(lineTotal(l)) }),
    ])
    l.mods.forEach((m) => line.append(el('span', { className: 'r-mod', textContent: `+ ${m.name}${m.price ? ' ' + money(m.price) : ''}` })))
    if (editable)
      line.append(el('div', { className: 'r-controls' }, [
        el('button', { onclick: () => changeQty(l.key, -1), textContent: '−' }),
        el('button', { onclick: () => changeQty(l.key, 1), textContent: '+' }),
      ]))
    box.append(line)
  })

  if (full) {
    box.append(el('hr', { className: 'r-rule' }))
    box.append(totalsBlock({ full: true, tipAmt }))
    if (pay) {
      box.append(el('hr', { className: 'r-rule' }))
      if (pay.cash) {
        box.append(el('div', { className: 'r-pay' }, [el('span', { textContent: 'Cash' }), el('span', { textContent: money(pay.tendered) })]))
        box.append(el('div', { className: 'r-pay' }, [el('span', { className: 'r-approved', textContent: 'Change' }), el('span', { textContent: money(pay.change) })]))
      } else {
        box.append(el('div', { className: 'r-pay' }, [el('span', { textContent: `${pay.brand} ••${pay.last4}` }), el('span', { textContent: pay.entry })]))
        box.append(el('div', { className: 'r-pay' }, [el('span', { className: 'r-approved', textContent: 'APPROVED' }), el('span', { textContent: `Auth ${pay.auth}` })]))
        box.append(el('div', { className: 'r-pay', textContent: `Ref # ${pay.txn}` }))
      }
    }
    box.append(el('hr', { className: 'r-rule' }))
    box.append(el('div', { className: 'r-foot', textContent: config.footer }))
  }
}

const renderOrder = () => {
  renderMenu()
  $('greeting').textContent = GREETINGS[config.orderNo % GREETINGS.length](config)
  buildReceipt($('receipt'), { editable: true })
  const ot = $('order-totals')
  ot.replaceChildren()
  ot.hidden = !cart.length
  if (cart.length) ot.append(totalsBlock())
}

// --- Modifier sheet -----------------------------------------------------
const pick = (item) => {
  if (!item.sizes && !item.choices && !item.mods) return addToCart(item)
  const firstSize = item.sizes?.find((s) => left(optId(item.id, 'size', s.name)) > 0) ?? item.sizes?.[0] ?? null
  const firstChoice = item.choices?.find((c) => left(optId(item.id, 'choice', c.name)) > 0) ?? item.choices?.[0] ?? null
  pending = { choice: firstChoice, item, mods: new Set(), size: firstSize }
  $('mod-title').textContent = `${item.emoji} ${item.name}`
  const list = $('mod-list')
  list.replaceChildren()
  if (item.sizes) {
    list.append(el('div', { className: 'mod-group', textContent: 'Size' }))
    item.sizes.forEach((s) => {
      const out = left(optId(item.id, 'size', s.name)) <= 0
      const row = el('div', { className: 'mod-row size-row' + (s === pending.size ? ' on' : '') + (out ? ' sold' : '') }, [
        el('span', { textContent: out ? `${s.name} — sold out` : s.name }),
        el('span', { className: 'mod-price', textContent: money(s.price) }),
      ])
      if (!out)
        row.onclick = () => {
          pending.size = s
          list.querySelectorAll('.size-row').forEach((r) => r.classList.toggle('on', r === row))
        }
      list.append(row)
    })
  }
  if (item.choices) {
    list.append(el('div', { className: 'mod-group', textContent: item.choiceLabel ?? 'Choose' }))
    item.choices.forEach((c) => {
      const out = left(optId(item.id, 'choice', c.name)) <= 0
      const row = el('div', { className: 'mod-row choice-row' + (c === pending.choice ? ' on' : '') + (out ? ' sold' : '') }, [el('span', { textContent: out ? `${c.name} — sold out` : c.name })])
      if (!out)
        row.onclick = () => {
          pending.choice = c
          list.querySelectorAll('.choice-row').forEach((r) => r.classList.toggle('on', r === row))
        }
      list.append(row)
    })
  }
  if (item.mods) {
    list.append(el('div', { className: 'mod-group', textContent: 'Add-ons' }))
    item.mods.forEach((m) => {
      const out = left(optId(item.id, 'mod', m.name)) <= 0
      const row = el('div', { className: 'mod-row' + (out ? ' sold' : '') }, [
        el('span', { textContent: out ? `${m.name} — sold out` : m.name }),
        el('span', { className: 'mod-price', textContent: m.price ? '+' + money(m.price) : 'free' }),
      ])
      if (!out)
        row.onclick = () => {
          pending.mods.has(m) ? pending.mods.delete(m) : pending.mods.add(m)
          row.classList.toggle('on')
        }
      list.append(row)
    })
  }
  $('mod-overlay').hidden = false
}

$('mod-add').onclick = () => {
  addToCart(pending.item, { choice: pending.choice, mods: [...pending.mods], size: pending.size })
  $('mod-overlay').hidden = true
}
$('mod-cancel').onclick = () => ($('mod-overlay').hidden = true)

// --- Payment (customer) -------------------------------------------------
const ding = () => {
  const Ctx = window.AudioContext || window.webkitAudioContext
  const ctx = new Ctx()
  const beep = (freq, at, dur) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g).connect(ctx.destination)
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, ctx.currentTime + at)
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + at + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur)
    o.start(ctx.currentTime + at)
    o.stop(ctx.currentTime + at + dur)
  }
  beep(660, 0, 0.15)
  beep(990, 0.13, 0.35)
}

// Simulate the processor's response: card, approval (auth) code, and transaction reference.
const genPayment = () => {
  const r = (n) => Math.floor(Math.random() * n)
  const code = (len) => Array.from({ length: len }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[r(34)]).join('')
  return { auth: code(6), brand: ['Visa', 'Mastercard', 'Amex', 'Discover'][r(4)], entry: 'Contactless', last4: String(1000 + r(9000)), txn: String(Date.now()).slice(-10) }
}

const renderPayment = () => {
  const root = $('view-payment')
  root.replaceChildren()
  if (!cart.length) {
    root.append(el('div', { className: 'r-empty pay-empty', textContent: 'No active order — add items on the Order screen.' }))
    return
  }
  const { subtotal } = totals()
  const receipt = el('div', { className: 'pay-receipt' })
  buildReceipt(receipt, { full: true, tipAmt: tip })
  const tipText = !tip ? 'Add a tip?' : tipKey === 'custom' ? `Includes ${subtotal ? Math.round((tip / subtotal) * 100) : 0}% tip` : `Includes ${money(tip)} tip`
  const tipLabel = el('div', { className: 'pay-tip-label', textContent: tipText })
  const tips = el('div', { className: 'pay-tips' })
  TIPS.forEach((p) => {
    const b = el('button', { className: 'pay-tip' + (tipKey === p ? ' on' : ''), textContent: p ? `${Math.round(p * 100)}%` : 'No tip' })
    b.onclick = () => !paying && ((tipKey = p), (tip = round(subtotal * p)), renderPayment())
    tips.append(b)
  })
  const customBtn = el('button', { className: 'pay-tip' + (tipKey === 'custom' ? ' on' : ''), textContent: 'Custom' })
  customBtn.onclick = () => !paying && ((tipKey = 'custom'), (tip = 0), renderPayment())
  tips.append(customBtn)

  const side = el('div', { className: 'pay-side' })
  side.append(tipLabel, tips)

  if (tipKey === 'custom') {
    const input = el('input', { className: 'pay-custom', inputMode: 'decimal', min: '0', placeholder: '0.00', step: '0.25', type: 'number', value: tip || '' })
    input.oninput = () => {
      tip = round(Math.max(0, Number(input.value) || 0))
      buildReceipt(receipt, { full: true, tipAmt: tip })
      tipLabel.textContent = tip ? `Includes ${subtotal ? Math.round((tip / subtotal) * 100) : 0}% tip` : 'Add a tip?'
    }
    side.append(input)
    setTimeout(() => input.focus(), 0)
  }

  const status = el('div', { className: 'pay-status' })
  side.append(
    el('div', { className: 'pay-tip-label', textContent: 'How would you like to pay?' }),
    el('div', { className: 'pay-methods' }, [
      el('button', { className: 'pay-method' + (payMethod === 'cash' ? ' on' : ''), onclick: () => !paying && ((payMethod = 'cash'), renderPayment()), textContent: '💵 Cash' }),
      el('button', { className: 'pay-method' + (payMethod === 'card' ? ' on' : ''), onclick: () => !paying && ((payMethod = 'card'), renderPayment()), textContent: '💳 Card' }),
    ]),
  )

  if (payMethod === 'card') {
    const tap = el('button', { className: 'pay-tap' }, [el('span', { textContent: '📱💳' }), el('div', { textContent: 'Tap to Pay' })])
    tap.onclick = () => startPayment(receipt, tap, status)
    side.append(tap, status)
  } else if (payMethod === 'cash') {
    const due = round(totals().total + tip)
    const cash = el('div', { className: 'pay-cash' })
    ;[
      ['Exact', due],
      ['$5', 5],
      ['$10', 10],
      ['$20', 20],
      ['$50', 50],
      ['$100', 100],
    ].forEach(([label, amt]) => {
      const valid = amt >= due
      const b = el('button', { className: 'pay-cash-btn', disabled: !valid, textContent: label })
      if (valid) b.onclick = () => payCash(amt, receipt, status)
      cash.append(b)
    })
    side.append(cash, status)
  } else {
    side.append(status)
  }

  root.append(receipt, side)
}

const payCash = (tendered, receipt, status) => {
  if (paying) return
  paying = true
  const due = round(totals().total + tip)
  const change = round(tendered - due)
  payment = { cash: true, change, tendered: round(tendered) }
  buildReceipt(receipt, { full: true, pay: payment, tipAmt: tip })
  status.className = 'pay-approved'
  status.textContent = change > 0 ? `Change ${money(change)}` : 'Exact — no change'
  ding()
  setTimeout(() => {
    commitOrder('Cash', tip)
    paying = false
    setView('kitchen')
  }, 3000)
}

const startPayment = (receipt, tap, status) => {
  if (paying) return
  paying = true
  tap.disabled = true
  let i = 0
  const step = () => {
    if (i < PAY_STEPS.length) {
      status.textContent = PAY_STEPS[i++]
      setTimeout(step, 800)
    } else {
      payment = genPayment()
      buildReceipt(receipt, { full: true, pay: payment, tipAmt: tip })
      status.className = 'pay-approved'
      status.textContent = 'Approved ✅'
      ding()
      setTimeout(() => {
        commitOrder('Contactless', tip)
        paying = false
        setView('kitchen')
      }, 3000)
    }
  }
  step()
}

// --- Kitchen (cook) -----------------------------------------------------
// Live per-ticket stopwatch: elapsed since the order was placed, ambering at 5 min, reddening at 10.
const tickTimers = () => {
  document.querySelectorAll('.kds-timer').forEach((t) => {
    const s = Math.max(0, Math.floor((Date.now() - Number(t.dataset.start)) / 1000))
    t.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    t.classList.toggle('warn', s >= 300 && s < 600)
    t.classList.toggle('late', s >= 600)
  })
}

const advanceStatus = (no) => {
  const o = orders.find((x) => x.no === no)
  if (!o) return
  o.status = STATUSES[Math.min(STATUSES.indexOf(o.status) + 1, STATUSES.length - 1)]
  saveOrders()
  render()
}

const renderKitchen = () => {
  const root = $('view-kitchen')
  root.replaceChildren()
  const tickets = orders.filter((o) => o.status !== 'Done')
  if (!tickets.length) {
    root.append(el('div', { className: 'kds-empty', textContent: 'NO ACTIVE ORDERS' }))
    return
  }
  const cols = el('div', { id: 'kds' })
  tickets.forEach((o) => {
    const items = el('div', { className: 'kds-items' })
    o.items.forEach((l) => {
      items.append(el('div', { className: 'kds-item', textContent: `${l.qty} ${l.name}` }))
      l.mods.forEach((m) => items.append(el('div', { className: 'kds-mod', textContent: `+ ${m.name}` })))
    })
    const timer = el('span', { className: 'kds-timer' })
    timer.dataset.start = String(new Date(o.time).getTime())
    cols.append(el('div', { className: `kds-col s-${o.status.toLowerCase()}`, onclick: () => advanceStatus(o.no) }, [
      el('div', { className: 'kds-head' }, [
        el('div', { className: 'kds-state', textContent: o.status }),
        el('div', { className: 'kds-headrow' }, [el('span', { className: 'kds-no', textContent: `#${o.no}` }), timer]),
      ]),
      items,
      el('div', { className: 'kds-bump' }, [el('div', { className: 'kds-tap', textContent: 'Bump' }), el('div', { className: 'kds-action', textContent: KDS_ACTION[o.status] })]),
    ]))
  })
  root.append(cols)
  tickTimers()
}

// --- Business (owner) ---------------------------------------------------
const stat = (big, label) => el('div', { className: 'fin-stat' }, [el('div', { className: 'big', textContent: big }), el('div', { className: 'label', textContent: label })])
const row = (cell, vals) => el('tr', {}, vals.map((v) => el(cell, { textContent: v })))

const replenish = () => {
  if (!confirm('Replenish all stock back to the menu defaults?')) return
  const lines = []
  const buy = (group, label, cost, id, seedQty) => {
    if (seedQty == null) return
    const delta = seedQty - (id in stock ? stock[id] : 0)
    if (delta > 0) lines.push({ cost: cost || 0, delta, group, label })
  }
  MENU.forEach((cat) =>
    cat.items.forEach((it) => {
      buy(cat.name, `${it.emoji} ${it.name}`, it.cost, it.id, it.stock)
      ;(it.choices || []).forEach((c) => buy(cat.name, `${it.emoji} ${it.name} · ${c.name}`, c.cost, optId(it.id, 'choice', c.name), c.stock))
      ;(it.mods || []).forEach((m) => buy(cat.name, `${it.emoji} ${it.name} · ${m.name}`, m.cost, optId(it.id, 'mod', m.name), m.stock))
    }),
  )
  stock = initialStock()
  saveStock()
  if (lines.length) {
    const no = (new Date().getFullYear() % 100) * 1000 + purchases.length + 1
    purchases.push({ lines, no, time: new Date().toISOString(), total: lines.reduce((s, l) => s + l.cost * l.delta, 0) })
    savePurchases()
    selectedInvoice = no
  }
  renderInventory()
}
const clearOrders = () => confirm('Clear all recorded orders? This cannot be undone.') && ((orders = []), saveOrders(), render())
const resetSettings = () => ((config = { ...DEFAULTS, store: config.store }), saveConfig(), render())
const saveSettings = () => {
  const form = $('settings-form')
  SETTINGS_FIELDS.forEach((f) => {
    const v = form.elements[f.key].value
    config[f.key] = f.type === 'number' ? Number(v) : v
  })
  saveConfig()
  const m = findMenu(active)
  if (m && !m.seed) {
    m.name = config.store
    saveMenus()
  }
  render()
}

// Each Business tab exposes its action buttons in the bar to the right of the sub-nav.
const BIZ_ACTIONS = {
  inventory: () => [el('button', { onclick: replenish, textContent: 'Replenish stock' })],
  orders: () => [el('button', { className: 'danger', onclick: clearOrders, textContent: 'Clear all orders' })],
  settings: () => [el('button', { className: 'ghost', onclick: resetSettings, textContent: 'Reset defaults' }), el('button', { onclick: saveSettings, textContent: 'Save' })],
}

const renderBusiness = () => {
  $('biz-tabs').replaceChildren(...BIZ_TABS.map((t) => {
    const b = el('button', { className: businessTab === t.id ? 'active' : '', textContent: t.label })
    b.onclick = () => {
      businessTab = t.id
      renderBusiness()
    }
    return b
  }))
  $('biz-actions').replaceChildren(...(BIZ_ACTIONS[businessTab]?.() ?? []))
  ;({ inventory: renderInventory, orders: renderBizOrders, purchases: renderPurchases, settings: renderBizSettings }[businessTab] || renderBizOrders)()
}

const renderPurchases = () => {
  const root = $('biz-content')
  root.replaceChildren()
  if (!purchases.length) {
    root.append(el('div', { className: 'fin-empty', textContent: 'No purchases yet — replenishing stock creates an invoice.' }))
    return
  }
  if (!purchases.some((p) => p.no === selectedInvoice)) selectedInvoice = purchases[purchases.length - 1].no

  const list = el('div', { className: 'pur-list' })
  purchases
    .slice()
    .reverse()
    .forEach((p) => {
      const b = el('button', { className: 'pur-item' + (p.no === selectedInvoice ? ' active' : ''), onclick: () => ((selectedInvoice = p.no), renderPurchases()) }, [
        el('span', { className: 'pur-no', textContent: `Invoice #${p.no}` }),
        el('span', { className: 'pur-date', textContent: new Date(p.time).toLocaleString() }),
        el('span', { className: 'pur-tot', textContent: money(p.total) }),
      ])
      list.append(b)
    })

  const inv = purchases.find((p) => p.no === selectedInvoice)
  const units = inv.lines.reduce((s, l) => s + l.delta, 0)
  const tbody = el('tbody')
  inv.lines.forEach((l) => tbody.append(row('td', [l.group, l.label, money(l.cost), String(l.delta), money(l.cost * l.delta)])))
  const detail = el('div', { className: 'pur-detail' }, [
    el('div', { className: 'fin-summary' }, [stat(`#${inv.no}`, 'Invoice'), stat(money(inv.total), 'Total'), stat(String(units), 'Items'), stat(new Date(inv.time).toLocaleDateString(), 'Date')]),
    el('table', { className: 'fin-table' }, [el('thead', {}, [row('th', ['Group', 'Item', 'Cost', 'Qty', 'Total'])]), tbody]),
  ])

  root.append(el('div', { className: 'pur-layout' }, [list, detail]))
}

const renderInventory = () => {
  const root = $('biz-content')
  root.replaceChildren()
  const tbody = el('tbody')
  const addRow = (group, label, cost, id, isOpt) => {
    const n = id in stock ? stock[id] : Infinity
    const s = STATUS(n)
    tbody.append(el('tr', isOpt ? { className: 'inv-opt' } : {}, [el('td', { textContent: group }), el('td', { textContent: label }), el('td', { textContent: cost != null ? money(cost) : '—' }), el('td', { textContent: n === Infinity ? '—' : String(n) }), el('td', {}, [el('span', { className: 'st st-' + s.cls, textContent: s.label })])]))
  }
  MENU.forEach((cat) =>
    cat.items.forEach((it) => {
      addRow(cat.name, `${it.emoji} ${it.name}`, it.cost, it.id, false)
      ;(it.sizes || []).forEach((s) => addRow('', '↳ ' + s.name, s.cost, optId(it.id, 'size', s.name), true))
      ;(it.choices || []).forEach((c) => addRow('', '↳ ' + c.name, c.cost, optId(it.id, 'choice', c.name), true))
      ;(it.mods || []).forEach((m) => addRow('', '↳ ' + m.name, m.cost, optId(it.id, 'mod', m.name), true))
    }),
  )
  root.append(el('table', { className: 'fin-table' }, [el('thead', {}, [row('th', ['Group', 'Item', 'Cost', 'Quantity', 'Status'])]), tbody]))
}

const renderBizSettings = () => {
  const root = $('biz-content')
  root.replaceChildren()
  const form = el('form', { id: 'settings-form' })
  SETTINGS_FIELDS.forEach((f) => {
    const input = el('input', { name: f.key, value: config[f.key] })
    if (f.type === 'number') Object.assign(input, { min: '0', step: f.key === 'taxRate' ? '0.001' : '1', type: 'number' })
    form.append(el('label', {}, [f.label + ' ', input]))
  })
  root.append(form)
}

const renderBizOrders = () => {
  const root = $('biz-content')
  root.replaceChildren()
  const today = new Date().toDateString()
  const todays = orders.filter((o) => new Date(o.time).toDateString() === today)
  const revenue = todays.reduce((s, o) => s + o.total, 0)
  const tax = todays.reduce((s, o) => s + o.tax, 0)
  const tips = todays.reduce((s, o) => s + (o.tip ?? 0), 0)
  const cost = todays.reduce((s, o) => s + (o.cost ?? 0), 0)
  const profit = todays.reduce((s, o) => s + (o.subtotal - (o.cost ?? 0)), 0)

  root.append(el('div', { className: 'fin-summary' }, [
    stat(money(revenue), "Today's revenue"),
    stat(money(profit), 'Profit'),
    stat(String(todays.length), 'Orders'),
    stat(money(cost), 'Cost of goods'),
    stat(money(tips), 'Tips'),
    stat(money(tax), 'Tax collected'),
  ]))

  if (todays.length) {
    const tbody = el('tbody')
    todays.slice().reverse().forEach((o) => {
      const count = o.items.reduce((s, l) => s + l.qty, 0)
      tbody.append(row('td', [`#${o.no}`, time(o.time), o.server, `${count} item${count === 1 ? '' : 's'}`, o.method, o.status, money(o.tip ?? 0), money(o.total)]))
    })
    root.append(el('table', { className: 'fin-table' }, [
      el('thead', {}, [row('th', ['#', 'Time', 'Server', 'Items', 'Payment', 'Status', 'Tip', 'Total'])]),
      tbody,
    ]))
  } else {
    root.append(el('div', { className: 'fin-empty', textContent: 'No orders yet today.' }))
  }
}

// --- Actions & settings -------------------------------------------------
$('views').onclick = (e) => e.target.dataset.view && setView(e.target.dataset.view)
$('charge-btn').onclick = () => {
  if (!cart.length) return
  checkoutAt = new Date().toISOString()
  payment = null
  payMethod = null
  setView('payment')
}
$('clear-btn').onclick = () => {
  cart = []
  tip = 0
  tipKey = 0
  persistCart()
}

// One-time: fold pre-multi-menu data (global pos-* keys) into Default Diner, then clear it.
const migrateLegacy = () => {
  if (localStorage.getItem('pos-migrated')) return
  const legacyOrders = load('pos-orders', null)
  const legacyConfig = load('pos-config', null)
  if (legacyOrders?.length) {
    const archived = legacyOrders.map((o) => ({ ...o, status: 'Done' })) // archive old tickets so they don't reappear in the kitchen
    save('pos-orders:diner', [...archived, ...load('pos-orders:diner', [])])
  }
  if (legacyConfig && localStorage.getItem('pos-config:diner') === null) save('pos-config:diner', legacyConfig)
  ;['pos-orders', 'pos-config', 'pos-cart'].forEach((k) => localStorage.removeItem(k))
  localStorage.setItem('pos-migrated', '1')
}

// --- Boot ---------------------------------------------------------------
const boot = async () => {
  let seed
  try {
    seed = await fetch('menus.json').then((r) => r.json())
  } catch (e) {
    console.error('menus.json failed to load', e)
    $('landing').hidden = false
    $('landing-grid').replaceChildren(el('p', { className: 'r-stat', textContent: 'Menu data didn’t load — refresh to try again.' }))
    return
  }
  seed.forEach((m) => (m.seed = true)) // seed menus come from the file fresh each load and aren't deletable
  menus = [...seed, ...load('pos-menus', [])]
  migrateLegacy()
  const saved = localStorage.getItem('pos-active')
  if (saved && findMenu(saved)) enterMenu(saved)
  else render()
}
boot()
setInterval(tickTimers, 1000)
