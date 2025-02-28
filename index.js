const AmazonCognitoIdentity = require('amazon-cognito-identity-js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

global.navigator = { userAgent: 'node' };

// Load configuration from config.json
function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'config.json');
        if (!fs.existsSync(configPath)) {
            console.log(`Config file not found at ${configPath}, using default configuration`);
            // Create default config file
            const defaultConfig = {
                accounts: [
                    { username: 'YOUR_EMAIL', password: 'YOUR_PASSWORD' }
                ],
                proxies: [
                    "http://proxy.example.com:8080"
                ],
                stork: { intervalSeconds: 5 },
                threads: { maxWorkers: 1 }
            };
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
            return defaultConfig;
        }
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        console.error(`Error loading config: ${error.message}`);
        throw new Error('Failed to load configuration');
    }
}

const config = loadConfig();

function getProxyAgent(proxy) {
    if (!proxy) return null;
    if (proxy.startsWith('http')) return new HttpsProxyAgent(proxy);
    if (proxy.startsWith('socks4') || proxy.startsWith('socks5')) return new SocksProxyAgent(proxy);
    throw new Error(`Unsupported proxy protocol: ${proxy}`);
}

async function authenticateUser(account, proxy) {
    try {
        const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
            Username: account.username,
            Password: account.password
        });
        const userPool = new AmazonCognitoIdentity.CognitoUserPool({
            UserPoolId: config.cognito.userPoolId,
            ClientId: config.cognito.clientId
        });
        const cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username: account.username, Pool: userPool });

        return new Promise((resolve, reject) => {
            cognitoUser.authenticateUser(authenticationDetails, {
                onSuccess: (result) => resolve(result.getAccessToken().getJwtToken()),
                onFailure: (err) => reject(err)
            });
        });
    } catch (error) {
        console.error(`Authentication error for ${account.username}: ${error.message}`);
        throw error;
    }
}

async function runForMultipleAccounts() {
    for (let i = 0; i < config.accounts.length; i++) {
        const account = config.accounts[i];
        const proxy = config.proxies[i % config.proxies.length] || null;

        try {
            console.log(`Authenticating ${account.username} with proxy ${proxy || 'none'}`);
            const token = await authenticateUser(account, proxy);
            console.log(`Authenticated ${account.username}, Token: ${token.substring(0, 10)}...`);
        } catch (error) {
            console.error(`Failed to authenticate ${account.username}: ${error.message}`);
        }
    }
}

runForMultipleAccounts();
