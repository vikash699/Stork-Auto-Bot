const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const AmazonCognitoIdentity = require('amazon-cognito-identity-js');
const axios = require('axios');

global.navigator = { userAgent: 'node' };

// Load configuration
const configPath = path.join(__dirname, 'config.json');
const accountsPath = path.join(__dirname, 'accounts.json');
const proxiesPath = path.join(__dirname, 'proxies.txt');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const accounts = JSON.parse(fs.readFileSync(__dirname + '/accounts.json', 'utf8'));
const proxies = fs.existsSync(proxiesPath) ? fs.readFileSync(proxiesPath, 'utf8').split('\n').filter(line => line.trim() !== '') : [];

function getProxyAgent(proxy) {
    if (!proxy) return null;
    if (proxy.startsWith('http')) return new HttpsProxyAgent(proxy);
    if (proxy.startsWith('socks4') || proxy.startsWith('socks5')) return new SocksProxyAgent(proxy);
    return null;
}

class CognitoAuth {
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username: username, Password: password });
        this.cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username: username, Pool: new AmazonCognitoIdentity.CognitoUserPool({ UserPoolId: config.cognito.userPoolId, ClientId: config.cognito.clientId }) });
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
        const auth = new CognitoAuth(account.email, account.password);
        const tokens = await auth.authenticate();
        console.log(`Successfully authenticated ${account.email}`);

        const response = await axios.get(`${config.stork.baseURL}/me`, {
            headers: { 'Authorization': `Bearer ${tokens.accessToken}` },
            httpsAgent: getProxyAgent(proxy)
        });

        console.log(`User Stats for ${account.email}:`, response.data);
    } catch (error) {
        console.error(`Error validating ${account.email}:`, error.message);
    }
}

async function runAllAccounts() {
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;
        await validateAccount(account, proxy);
    }
}

if (isMainThread) {
    runAllAccounts();
} else {
    validateAccount(workerData.account, workerData.proxy);
}
