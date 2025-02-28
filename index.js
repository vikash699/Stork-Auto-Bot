const fs = require('fs');
const axios = require('axios');
const path = require('path');

const config = {
  baseURL: 'https://app-api.jp.stork-oracle.network/v1',
  authURL: 'https://api.jp.stork-oracle.network/auth',  
  tokenPath: path.join(__dirname, 'tokens.json'),  
  intervalSeconds: 10, // Polling interval in seconds
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  origin: 'chrome-extension://knnliglhgkmlblppdejchidfihjnockl'
};

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substr(0, 19);
}

function getFormattedDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function log(message, type = 'INFO') {
  console.log(`[${getFormattedDate()}] [${type}] ${message}`);
}

async function getTokens() {
  try {
    log(`Reading tokens from ${config.tokenPath}...`);
    
    if (!fs.existsSync(config.tokenPath)) {
      throw new Error(`Tokens file not found at ${config.tokenPath}`);
    }
    
    const tokensData = await fs.promises.readFile(config.tokenPath, 'utf8');
    const tokens = JSON.parse(tokensData);
    
    if (!tokens.accessToken || tokens.accessToken.length < 20) {
      throw new Error('Invalid access token (too short or empty)');
    }
    
    log(`Successfully read access token: ${tokens.accessToken.substring(0, 10)}...`);
    return tokens;
  } catch (error) {
    log(`Error reading tokens: ${error.message}`, 'ERROR');
    throw error;
  }
}

async function saveTokens(tokens) {
  try {
    await fs.promises.writeFile(config.tokenPath, JSON.stringify(tokens, null, 2), 'utf8');
    log('Tokens saved successfully');
    return true;
  } catch (error) {
    log(`Error saving tokens: ${error.message}`, 'ERROR');
    return false;
  }
}

async function refreshTokens(refreshToken) {
  try {
    log('Refreshing access token...');
    
    const response = await axios({
      method: 'POST',
      url: `${config.authURL}/refresh`,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': config.userAgent,
        'Origin': config.origin
      },
      data: {
        refresh_token: refreshToken
      }
    });
    
    if (response.status !== 200 || !response.data || !response.data.access_token) {
      throw new Error(`Failed to refresh token: ${response.status}`);
    }
    
    const tokens = {
      accessToken: response.data.access_token,
      idToken: response.data.id_token || '',
      refreshToken: response.data.refresh_token || refreshToken,
      isAuthenticated: true,
      isVerifying: false
    };
    
    log('Token refreshed successfully');
    await saveTokens(tokens);
    return tokens;
  } catch (error) {
    log(`Token refresh failed: ${error.message}`, 'ERROR');
    throw error;
  }
}

async function getSignedPrices(tokens) {
  let currentTokens = tokens;
  let retryCount = 0;
  const maxRetries = 1;
  
  while (retryCount <= maxRetries) {
    try {
      log('Fetching signed prices data...');
      
      const response = await axios({
        method: 'GET',
        url: `${config.baseURL}/stork_signed_prices`,
        headers: {
          'Authorization': `Bearer ${currentTokens.accessToken}`,
          'Content-Type': 'application/json',
          'Origin': config.origin,
          'User-Agent': config.userAgent,
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'cross-site'
        },
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        }
      });
      
      if (response.status === 401) {
        if (retryCount < maxRetries && currentTokens.refreshToken) {
          log('Access token expired, attempting to refresh...', 'WARN');
          currentTokens = await refreshTokens(currentTokens.refreshToken);
          retryCount++;
          continue;
        } else {
          throw new Error('Token refresh failed or maximum retries reached');
        }
      }
      
      if (response.status !== 200) {
        log(`API responded with status ${response.status}`, 'WARN');
        log(`Response body: ${JSON.stringify(response.data || {})}`, 'DEBUG');
        return [];
      }
      
      if (!response.data || !response.data.data) {
        log(`Response format incorrect: ${JSON.stringify(response.data || {})}`, 'WARN');
        return [];
      }
      
      const dataObj = response.data.data;
      const result = Object.keys(dataObj).map(assetKey => {
        const assetData = dataObj[assetKey];
        return {
          asset: assetKey,
          msg_hash: assetData.timestamped_signature.msg_hash,
          price: assetData.price,
          timestamp: new Date(assetData.timestamped_signature.timestamp / 1000000).toISOString(),
          ...assetData  
        };
      });
      
      log(`Successfully retrieved ${result.length || 0} signed prices`);
      return result;
    } catch (error) {
      if (error.response) {
        const statusCode = error.response.status;
        const errorMessage = error.response.data?.message || error.response.data?.error || error.message;
        
        log(`Error getting signed prices: Status ${statusCode}, Message: ${errorMessage}`, 'ERROR');
        
        if (statusCode === 401 && retryCount < maxRetries && currentTokens.refreshToken) {
          log('Token may be expired, attempting to refresh...', 'WARN');
          try {
            currentTokens = await refreshTokens(currentTokens.refreshToken);
            retryCount++;
            continue;
          } catch (refreshError) {
            log('Token refresh failed, update tokens manually', 'ERROR');
          }
        }
      } else {
        log(`Error getting signed prices: ${error.message}`, 'ERROR');
      }
      
      throw error;
    }
  }
}

async function sendValidation(tokens, msgHash, isValid) {
  let currentTokens = tokens;
  let retryCount = 0;
  const maxRetries = 1;
  
  while (retryCount <= maxRetries) {
    try {
      const payload = {
        msg_hash: msgHash,
        valid: isValid
      };
      
      log(`Validation: ${msgHash.substring(0, 10)}... = ${isValid ? 'VALID' : 'INVALID'}`);
      
      const response = await axios({
        method: 'POST',
        url: `${config.baseURL}/stork_signed_prices/validations`,
        headers: {
          'Authorization': `Bearer ${currentTokens.accessToken}`,
          'Content-Type': 'application/json',
          'Origin': config.origin,
          'User-Agent': config.userAgent,
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'cross-site'
        },
        data: payload
      });
      
      log(`✓ Validation successful: ${response.data.message || 'Status ' + response.status}`);
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 401 && retryCount < maxRetries && currentTokens.refreshToken) {
        log('Token expired during validation, attempting to refresh...', 'WARN');
        try {
          currentTokens = await refreshTokens(currentTokens.refreshToken);
          retryCount++;
          continue;
        } catch (refreshError) {
          log('Token refresh failed, update tokens manually', 'ERROR');
        }
      }
      
      log(`✗ Validation failed: ${error.response?.status || error.message}`, 'ERROR');
      
      if (error.response?.data) {
        log(`Error response: ${JSON.stringify(error.response.data)}`, 'DEBUG');
      }
      
      throw error;
    }
  }
}

function validatePrice(priceData) {
  try {
    log(`Validating data for ${priceData.asset || 'unknown asset'}`);
    
    if (!priceData.msg_hash || !priceData.price || !priceData.timestamp) {
      log('Incomplete data, considered invalid', 'WARN');
      return false;
    }
    
    const currentTime = Date.now();
    const dataTime = new Date(priceData.timestamp).getTime();
    const timeDiffMinutes = (currentTime - dataTime) / (1000 * 60);
    
    if (timeDiffMinutes > 60) { 
      log(`Data too old (${Math.round(timeDiffMinutes)} minutes ago)`, 'WARN');
      return false;
    }
    
    return true;
  } catch (error) {
    log(`Validation error: ${error.message}`, 'ERROR');
    return false; 
  }
}

async function getUserStats(tokens) {
  let currentTokens = tokens;
  let retryCount = 0;
  const maxRetries = 1;
  
  while (retryCount <= maxRetries) {
    try {
      log('Fetching user stats...');
      
      const response = await axios({
        method: 'GET',
        url: `${config.baseURL}/me`,
        headers: {
          'Authorization': `Bearer ${currentTokens.accessToken}`,
          'Content-Type': 'application/json',
          'Origin': config.origin,
          'User-Agent': config.userAgent,
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'cross-site'
        },
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        }
      });
      
      if (response.status === 401) {
        if (retryCount < maxRetries && currentTokens.refreshToken) {
          log('Access token expired, attempting to refresh...', 'WARN');
          currentTokens = await refreshTokens(currentTokens.refreshToken);
          retryCount++;
          continue;
        } else {
          throw new Error('Token refresh failed or maximum retries reached');
        }
      }
      
      if (response.status !== 200) {
        log(`API responded with status ${response.status}`, 'WARN');
        log(`Response body: ${JSON.stringify(response.data || {})}`, 'DEBUG');
        
        return null;
      }
      
      if (!response.data || !response.data.data) {
        log(`Response format incorrect: ${JSON.stringify(response.data || {})}`, 'WARN');
        return null;
      }
      
      return response.data.data;
    } catch (error) {
      if (error.response && error.response.status === 401 && retryCount < maxRetries && currentTokens.refreshToken) {
        log('Token expired while getting stats, attempting to refresh...', 'WARN');
        try {
          currentTokens = await refreshTokens(currentTokens.refreshToken);
          retryCount++;
          continue;
        } catch (refreshError) {
          log('Token refresh failed, update tokens manually', 'ERROR');
        }
      } else {
        log(`Error getting user stats: ${error.message}`, 'ERROR');
      }
      
      throw error;
    }
  }
}

let previousStats = {
  validCount: 0,
  invalidCount: 0
};

async function runValidationProcess() {
  try {
    log('--------- STARTING VALIDATION PROCESS ---------');
    
    const tokens = await getTokens();
    if (!tokens || !tokens.accessToken) {
      throw new Error('Empty or invalid access token');
    }
    
    const initialUserData = await getUserStats(tokens);
    if (!initialUserData || !initialUserData.stats) {
      throw new Error('Could not fetch initial user stats');
    }
    
    const initialValidCount = initialUserData.stats.stork_signed_prices_valid_count || 0;
    const initialInvalidCount = initialUserData.stats.stork_signed_prices_invalid_count || 0;
    
    if (previousStats.validCount === 0 && previousStats.invalidCount === 0) {
      previousStats.validCount = initialValidCount;
      previousStats.invalidCount = initialInvalidCount;
    }
    
    const signedPrices = await getSignedPrices(tokens);
    
    if (!Array.isArray(signedPrices) || signedPrices.length === 0) {
      log('No data to validate');
      
      const userData = await getUserStats(tokens);
      displayStats(userData);
      return;
    }
    
    log(`Processing ${signedPrices.length} data points...`);
    let successCount = 0;
    let failCount = 0;
    
    for (const price of signedPrices) {
      try {
        const msgHash = price.msg_hash;
        
        if (!msgHash) {
          log('Data without msg_hash, skipping...', 'WARN');
          continue;
        }
        
        const isValid = validatePrice(price);
        
        await sendValidation(tokens, msgHash, isValid);
        successCount++;
        
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        failCount++;
        log(`Error processing data: ${error.message}`, 'ERROR');
        continue; 
      }
    }
    
    const updatedUserData = await getUserStats(tokens);
    
    const newValidCount = updatedUserData.stats.stork_signed_prices_valid_count || 0;
    const newInvalidCount = updatedUserData.stats.stork_signed_prices_invalid_count || 0;
    
    const actualValidIncrease = newValidCount - previousStats.validCount;
    const actualInvalidIncrease = newInvalidCount - previousStats.invalidCount;
    
    previousStats.validCount = newValidCount;
    previousStats.invalidCount = newInvalidCount;
    
    displayStats(updatedUserData);
    
    log(`--------- VALIDATION SUMMARY ---------`);
    log(`Total data processed: ${actualValidIncrease + actualInvalidIncrease}`);
    log(`Successful: ${actualValidIncrease}`);
    log(`Failed: ${actualInvalidIncrease}`);
    log(`--------- COMPLETE ---------`);
  } catch (error) {
    log(`Validation process stopped: ${error.message}`, 'ERROR');
  }
}

function displayStats(userData) {
  if (!userData || !userData.stats) {
    log('No valid stats data available to display', 'WARN');
    return;
  }
  
  const stats = userData.stats;
  const email = userData.email || 'N/A';
  const id = userData.id || 'N/A';
  const referralCode = userData.referral_code || 'N/A';
  
  console.clear();
  
  console.log('=============================================');
  console.log('   STORK ORACLE AUTO BOT - AIRDROP INSIDERS  ');
  console.log('=============================================');
  console.log(`Time: ${getTimestamp()}`);
  console.log('---------------------------------------------');
  
  console.log(`User: ${email}`);
  console.log(`ID: ${id}`);
  console.log(`Referral Code: ${referralCode}`);
  console.log('---------------------------------------------');
  
  console.log('VALIDATION STATISTICS:');
  console.log(`✓ Valid Validations: ${stats.stork_signed_prices_valid_count || 0}`);
  console.log(`✗ Invalid Validations: ${stats.stork_signed_prices_invalid_count || 0}`);
  console.log(`↻ Last Validated At: ${stats.stork_signed_prices_last_verified_at || 'Never'}`);
  
  const totalValidations = (stats.stork_signed_prices_valid_count || 0) + 
                         (stats.stork_signed_prices_invalid_count || 0);
  
  let timeSinceLastValidation = 'N/A';
  if (stats.stork_signed_prices_last_verified_at) {
    const lastVerified = new Date(stats.stork_signed_prices_last_verified_at);
    const now = new Date();
    const diffMs = now - lastVerified;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const remainingMins = diffMins % 60;
    
    if (diffHours > 0) {
      timeSinceLastValidation = `${diffHours}h ${remainingMins}m ago`;
    } else {
      timeSinceLastValidation = `${diffMins}m ago`;
    }
  }
  
  console.log(`Σ Total Validations: ${totalValidations}`);
  console.log(`⏱ Time Since Last Validation: ${timeSinceLastValidation}`);
  
  console.log('---------------------------------------------');
  console.log('OTHER INFORMATION:');
  console.log(`👥 Referral Usage Count: ${stats.referral_usage_count || 0}`);
  console.log('---------------------------------------------');
  console.log(`Next validation in ${config.intervalSeconds} seconds...`);
  console.log('=============================================');
}

function createTokensFileIfNotExists() {
  if (!fs.existsSync(config.tokenPath)) {
    log(`tokens.json file not found. Creating template file at ${config.tokenPath}`, 'WARN');
    try {
      const tokenTemplate = {
        accessToken: "",
        idToken: "",
        refreshToken: "",
        isAuthenticated: true,
        isVerifying: false
      };
      
      fs.writeFileSync(config.tokenPath, JSON.stringify(tokenTemplate, null, 2), 'utf8');
      log(`tokens.json file created. Please fill it with valid tokens`, 'INFO');
      log(`Tip: Copy the tokens from Stork Oracle app localStorage and paste them into the tokens.json file`, 'INFO');
      return false;
    } catch (error) {
      log(`Failed to create tokens file: ${error.message}`, 'ERROR');
      return false;
    }
  }
  return true;
}

function extractTokensFromLocalStorage(localStorageData) {
  try {
    log('Extracting tokens from localStorage data...');
    
    const data = typeof localStorageData === 'string' ? JSON.parse(localStorageData) : localStorageData;
    
    const tokens = {
      accessToken: data.accessToken || '',
      idToken: data.idToken || '',
      refreshToken: data.refreshToken || '',
      isAuthenticated: data.isAuthenticated === true || data.isAuthenticated === 'true',
      isVerifying: data.isVerifying === true || data.isVerifying === 'true'
    };
    
    if (!tokens.accessToken || tokens.accessToken.length < 20) {
      throw new Error('Invalid access token in provided data');
    }
    
    if (!tokens.refreshToken || tokens.refreshToken.length < 20) {
      log('Warning: No refresh token found, auto-refresh will not work', 'WARN');
    }
    
    return tokens;
  } catch (error) {
    log(`Error extracting tokens: ${error.message}`, 'ERROR');
    throw error;
  }
}

function startApp() {
  log(`===========================================`);
  log(`STORK ORACLE VALIDATION BOT ACTIVE`);
  log(`Interval: ${config.intervalSeconds} seconds`);
  log(`Tokens Path: ${config.tokenPath}`);
  log(`Auto-refresh: ENABLED`);
  log(`===========================================`);
  
  runValidationProcess();
  
  setInterval(runValidationProcess, config.intervalSeconds * 1000);
}

function main() {
  if (!createTokensFileIfNotExists()) {
    log('Application cannot start due to tokens file issues', 'ERROR');
    return;
  }
  
  try {
    const tokensContent = fs.readFileSync(config.tokenPath, 'utf8').trim();
    const tokens = JSON.parse(tokensContent);
    
    if (!tokens.accessToken || tokens.accessToken.length < 20) {
      log('tokens.json file exists but contains an invalid access token', 'ERROR');
      log('Please fill tokens.json with valid tokens from the Stork Oracle app localStorage', 'INFO');
      log('Required fields: accessToken, idToken, refreshToken, isAuthenticated, isVerifying', 'INFO');
      return;
    }
    
    if (!tokens.refreshToken || tokens.refreshToken.length < 20) {
      log('Warning: No refresh token found in tokens.json. Auto-refresh will not work.', 'WARN');
      log('Please include a valid refreshToken for auto-refresh functionality', 'INFO');
    }
  } catch (error) {
    log(`Error reading tokens file: ${error.message}`, 'ERROR');
    return;
  }
  
  startApp();
}

function importFromLocalStorage(localStorageData) {
  try {
    const tokens = extractTokensFromLocalStorage(localStorageData);
    saveTokens(tokens);
    log('Tokens successfully imported from localStorage data', 'INFO');
    log('The bot will use these tokens for authentication', 'INFO');
    return true;
  } catch (error) {
    log(`Failed to import from localStorage: ${error.message}`, 'ERROR');
    return false;
  }
}

main();

module.exports = {
  importFromLocalStorage,
  refreshTokens,
  runValidationProcess
};