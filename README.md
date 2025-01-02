# Discord Support Bot with LlamaIndex

A Discord bot created for the R6S: Operation Throwback Discord server that uses LlamaIndex and OpenAI to provide automated support responses based on training data.
Discord: [https://discord.gg/JGA9WPF4K8](https://discord.gg/JGA9WPF4K8)

## Features

- Automated responses to user questions using LlamaIndex and GPT-3.5
- Rate limiting system to prevent abuse
- Conversation context tracking
- Support for multiple channels
- Message deletion functionality for moderators
- Logging

## Prerequisites

- Node.js (18.x or higher)
- npm
- Discord Bot Token
- OpenAI API Key

## Installation

1. Clone the repository:
```bash
git clone https://github.com/benjaminstrike/throwback-ai-support.git
cd throwback-ai-support
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Configure your `.env` file with the following:
```bash
# Your Discord bot token
DISCORD_TOKEN=your_discord_token_here

# Your OpenAI API key
OPENAI_API_KEY=your_openai_api_key_here

# Discord user IDs excluded from rate limits (comma-separated)
LIMIT_EXEMPT_USERS=userid1,userid2

# Channel IDs where the bot will respond (comma-separated)
SUPPORT_CHANNEL_IDS=channelid1,channelid2
```

## Usage

Start the bot:
```bash
node index.js
```

On first run, the bot will create a `storage` folder and begin training on the specified support channels.
The bot will automatically respond to messages in the support channels based on the training data.

## Rate Limiting

- Users are limited to 6 messages per hour to prevent abuse
- Exempt users can be specified in LIMIT_EXEMPT_USERS

## Training Data

To update training data:
1. Add new training data files to the `/data` directory
2. Delete the `/storage` folder to clear the old index
3. Restart the bot to rebuild the index with new data

## Logging

Logs are stored in:
- `logs/error.log` for errors
- `logs/combined.log` for all events