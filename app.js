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

// --- State --------------------------------------------------------------
const load = (k, fallback) => JSON.parse(localStorage.getItem(k)) ?? fallback
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v))

let config = { ...DEFAULTS, ...load('pos-config', {}) }
let cart = load('pos-cart', [])
let paid = false
let pending = null // item awaiting modifier selection

const $ = (id) => document.getElementById(id)
const money = (n) => config.currency + n.toFixed(2)

// --- Cart ---------------------------------------------------------------
const lineTotal = (l) => (l.price + l.mods.reduce((s, m) => s + m.price, 0)) * l.qty
const keyOf = (item, mods) => item.id + '|' + mods.map((m) => m.name).sort().join(',')

const addToCart = (item, mods = []) => {
  if (paid) newOrder()
  const key = keyOf(item, mods)
  const found = cart.find((l) => l.key === key)
  if (found) found.qty++
  else cart.push({ emoji: item.emoji, key, mods, name: item.name, price: item.price, qty: 1 })
  persist()
}

const changeQty = (key, delta) => {
  const l = cart.find((x) => x.key === key)
  if (!l) return
  l.qty += delta
  if (l.qty < 1) cart = cart.filter((x) => x.key !== key)
  persist()
}

const newOrder = () => {
  cart = []
  paid = false
  persist()
}

const persist = () => {
  save('pos-cart', cart)
  render()
}

// --- Rendering ----------------------------------------------------------
const el = (tag, props = {}, kids = []) => {
  const node = Object.assign(document.createElement(tag), props)
  kids.forEach((k) => node.append(k))
  return node
}

const renderMenu = () => {
  const grid = $('grid')
  grid.replaceChildren()
  MENU.forEach((cat) => {
    const tiles = el('div', { className: 'cat-grid' })
    cat.items.forEach((item) => {
      const tile = el('button', { className: 'tile', onclick: () => pick(item) }, [
        el('span', { className: 'emoji', textContent: item.emoji }),
        el('span', { className: 'name', textContent: item.name }),
        el('span', { className: 'price', textContent: money(item.price) }),
      ])
      if (item.mods) tile.append(el('span', { className: 'badge', textContent: '+ options' }))
      tiles.append(tile)
    })
    grid.append(el('section', { className: 'cat' }, [el('h2', { textContent: cat.name }), tiles]))
  })
}

const renderReceipt = () => {
  const box = $('receipt')
  box.replaceChildren()
  const now = new Date()

  box.append(el('div', { className: 'r-head' }, [
    el('div', { className: 'store', textContent: config.store }),
    el('div', { className: 'r-meta', textContent: config.location }),
    el('div', { className: 'r-meta', textContent: config.phone }),
  ]))
  box.append(el('hr', { className: 'r-rule' }))
  box.append(el('div', { className: 'r-meta', textContent: `Order #${config.orderNo}` }))
  box.append(el('div', { className: 'r-meta', textContent: `Server: ${config.server}` }))
  box.append(el('div', { className: 'r-meta', textContent: now.toLocaleString() }))
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
    l.mods.forEach((m) =>
      line.append(el('span', { className: 'r-mod', textContent: `+ ${m.name}${m.price ? ' ' + money(m.price) : ''}` })),
    )
    if (!paid)
      line.append(el('div', { className: 'r-controls' }, [
        el('button', { onclick: () => changeQty(l.key, -1), textContent: '−' }),
        el('button', { onclick: () => changeQty(l.key, 1), textContent: '+' }),
      ]))
    box.append(line)
  })

  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0)
  const tax = subtotal * (config.taxRate / 100)
  box.append(el('hr', { className: 'r-rule' }))
  box.append(el('div', { className: 'r-totals' }, [
    el('div', {}, [el('span', { textContent: 'Subtotal' }), el('span', { textContent: money(subtotal) })]),
    el('div', {}, [el('span', { textContent: `Tax (${config.taxRate}%)` }), el('span', { textContent: money(tax) })]),
    el('div', { className: 'r-grand' }, [el('span', { textContent: 'Total' }), el('span', { textContent: money(subtotal + tax) })]),
  ]))

  if (paid) box.append(el('div', { className: 'paid', textContent: 'PAID ✅' }))
  box.append(el('hr', { className: 'r-rule' }))
  box.append(el('div', { className: 'r-foot', textContent: config.footer }))
}

const GREETINGS = [
  (c) => `Welcome to ${c.store}! I'm ${c.server} — what can I get started for you? 😊`,
  (c) => `Hi there! ${c.server} here at ${c.store}. What would you like today? 🍔`,
  (c) => `Howdy! Thanks for stopping by ${c.store}. I'm ${c.server} — what can I get for you? 🎈`,
  (c) => `Good to see you! I'm ${c.server} and I'll be taking care of you. What sounds good today? 🌟`,
]

const render = () => {
  $('brand').textContent = config.store
  $('greeting').textContent = GREETINGS[config.orderNo % GREETINGS.length](config)
  $('charge-btn').textContent = paid ? 'New order' : 'Charge'
  renderReceipt()
}

// --- Modifier sheet -----------------------------------------------------
const pick = (item) => {
  if (!item.mods) return addToCart(item)
  pending = { chosen: new Set(), item }
  $('mod-title').textContent = `${item.emoji} ${item.name}`
  const list = $('mod-list')
  list.replaceChildren()
  item.mods.forEach((m) => {
    const row = el('div', { className: 'mod-row' }, [
      el('span', { textContent: m.name }),
      el('span', { className: 'mod-price', textContent: m.price ? '+' + money(m.price) : 'free' }),
    ])
    row.onclick = () => {
      pending.chosen.has(m) ? pending.chosen.delete(m) : pending.chosen.add(m)
      row.classList.toggle('on')
    }
    list.append(row)
  })
  $('mod-overlay').hidden = false
}

$('mod-add').onclick = () => {
  addToCart(pending.item, [...pending.chosen])
  $('mod-overlay').hidden = true
}
$('mod-cancel').onclick = () => ($('mod-overlay').hidden = true)

// --- Actions ------------------------------------------------------------
$('charge-btn').onclick = () => {
  if (paid) return newOrder()
  if (!cart.length) return
  paid = true
  render()
  config.orderNo = Number(config.orderNo) + 1
  save('pos-config', config)
}

$('clear-btn').onclick = newOrder

// --- Settings -----------------------------------------------------------
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
  render()
  renderMenu()
}

$('settings-reset').onclick = () => {
  config = { ...DEFAULTS }
  save('pos-config', config)
  Object.keys(DEFAULTS).forEach((k) => (form.elements[k].value = config[k]))
  render()
  renderMenu()
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
