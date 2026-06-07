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
const PAY_STEPS = ['Connecting…', 'Reading card…', 'Contacting bank…', 'Authorizing…']
const GREETINGS = [
  (c) => `Welcome to ${c.store}! I'm ${c.server} — what can I get started for you? 😊`,
  (c) => `Hi there! ${c.server} here at ${c.store}. What would you like today? 🍔`,
  (c) => `Howdy! Thanks for stopping by ${c.store}. I'm ${c.server} — what can I get for you? 🎈`,
  (c) => `Good to see you! I'm ${c.server} and I'll be taking care of you. What sounds good today? 🌟`,
]

// --- State --------------------------------------------------------------
const load = (k, fallback) => JSON.parse(localStorage.getItem(k)) ?? fallback
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v))

let config = { ...DEFAULTS, ...load('pos-config', {}) }
let cart = load('pos-cart', [])
let orders = load('pos-orders', [])
let view = 'order'
let pending = null // item awaiting modifier selection
let paying = false

const $ = (id) => document.getElementById(id)
const money = (n) => config.currency + n.toFixed(2)
const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const el = (tag, props = {}, kids = []) => {
  const node = Object.assign(document.createElement(tag), props)
  kids.forEach((k) => node.append(k))
  return node
}

// --- Cart ---------------------------------------------------------------
const lineTotal = (l) => (l.price + l.mods.reduce((s, m) => s + m.price, 0)) * l.qty
const totals = () => {
  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0)
  const tax = subtotal * (config.taxRate / 100)
  return { subtotal, tax, total: subtotal + tax }
}

const addToCart = (item, size = null, mods = []) => {
  const key = `${item.id}|${size ? size.name : ''}|${mods.map((m) => m.name).sort().join(',')}`
  const found = cart.find((l) => l.key === key)
  if (found) found.qty++
  else cart.push({ emoji: item.emoji, key, mods, name: size ? `${item.name} (${size.name})` : item.name, price: size ? size.price : item.price, qty: 1 })
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
  save('pos-cart', cart)
  render()
}

const commitOrder = (method) => {
  const { subtotal, tax, total } = totals()
  orders.push({ items: cart, method, no: config.orderNo, server: config.server, status: 'New', subtotal, tax, time: new Date().toISOString(), total })
  save('pos-orders', orders)
  config.orderNo = Number(config.orderNo) + 1
  save('pos-config', config)
  cart = []
  save('pos-cart', cart)
}

// --- Views --------------------------------------------------------------
const setView = (v) => {
  view = v
  if (v !== 'payment') paying = false
  render()
}

const render = () => {
  $('brand').textContent = config.store
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('active', b.dataset.view === view))
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view))
  ;({ finance: renderFinance, kitchen: renderKitchen, order: renderOrder, payment: renderPayment }[view] || renderOrder)()
}

// --- Order (server) -----------------------------------------------------
const renderMenu = () => {
  const grid = $('grid')
  grid.replaceChildren()
  MENU.forEach((cat) => {
    const tiles = el('div', { className: 'cat-grid' })
    cat.items.forEach((item) => {
      const tile = el('button', { className: 'tile', onclick: () => pick(item) }, [
        el('span', { className: 'emoji', textContent: item.emoji }),
        el('span', { className: 'name', textContent: item.name }),
        el('span', { className: 'price', textContent: item.sizes ? 'from ' + money(Math.min(...item.sizes.map((s) => s.price))) : money(item.price) }),
      ])
      tiles.append(tile)
    })
    grid.append(el('section', { className: 'cat' }, [el('h2', { textContent: cat.name }), tiles]))
  })
}

const renderOrder = () => {
  $('greeting').textContent = GREETINGS[config.orderNo % GREETINGS.length](config)
  const box = $('receipt')
  box.replaceChildren()
  box.append(el('div', { className: 'r-head' }, [
    el('div', { className: 'store', textContent: config.store }),
    el('div', { className: 'r-meta', textContent: config.location }),
    el('div', { className: 'r-meta', textContent: config.phone }),
  ]))
  box.append(el('hr', { className: 'r-rule' }))
  box.append(el('div', { className: 'r-meta', textContent: `Order #${config.orderNo}` }))
  box.append(el('div', { className: 'r-meta', textContent: `Server: ${config.server}` }))
  box.append(el('div', { className: 'r-meta', textContent: new Date().toLocaleString() }))
  box.append(el('hr', { className: 'r-rule' }))

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
    line.append(el('div', { className: 'r-controls' }, [
      el('button', { onclick: () => changeQty(l.key, -1), textContent: '−' }),
      el('button', { onclick: () => changeQty(l.key, 1), textContent: '+' }),
    ]))
    box.append(line)
  })

  const { subtotal, tax, total } = totals()
  box.append(el('hr', { className: 'r-rule' }))
  box.append(el('div', { className: 'r-totals' }, [
    el('div', {}, [el('span', { textContent: 'Subtotal' }), el('span', { textContent: money(subtotal) })]),
    el('div', {}, [el('span', { textContent: `Tax (${config.taxRate}%)` }), el('span', { textContent: money(tax) })]),
    el('div', { className: 'r-grand' }, [el('span', { textContent: 'Total' }), el('span', { textContent: money(total) })]),
  ]))
  box.append(el('hr', { className: 'r-rule' }))
  box.append(el('div', { className: 'r-foot', textContent: config.footer }))
}

// --- Modifier sheet -----------------------------------------------------
const pick = (item) => {
  if (!item.sizes && !item.mods) return addToCart(item)
  pending = { item, mods: new Set(), size: item.sizes?.[0] ?? null }
  $('mod-title').textContent = `${item.emoji} ${item.name}`
  const list = $('mod-list')
  list.replaceChildren()
  if (item.sizes) {
    list.append(el('div', { className: 'mod-group', textContent: 'Size' }))
    item.sizes.forEach((s) => {
      const row = el('div', { className: 'mod-row size-row' + (s === pending.size ? ' on' : '') }, [
        el('span', { textContent: s.name }),
        el('span', { className: 'mod-price', textContent: money(s.price) }),
      ])
      row.onclick = () => {
        pending.size = s
        list.querySelectorAll('.size-row').forEach((r) => r.classList.toggle('on', r === row))
      }
      list.append(row)
    })
  }
  if (item.mods) {
    list.append(el('div', { className: 'mod-group', textContent: 'Add-ons' }))
    item.mods.forEach((m) => {
      const row = el('div', { className: 'mod-row' }, [
        el('span', { textContent: m.name }),
        el('span', { className: 'mod-price', textContent: m.price ? '+' + money(m.price) : 'free' }),
      ])
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
  addToCart(pending.item, pending.size, [...pending.mods])
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

const renderPayment = () => {
  const root = $('view-payment')
  root.replaceChildren()
  if (!cart.length) {
    root.append(el('div', { className: 'r-empty', textContent: 'No active order — add items on the Order screen.' }))
    return
  }
  const status = el('div', { className: 'pay-status' })
  const tap = el('button', { className: 'pay-tap' }, [el('span', { textContent: '📱💳' }), el('div', { textContent: 'Tap to Pay' })])
  tap.onclick = () => startPayment(tap, status)
  root.append(el('div', { className: 'pay-label', textContent: 'Amount due' }))
  root.append(el('div', { className: 'pay-amount', textContent: money(totals().total) }))
  root.append(tap)
  root.append(status)
}

const startPayment = (tap, status) => {
  if (paying) return
  paying = true
  tap.disabled = true
  let i = 0
  const step = () => {
    if (i < PAY_STEPS.length) {
      status.textContent = PAY_STEPS[i++]
      setTimeout(step, 800)
    } else {
      status.className = 'pay-approved'
      status.textContent = 'Approved ✅'
      ding()
      setTimeout(() => {
        commitOrder('Contactless')
        paying = false
        setView('kitchen')
      }, 1800)
    }
  }
  step()
}

// --- Kitchen (cook) -----------------------------------------------------
const advanceStatus = (no) => {
  const o = orders.find((x) => x.no === no)
  if (!o) return
  o.status = STATUSES[Math.min(STATUSES.indexOf(o.status) + 1, STATUSES.length - 1)]
  save('pos-orders', orders)
  render()
}

const renderKitchen = () => {
  const root = $('view-kitchen')
  root.replaceChildren()
  const active = orders.filter((o) => o.status !== 'Done')
  if (!active.length) {
    root.append(el('div', { className: 'kds-empty', textContent: 'NO ACTIVE ORDERS' }))
    return
  }
  const cols = el('div', { id: 'kds' })
  active.forEach((o) => {
    const items = el('div', { className: 'kds-items' })
    o.items.forEach((l) => {
      items.append(el('div', { className: 'kds-item', textContent: `${l.qty} ${l.name}` }))
      l.mods.forEach((m) => items.append(el('div', { className: 'kds-mod', textContent: `+ ${m.name}` })))
    })
    cols.append(el('div', { className: `kds-col s-${o.status.toLowerCase()}` }, [
      el('div', { className: 'kds-head' }, [
        el('span', { className: 'kds-no', textContent: `#${o.no}` }),
        el('span', { className: 'kds-time', textContent: time(o.time) }),
      ]),
      items,
      el('button', { className: 'kds-bump', onclick: () => advanceStatus(o.no), textContent: o.status }),
    ]))
  })
  root.append(cols)
}

// --- Finance (owner) ----------------------------------------------------
const stat = (big, label) => el('div', { className: 'fin-stat' }, [el('div', { className: 'big', textContent: big }), el('div', { className: 'label', textContent: label })])
const row = (cell, vals) => el('tr', {}, vals.map((v) => el(cell, { textContent: v })))

const renderFinance = () => {
  const root = $('view-finance')
  root.replaceChildren()
  const today = new Date().toDateString()
  const todays = orders.filter((o) => new Date(o.time).toDateString() === today)
  const revenue = todays.reduce((s, o) => s + o.total, 0)
  const tax = todays.reduce((s, o) => s + o.tax, 0)

  root.append(el('div', { className: 'fin-summary' }, [
    stat(money(revenue), "Today's revenue"),
    stat(String(todays.length), 'Orders'),
    stat(money(tax), 'Tax collected'),
  ]))

  if (todays.length) {
    const tbody = el('tbody')
    todays.slice().reverse().forEach((o) => {
      const count = o.items.reduce((s, l) => s + l.qty, 0)
      tbody.append(row('td', [`#${o.no}`, time(o.time), o.server, `${count} item${count === 1 ? '' : 's'}`, o.method, o.status, money(o.total)]))
    })
    root.append(el('table', { className: 'fin-table' }, [
      el('thead', {}, [row('th', ['#', 'Time', 'Server', 'Items', 'Payment', 'Status', 'Total'])]),
      tbody,
    ]))
  } else {
    root.append(el('div', { className: 'fin-empty', textContent: 'No orders yet today.' }))
  }

  root.append(el('div', { className: 'fin-actions' }, [
    el('button', {
      className: 'ghost',
      onclick: () => confirm('Clear all recorded orders? This cannot be undone.') && ((orders = []), save('pos-orders', orders), render()),
      textContent: 'Clear all orders',
    }),
  ]))
}

// --- Actions & settings -------------------------------------------------
$('views').onclick = (e) => e.target.dataset.view && setView(e.target.dataset.view)
$('charge-btn').onclick = () => cart.length && setView('payment')
$('clear-btn').onclick = () => {
  cart = []
  persistCart()
}

const form = $('settings-form')

$('settings-btn').onclick = () => {
  Object.keys(DEFAULTS).forEach((k) => (form.elements[k].value = config[k]))
  $('settings-overlay').hidden = false
}

$('settings-save').onclick = () => {
  Object.keys(DEFAULTS).forEach((k) => {
    const v = form.elements[k].value
    config[k] = typeof DEFAULTS[k] === 'number' ? Number(v) : v
  })
  save('pos-config', config)
  $('settings-overlay').hidden = true
  renderMenu()
  render()
}

$('settings-reset').onclick = () => {
  config = { ...DEFAULTS }
  save('pos-config', config)
  Object.keys(DEFAULTS).forEach((k) => (form.elements[k].value = config[k]))
  renderMenu()
  render()
}

// --- Boot ---------------------------------------------------------------
const boot = async () => {
  try {
    MENU = await (await fetch('menu.json')).json()
  } catch {
    $('grid').textContent = 'Could not load menu.json — serve the folder over http (e.g. python3 -m http.server).'
  }
  renderMenu()
  render()
}
boot()
