# Stork Oracle Auto Bot

Automated validation bot for the Stork Oracle network. This bot helps you automate the verification process to earn rewards through the Stork Oracle system.

## Features

- Automatically fetches signed price data from Stork Oracle API
- Validates price data according to predefined rules
- Submits validation results back to the API
- Handles token refresh for continuous operation
- Displays validation statistics and user information
- Configurable validation interval

## Requirements

- Node.js 14.0.0 or higher
- Valid Stork Oracle account
- Authentication tokens from your Stork Oracle account

## Installation

1. Clone the repository:
```
git clone https://github.com/airdropinsiders/Stork-Auto-Bot.git
```

2. Navigate to the project directory:
```
cd Stork-Auto-Bot
```

3. Install dependencies:
```
npm install
```

4. Configure your tokens (see Configuration section below)

## Configuration

You need to provide your Stork Oracle authentication tokens for the bot to work. These can be extracted from your Stork Oracle web app's localStorage.

1. Create a `tokens.json` file in the project root with the following format:
```json
{
  "accessToken": "your-access-token-here",
  "idToken": "your-id-token-here",
  "refreshToken": "your-refresh-token-here",
  "isAuthenticated": true,
  "isVerifying": true
}
```

2. Optional: Adjust the configuration in `index.js` to modify:
   - Polling interval (default: 10 seconds)
   - API endpoints
   - Validation rules

### How to Get Your Tokens

1. Log in to the Stork Oracle web app
2. Open browser developer tools (F12 or right-click > Inspect)
3. Go to the Application tab
4. Navigate to localStorage under Storage
5. Look for authentication tokens and copy them to your tokens.json file

## Usage

Start the bot with:
```
npm start
```

The bot will:
1. Authenticate using your tokens
2. Fetch signed price data at regular intervals
3. Validate each data point
4. Submit validation results to Stork Oracle
5. Display your current statistics

## Troubleshooting

- If you see token-related errors, check that your tokens are valid and properly formatted in tokens.json
- If the bot stops refreshing tokens, your refresh token may have expired - update tokens.json with fresh tokens
- For connection issues, check your internet connection and verify the Stork Oracle API is accessible

## Disclaimer

This bot is provided for educational purposes only. Use at your own risk. The authors are not responsible for any consequences that may arise from using this bot, including but not limited to account termination or loss of rewards.

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
