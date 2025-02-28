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

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')).accounts;
const proxies = fs.existsSync(proxiesPath) ? fs.readFileSync(proxiesPath, 'utf8').split('\n').filter(line => line.trim() !== '') : [];

function getProxyAgent(proxy) {
    if (!proxy) return null;
    if (proxy.startsWith('http')) return new HttpsProxyAgent(proxy);
    if (proxy.startsWith('socks4') || proxy.startsWith('socks5')) return new SocksProxyAgent(proxy);
    return null;
}

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
            this.cognitoUser.authenticateUser(this.authenticationDetails, {
                onSuccess: (result) => resolve({
                    accessToken: result.getAccessToken().getJwtToken(),
                    idToken: result.getIdToken().getJwtToken(),
                    refreshToken: result.getRefreshToken().getToken()
                }),
                onFailure: reject
            });
        });
    }
}

async function validateAccount(account, proxy) {
    try {
        const auth = new CognitoAuth(account);
        const tokens = await auth.authenticate();
        console.log(`✅ Successfully authenticated ${account.email}`);

        const response = await axios.get(`${config.stork.baseURL}/me`, {
            headers: { 'Authorization': `Bearer ${tokens.accessToken}` },
            httpsAgent: getProxyAgent(proxy)
        });

        console.log(`📊 User Stats for ${account.email}:`, response.data);
    } catch (error) {
        console.error(`❌ Error validating ${account.email}:`, error.message);
    }
}

async function runAllAccounts() {
    const tasks = accounts.map((account, index) => {
        const proxy = proxies.length > 0 ? proxies[index % proxies.length] : null;
        return validateAccount(account, proxy);
    });

    await Promise.all(tasks);
    console.log("🎉 All accounts processed!");
}

if (isMainThread) {
    runAllAccounts();
} else {
    validateAccount(workerData.account, workerData.proxy);
}
