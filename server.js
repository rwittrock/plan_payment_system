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

// create/update (upsert) — NO images
fastify.put('/products/upsert', async (req, reply) => {
  const { name, price } = req.body || {};
  if (!name || typeof price !== 'number' || price < 0) {
    return reply.status(400).send({ error: 'Provide valid name and non-negative price' });
  }
  const products = readJson(productFile);
  if (!products[name]) {
    products[name] = { price, sold: 0 };
  } else {
    products[name].price = price;
  }
  // Ensure we don't carry over any legacy image keys if present
  if (products[name].image !== undefined) delete products[name].image;

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

// create/update (upsert) — NO images
fastify.put('/team_products/upsert', async (req, reply) => {
  const { name, price } = req.body || {};
  if (!name || typeof price !== 'number' || price < 0) {
    return reply.status(400).send({ error: 'Provide valid name and non-negative price' });
  }
  const products = readJson(teamProductFile);
  if (!products[name]) {
    products[name] = { price, sold: 0 };
  } else {
    products[name].price = price;
  }
  if (products[name].image !== undefined) delete products[name].image;

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
  const txIndex = txs.findIndex(t => t.id === id);
  if (txIndex === -1) return reply.status(404).send({ error: 'Transaction not found' });

  const tx = txs[txIndex];
  if (tx.refunded) return reply.status(400).send({ error: 'Already refunded' });

  // --- Compute refundTotal strictly from recorded lines (price at time of sale) ---
  const lines = Array.isArray(tx.lines) ? tx.lines : [];
  const recomputedTotal = lines.reduce((sum, l) => {
    const qty = Math.max(0, Number(l.qty) || 0);
    const unit_price = Number(l.unit_price) || 0;
    return sum + qty * unit_price;
  }, 0);

  // If tx.total is absent or inconsistent, fix it so reporting stays coherent.
  const refundTotal = Number.isFinite(Number(tx.total)) ? Number(tx.total) : recomputedTotal;
  if (Math.abs(refundTotal - recomputedTotal) > 1e-6) {
    // normalize stored total so everything is consistent going forward
    tx.total = recomputedTotal;
  }

  // --- Choose the correct ledgers based on menu ---
  const peoplePath = tx.menu === 'team' ? teamPeopleFile : peopleFile;
  const productsPath = tx.menu === 'team' ? teamProductFile : productFile;

  // --- Refund the user balance first ---
  const people = readJson(peoplePath);
  if (people[tx.user] === undefined) return reply.status(404).send({ error: 'User not found' });
  people[tx.user] += recomputedTotal; // always price-at-purchase, never current price
  writeJson(peoplePath, people);

  // --- Reverse sold counters using recorded quantities ---
  const products = readJson(productsPath);
  for (const l of lines) {
    const pname = l.product;
    const qty = Math.max(0, Number(l.qty) || 0);
    if (!products[pname]) {
      // product was deleted/renamed later; we still processed the balance refund
      // skip sold-counter reversal for this line
      continue;
    }
    const sold = Math.max(0, Number(products[pname].sold) || 0);
    products[pname].sold = Math.max(0, sold - qty);
  }
  writeJson(productsPath, products);

  // --- Mark refunded and persist ---
  tx.refunded = true;
  txs[txIndex] = tx;
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
