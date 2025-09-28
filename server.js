const fs = require('fs');
const path = require('path');
const fastify = require('fastify')({ logger: true });
const fastifyStatic = require('@fastify/static');
const fastifyCors = require('@fastify/cors');

// Register CORS + static
fastify.register(fastifyCors, { origin: true });
fastify.register(fastifyStatic, { root: path.join(__dirname, 'public'), prefix: '/' });

// JSON file paths
const peopleFile = path.join(__dirname, 'people_data.json');
const productFile = path.join(__dirname, 'product_data.json');
const teamPeopleFile = path.join(__dirname, 'team_people_data.json');
const teamProductFile = path.join(__dirname, 'team_product_data.json');
const transactionsFile = path.join(__dirname, 'transactions.json');

// Helpers
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf-8'));
const writeJson = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

// Transactions
function readTransactions() { try { return readJson(transactionsFile); } catch { return []; } }
function writeTransactions(data) { writeJson(transactionsFile, data); }
function addTransaction({ menu, user, lines, total, balanceAfter }) {
  const txs = readTransactions();
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const entry = {
    id,
    timestamp: new Date().toISOString(),
    menu,       // "pos" | "team"
    user,
    lines,      // [{ product, qty, unit_price, line_total }]
    total,      // sum(lines.line_total)
    balanceAfter,
    refunded: false,
  };
  txs.push(entry);
  writeTransactions(txs);
  return entry;
}

// Serve main page
fastify.get('/', async (req, reply) => reply.sendFile('home.html'));

// ===== POS People =====
fastify.get('/people', async () => readJson(peopleFile));
fastify.get('/people/:name', async (req, reply) => {
  const { name } = req.params;
  const people = readJson(peopleFile);
  if (people[name] !== undefined) return { [name]: people[name] };
  reply.status(404).send({ error: 'Person not found' });
});
fastify.put('/people', async (req, reply) => {
  const { name, balance } = req.body || {};
  if (!name || typeof balance !== 'number') return reply.status(400).send({ error: 'Invalid' });
  const people = readJson(peopleFile);
  people[name] = balance;
  writeJson(peopleFile, people);
  return { message: `${name} updated`, balance };
});

// ===== POS Products =====
fastify.get('/products', async () => readJson(productFile));

// create/update (upsert)
fastify.put('/products/upsert', async (req, reply) => {
  const { name, price, image } = req.body || {};
  if (!name || typeof price !== 'number' || price < 0) {
    return reply.status(400).send({ error: 'Provide valid name and non-negative price' });
  }
  const products = readJson(productFile);
  if (!products[name]) {
    products[name] = { price, sold: 0 };
  } else {
    products[name].price = price;
    // image: allow set/clear
  }
  if (image === '') {
    delete products[name].image;
  } else if (typeof image === 'string') {
    products[name].image = image;
  }
  writeJson(productFile, products);
  return { message: 'Product upserted', product: { [name]: products[name] } };
});

// delete
fastify.delete('/products/:name', async (req, reply) => {
  const { name } = req.params;
  const products = readJson(productFile);
  if (!products[name]) return reply.status(404).send({ error: 'Product not found' });
  delete products[name];
  writeJson(productFile, products);
  return { message: 'Product deleted' };
});

// ===== POS Order (accurate line items) =====
fastify.post('/order', async (req, reply) => {
  const { name, items } = req.body || {};
  if (!name || !items || typeof items !== 'object') return reply.status(400).send({ error: 'Missing data' });

  const people = readJson(peopleFile);
  if (people[name] === undefined) return reply.status(404).send({ error: 'Person not found' });

  const products = readJson(productFile);
  const lines = [];
  for (const [prod, qtyRaw] of Object.entries(items)) {
    const qty = Math.max(0, Number(qtyRaw) || 0);
    if (qty <= 0) continue;
    const p = products[prod];
    if (!p) return reply.status(404).send({ error: `Unknown product: ${prod}` });
    const unit_price = Number(p.price) || 0;
    const line_total = unit_price * qty;
    lines.push({ product: prod, qty, unit_price, line_total });
  }
  const total = lines.reduce((s, l) => s + l.line_total, 0);
  if (people[name] < total) return reply.status(400).send({ error: 'Insufficient funds' });

  for (const l of lines) {
    products[l.product].sold = Math.max(0, Number(products[l.product].sold) || 0) + l.qty;
  }
  people[name] -= total;

  writeJson(peopleFile, people);
  writeJson(productFile, products);

  const tx = addTransaction({ menu: 'pos', user: name, lines, total, balanceAfter: people[name] });
  return { message: 'Order complete', balance: people[name], transaction: tx };
});

// ===== TEAM People =====
fastify.get('/team_people', async () => readJson(teamPeopleFile));
fastify.get('/team_people/:name', async (req, reply) => {
  const { name } = req.params;
  const people = readJson(teamPeopleFile);
  if (people[name] !== undefined) return { [name]: people[name] };
  reply.status(404).send({ error: 'Team member not found' });
});
fastify.put('/team_people', async (req, reply) => {
  const { name, balance } = req.body || {};
  if (!name || typeof balance !== 'number') return reply.status(400).send({ error: 'Invalid' });
  const people = readJson(teamPeopleFile);
  people[name] = balance;
  writeJson(teamPeopleFile, people);
  return { message: `${name} updated`, balance };
});

// ===== TEAM Products =====
fastify.get('/team_products', async () => readJson(teamProductFile));

// create/update (upsert)
fastify.put('/team_products/upsert', async (req, reply) => {
  const { name, price, image } = req.body || {};
  if (!name || typeof price !== 'number' || price < 0) {
    return reply.status(400).send({ error: 'Provide valid name and non-negative price' });
  }
  const products = readJson(teamProductFile);
  if (!products[name]) {
    products[name] = { price, sold: 0 };
  } else {
    products[name].price = price;
  }
  if (image === '') {
    delete products[name].image;
  } else if (typeof image === 'string') {
    products[name].image = image;
  }
  writeJson(teamProductFile, products);
  return { message: 'Team product upserted', product: { [name]: products[name] } };
});

// delete
fastify.delete('/team_products/:name', async (req, reply) => {
  const { name } = req.params;
  const products = readJson(teamProductFile);
  if (!products[name]) return reply.status(404).send({ error: 'Product not found' });
  delete products[name];
  writeJson(teamProductFile, products);
  return { message: 'Team product deleted' };
});

// ===== TEAM Order =====
fastify.post('/team/order', async (req, reply) => {
  const { name, items } = req.body || {};
  if (!name || !items || typeof items !== 'object') return reply.status(400).send({ error: 'Missing data' });

  const people = readJson(teamPeopleFile);
  if (people[name] === undefined) return reply.status(404).send({ error: 'Team member not found' });

  const products = readJson(teamProductFile);
  const lines = [];
  for (const [prod, qtyRaw] of Object.entries(items)) {
    const qty = Math.max(0, Number(qtyRaw) || 0);
    if (qty <= 0) continue;
    const p = products[prod];
    if (!p) return reply.status(404).send({ error: `Unknown product: ${prod}` });
    const unit_price = Number(p.price) || 0;
    const line_total = unit_price * qty;
    lines.push({ product: prod, qty, unit_price, line_total });
  }
  const total = lines.reduce((s, l) => s + l.line_total, 0);
  if (people[name] < total) return reply.status(400).send({ error: 'Insufficient funds' });

  for (const l of lines) {
    products[l.product].sold = Math.max(0, Number(products[l.product].sold) || 0) + l.qty;
  }
  people[name] -= total;

  writeJson(teamPeopleFile, people);
  writeJson(teamProductFile, products);

  const tx = addTransaction({ menu: 'team', user: name, lines, total, balanceAfter: people[name] });
  return { message: 'Team order complete', balance: people[name], transaction: tx };
});

// ===== Transactions & Reports =====
fastify.get('/transactions', async () => readTransactions());

fastify.post('/transactions/refund/:id', async (req, reply) => {
  const { id } = req.params;
  const txs = readTransactions();
  const tx = txs.find(t => t.id === id);
  if (!tx) return reply.status(404).send({ error: 'Transaction not found' });
  if (tx.refunded) return reply.status(400).send({ error: 'Already refunded' });

  const peoplePath = tx.menu === 'team' ? teamPeopleFile : peopleFile;
  const productsPath = tx.menu === 'team' ? teamProductFile : productFile;

  const people = readJson(peoplePath);
  if (people[tx.user] === undefined) return reply.status(404).send({ error: 'User not found' });
  people[tx.user] += Number(tx.total) || 0;
  writeJson(peoplePath, people);

  const products = readJson(productsPath);
  for (const l of tx.lines || []) {
    if (products[l.product]) {
      products[l.product].sold = Math.max(0, Number(products[l.product].sold) || 0) - Number(l.qty || 0);
      if (products[l.product].sold < 0) products[l.product].sold = 0;
    }
  }
  writeJson(productsPath, products);

  tx.refunded = true;
  writeTransactions(txs);
  return { message: 'Refund complete', transaction: tx };
});

fastify.get('/reports/users', async () => {
  const tally = {};
  for (const tx of readTransactions()) {
    if (tx.refunded) continue;
    tally[tx.user] = (tally[tx.user] || 0) + (Number(tx.total) || 0);
  }
  return tally;
});
fastify.get('/reports/products', async () => {
  const tally = {};
  for (const tx of readTransactions()) {
    if (tx.refunded) continue;
    for (const l of (tx.lines || [])) {
      tally[l.product] = (tally[l.product] || 0) + Number(l.qty || 0);
    }
  }
  return tally;
});

// Start server
fastify.listen({ port: 3000, host: "0.0.0.0" })
  .then(() => console.log("Server running at http://localhost:3000"))
  .catch(err => { fastify.log.error(err); process.exit(1); });
