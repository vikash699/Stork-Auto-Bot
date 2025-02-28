const fs = require('fs');
const path = require('path');
const { Worker, isMainThread } = require('worker_threads');

// Utility function to load JSON files
function loadJSON(filename) {
  try {
    const filepath = path.join(__dirname, filename);
    if (!fs.existsSync(filepath)) {
      throw new Error(`${filename} not found.`);
    }
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (error) {
    console.error(`Error loading ${filename}:`, error.message);
    process.exit(1);
  }
}

// Load configurations
const config = loadJSON('config.json');
const accounts = loadJSON('accounts.json');
const proxies = loadJSON('proxies.json');

console.log(`Loaded ${accounts.length} accounts and ${proxies.length} proxies.`);

// Function to get a proxy for an account
function getProxy(index) {
  if (proxies.length === 0) return null;
  return proxies[index % proxies.length]; // Rotate proxies
}

// Worker function to run each account independently
function runWorker(account, proxy) {
  return new Promise((resolve) => {
    const worker = new Worker('./worker.js', { workerData: { account, proxy } });
    worker.on('message', resolve);
    worker.on('error', (error) => resolve({ success: false, error: error.message }));
    worker.on('exit', () => resolve({ success: false, error: 'Worker exited' }));
  });
}

// Main function to start multiple workers
async function main() {
  if (isMainThread) {
    console.log("Starting multi-account bot...");

    const workers = accounts.map((account, index) => {
      const proxy = getProxy(index);
      return runWorker(account, proxy);
    });

    const results = await Promise.all(workers);
    console.log("All accounts processed:", results);
  }
}

main();
