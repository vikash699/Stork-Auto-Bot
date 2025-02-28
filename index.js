const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const AmazonCognitoIdentity = require('amazon-cognito-identity-js');
const axios = require('axios');

global.navigator = { userAgent: 'node' };

// Load configuration & accounts
const configPath = path.join(__dirname, 'config.json');
const accountsPath = path.join(__dirname, 'accounts.json');
const proxiesPath = path.join(__dirname, 'proxies.txt');

console.log("📂 Loading configuration files...");

// Check if files exist
if (!fs.existsSync(configPath)) {
    console.error("❌ ERROR: config.json not found!");
    process.exit(1);
}

if (!fs.existsSync(accountsPath)) {
    console.error("❌ ERROR: accounts.json not found!");
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')).accounts || [];
const proxies = fs.existsSync(proxiesPath) ? fs.readFileSync(proxiesPath, 'utf8').split('\n').filter(line => line.trim() !== '') : [];

console.log(`✅ Loaded ${accounts.length} accounts.`);
console.log(`✅ Loaded ${proxies.length} proxies.`);

// Validate Config
if (!config.stork || !config.stork.baseURL) {
    console.error("❌ ERROR: stork.baseURL missing in config.json!");
    process.exit(1);
}

// Function to get proxy agent
function getProxyAgent(proxy) {
    if (!proxy) return null;
    if (proxy.startsWith('http')) return new HttpsProxyAgent(proxy);
    if (proxy.startsWith('socks4') || proxy.startsWith('socks5')) return new SocksProxyAgent(proxy);
    return null;
}

// Cognito Authentication Class
class CognitoAuth {
    constructor(account) {
        this.username = account.email;
        this.password = account.password;
        this.userPoolId = account.userPoolId;
        this.clientId = account.clientId;

        this.authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
            Username: this.username,
            Password: this.password
        });

        this.cognitoUser = new AmazonCognitoIdentity.CognitoUser({
            Username: this.username,
            Pool: new AmazonCognitoIdentity.CognitoUserPool({
                UserPoolId: this.userPoolId,
                ClientId: this.clientId
            })
        });
    }

    authenticate() {
        return new Promise((resolve, reject) => {
            console.log(`🔄 Authenticating: ${this.username}`);
            
            this.cognitoUser.authenticateUser(this.authenticationDetails, {
                onSuccess: (result) => {
                    console.log(`✅ Authentication successful for ${this.username}`);
                    resolve({
                        accessToken: result.getAccessToken().getJwtToken(),
                        idToken: result.getIdToken().getJwtToken(),
                        refreshToken: result.getRefreshToken().getToken()
                    });
                },
                onFailure: (err) => {
                    console.error(`❌ Authentication failed for ${this.username}: ${err.message}`);
                    reject(err);
                }
            });
        });
    }
}

// Function to Validate & Fetch User Stats
async function validateAccount(account, proxy) {
    console.log(`🔄 Processing account: ${account.email} | Proxy: ${proxy || "No Proxy"}`);

    try {
        const auth = new CognitoAuth(account);
        const tokens = await auth.authenticate();

        console.log(`📡 Fetching stats for ${account.email}...`);
        const response = await axios.get(`${config.stork.baseURL}/me`, {
            headers: { 'Authorization': `Bearer ${tokens.accessToken}` },
            httpsAgent: getProxyAgent(proxy)
        });

        console.log(`📊 User Stats for ${account.email}:`, response.data);
    } catch (error) {
        console.error(`❌ Error validating ${account.email}:`, error.message);
    }
}

// Function to Run All Accounts
async function runAllAccounts() {
    console.log("🚀 Starting Multi-Account Authentication...");

    if (!accounts.length) {
        console.error("⚠️ No accounts found in accounts.json!");
        return;
    }

    console.log(`📌 Found ${accounts.length} accounts. Processing now...`);

    const tasks = accounts.map((account, index) => {
        const proxy = proxies.length > 0 ? proxies[index % proxies.length] : null;
        console.log(`🔄 Authenticating ${account.email} using proxy: ${proxy || "No Proxy"}`);
        return validateAccount(account, proxy);
    });

    await Promise.all(tasks);
    console.log("🎉 All accounts processed!");
}

// Start Execution
if (isMainThread) {
    runAllAccounts();
} else {
    validateAccount(workerData.account, workerData.proxy);
}
