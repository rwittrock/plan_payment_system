// server.js
const fs = require('fs');
const path = require('path');
const fastify = require('fastify')({ logger: true });
const fastifyStatic = require('@fastify/static');
const { log } = require('console');

function logToFile(input, filePath = 'log.txt') {
  const logFile = path.join(__dirname, filePath); // Define the log file location
  const timestamp = new Date().toISOString(); // Get the current timestamp
  const logEntry = `${timestamp} - ${input}\n`; // Format the log entry

  fs.appendFile(logFile, logEntry, (err) => {
      if (err) {
          console.error('Error writing to log file:', err);
      } 
  });
}

// Example usage:
logToFile('This is a test log entry.');

// Register the fastify-static plugin to serve static files
fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'public'), // Assuming your HTML file is in a "public" folder
    prefix: '/', // Optional: to serve files from the root
  });
  
// Route: Serve home.html when accessing the root "/"
fastify.get('/', async (request, reply) => {
    logToFile(request)
    return reply.sendFile('home.html'); // Ensure 'home.html' is in the 'public' folder
});

// Run the server
const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
    console.log('Server running at http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Path to the JSON file
const peopleDataFilePath = path.join(__dirname, 'people_data.json');
const productsDataFilePath = path.join(__dirname, 'product_data.json');

// Helper function to read the JSON file
const readPeopleData = () => {
  const data = fs.readFileSync(peopleDataFilePath);
  return JSON.parse(data);
};
const readProductData = () => {
    const data = fs.readFileSync(productsDataFilePath);
    return JSON.parse(data);
  };
// Helper function to write data back to the JSON file
const writePeopleData = (data) => {
  fs.writeFileSync(peopleDataFilePath, JSON.stringify(data, null, 2));
};
// Helper function to write product data back to the JSON file
const writeProductData = (data) => {
    fs.writeFileSync(productsDataFilePath, JSON.stringify(data, null, 2));
  };

// Route: Get all people and their balances
fastify.get('/people', async (request, reply) => {
  logToFile(request)
  const data = readPeopleData();
  return data;
});

// Route: Get a list of all products and their prices
fastify.get('/products', async (request, reply) => {
  logToFile(request)
  
    // Extract the product names and prices
    const products = readProductData();
    return products;
});

  
  // Route: Add to the 'sold' count for a list of products
fastify.post('/products/sold', async (request, reply) => {
    const productsSold = request.body;
    logToFile(request)  
    // Example input structure for productsSold:
    /* 
    {
        "productsSold": {
            "snickers": 5,
            "beer": 10
        }
    }
    */
  
    if (!productsSold || typeof productsSold !== 'object') {
      return reply.status(400).send({ error: 'Invalid input' });
    }
  
    const data = readProductData();
  
    // Iterate over the provided product names and sold amounts
    for (const product in productsSold) {
      if (data[product]) {
        data[product].sold += productsSold[product];
        logToFile("sold " + data[product].sold + " " +data[product])
      } else {
        return reply.status(404).send({ error: `Product '${product}' not found` });
      }
    }
  
    // Write the updated data back to the JSON file
    writeProductData(data);
  
    return { message: 'Sold counts updated successfully' };
});

// Route: Get a specific person’s balance
fastify.get('/people/:name', async (request, reply) => {
  const { name } = request.params;
  const data = readPeopleData();

  if (data[name]) {
    return { [name]: data[name] };
  } else {
    reply.status(404).send({ error: 'Person not found' });
  }
});

// Route: Add/update a person’s money
fastify.put('/update_person', async (request, reply) => {
    console.log(request.body)
    const { name, balance } = request.body;
    console.log(name)
    console.log(balance)
    
    if (!name || typeof balance !== 'number') {
        return reply.status(400).send({ error: 'Invalid input' });
    }

    const data = readPeopleData();
    data[name] = balance;
    writePeopleData(data);
    logToFile(name + "'s balance set to " + balance)

    return { message: `${name}'s balance updated to ${balance}` };
});



// Run the server
start();
