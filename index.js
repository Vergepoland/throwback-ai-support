const { Client, GatewayIntentBits, Partials, ActivityType, PermissionsBitField, ButtonStyle, ButtonBuilder, ActionRowBuilder } = require('discord.js')
const { Settings, OpenAI, Document, VectorStoreIndex, storageContextFromDefaults, SimpleDirectoryReader, PromptTemplate, getResponseSynthesizer } = require('llamaindex')
const winston = require('winston')

Settings.llm = new OpenAI({
  model: "gpt-3.5-turbo",
  // temperature: 0.5,
})

const fs = require('fs/promises')
const path = require('path')
require('dotenv').config()

// Make sure logs directory exists
fs.mkdir('./logs', { recursive: true }).catch(console.error)

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: './logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: './logs/combined.log' })
  ]
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection:', error)
})

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error)
})

// Rate limiting
const RATE_LIMIT = 6 // messages per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000 // 1 hour in ms
const RATE_LIMIT_FILE = './ratelimits.json'

let userRateLimits = new Map()

async function loadRateLimits() {
  try {
    const data = await fs.readFile(RATE_LIMIT_FILE, 'utf8')
    const parsed = JSON.parse(data)
    userRateLimits = new Map(Object.entries(parsed))
    cleanupRateLimits()
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading rate limits:', error)
    }
    userRateLimits = new Map()
  }
}

async function saveRateLimits() {
  try {
    const obj = Object.fromEntries(userRateLimits)
    await fs.writeFile(RATE_LIMIT_FILE, JSON.stringify(obj, null, 2))
  } catch (error) {
    console.error('Error saving rate limits:', error)
  }
}

function cleanupRateLimits() {
  const now = Date.now()
  for (const [userId, userData] of userRateLimits.entries()) {
    userData.timestamps = userData.timestamps.filter(timestamp => 
      now - timestamp < RATE_LIMIT_WINDOW
    )
    if (userData.timestamps.length === 0) {
      userRateLimits.delete(userId)
    }
  }
}

const EXCLUDED_USERS = process.env.LIMIT_EXEMPT_USERS.split(',')
console.log('Excluded users:', EXCLUDED_USERS)
function isExcludedFromLimits(userId) {
  return EXCLUDED_USERS.includes(userId)
}

function isRateLimited(userId) {
  if (isExcludedFromLimits(userId)) return false

  const now = Date.now()
  
  if (!userRateLimits.has(userId)) {
    userRateLimits.set(userId, { timestamps: [] })
  }
  
  const userData = userRateLimits.get(userId)
  
  // Filter out timestamps older than the rate limit window
  userData.timestamps = userData.timestamps.filter(timestamp => 
    now - timestamp < RATE_LIMIT_WINDOW
  )
  
  // Check if user has exceeded rate limit
  if (userData.timestamps.length >= RATE_LIMIT) {
    return true
  }
  
  // Add new timestamp
  userData.timestamps.push(now)
  return false
}

// Calculate time until rate limit reset
function getTimeUntilReset(userId) {
  const userData = userRateLimits.get(userId)
  if (!userData || userData.timestamps.length === 0) return 0
  
  const oldestTimestamp = Math.min(...userData.timestamps)
  const resetTime = oldestTimestamp + RATE_LIMIT_WINDOW
  const timeLeft = resetTime - Date.now()
  
  return Math.max(0, timeLeft)
}

// Track conversation with same user for context
const CONVERSATION_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const conversations = new Map();

function cleanupConversations() {
  const now = Date.now();
  for (const [userId, convo] of conversations.entries()) {
    if (now - convo.lastTimestamp > CONVERSATION_TIMEOUT) {
      conversations.delete(userId);
    }
  }
}

function updateConversation(userId, query, response) {
  if (!conversations.has(userId)) {
    conversations.set(userId, {
      messages: [],
      lastTimestamp: Date.now()
    });
  }
  
  const convo = conversations.get(userId);
  convo.messages.push({ query, response });
  convo.lastTimestamp = Date.now();
  
  // Keep only last 5 messages for context
  if (convo.messages.length > 5) {
    convo.messages.shift();
  }
}


const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Message, Partials.Channel],
})

let queryEngine

const SUPPORT_CHANNEL_IDS = process.env.SUPPORT_CHANNEL_IDS.split(',').map(id => id.trim())
console.log('Support channels:', SUPPORT_CHANNEL_IDS)

const newTextQaPrompt = new PromptTemplate({
  templateVars: ["context", "query"],
  template:
    'Context information from multiple sources is below.\n' +
    '---------------------\n' +
    `{context}\n` +
    '---------------------\n' +
    'You are a tech support specialist for Operation Throwback, a Discord server that helps users play older versions of Rainbow Six Siege. ' +
    'Given the information from multiple sources and not prior knowledge, ' +
    'answer the query. Be professional and as helpful as possible. ' +
    "When users ask about installing or downloading specific seasons like 'White Noise', 'Blood Orchid', etc., provide general instructions for downloading " +
    "and installing that season using SlejmUr's downloader, even if that exact season isn't mentioned in the context. " +
    'If applicable, tell users that the R6 downloader can be found in the <#1092833532981809293> channel. ' +
    'If applicable, tell users that other modding tools are found in the <#1092832304516305039> channel. ' +
    'All Rainbow Six Siege seasons can be downloaded using the same general process. ' +
    'Do not cite the source where your answer comes from. ' +
    'If a user is talking about Cracks, e.g. LumaPlay, CODEX, etc. assist the user with the files for that specific crack/fix.' +
    'Always prioritize answers from your sources, which is the main source of information. ' +
    'If a question is about a specific season, explain the general process to download that season. ' +
    'If the user mentions an image as having more context or information, let the user know that you cant process that information and to explain what you see in the image.' +
    'If you are unsure about an answer, additionally suggest the asker to rephrase the question with more detail.' +
    'If the answer is not somewhat found in the given sources, then say you do not have that information, and suggest ' +
    'asking the same question in the <#1106957787516379267> channel. ' +
    'Only answer questions if you know the answer.\n' +
    'If the query seems to reference something from the conversation history, use that context to provide a more relevant answer.\n' +
    `Query: {query}\n` +
    'Answer: ',
})

async function initializeIndex() {
  try {
    // check if index_store.json exists
    const storageExists = await fs
      .access('./storage/index_store.json')
      .then(() => true)
      .catch(() => false)
    
    console.log('Storage exists:', storageExists)

    // Initialize empty documents array
    let documents = []

    // Create the storage context first
    const storageContext = await storageContextFromDefaults({
      persistDir: './storage'
    })

    if (!storageExists) {
      console.log('Creating new index')
      // Load documents from the data directory
      const reader = new SimpleDirectoryReader()
      const files = await fs.readdir('./data')

      // Only proceed if we have files to process
      if (files.length > 0) {
        documents = await reader.loadData({ directoryPath: './data' })
      } else {
        // Create a default document if no files exist
        documents = [new Document({ text: 'Initial support documentation', id_: 'default' })]
      }
    }

    // Create index with the documents (even if empty) and storage context
    const index = await VectorStoreIndex.fromDocuments(documents, {
      storageContext,
    })

    const responseSynthesizer = getResponseSynthesizer('compact')

    // Create query engine with custom prompt
    queryEngine = index.asQueryEngine({
      responseSynthesizer,
    })

    // Add custom prompt to the query engine
    queryEngine.updatePrompts({
      "responseSynthesizer:textQATemplate": newTextQaPrompt,
    });

    console.log({
      promptsToUse: queryEngine.getPrompts(),
    })

    console.log('Index initialized successfully')
  } catch (error) {
    console.error('Error initializing index:', error)
    process.exit(1)
  }
}

async function findTrainingData() {
  console.log('Starting updating support data')

  const supportChannel = await client.channels.fetch(SUPPORT_CHANNEL_IDS[0])
  const qaData = []
  const allData = []

  let date = new Date(0)

  // Find most recent history file
  const files = await fs.readdir('./data')
  for (const file of files) {
    if (file.startsWith('history-')) {
      const name = file.replace('history-', '').replace('.txt', '')
      date = new Date(name)
      break
    }
  }

  try {
    const messages = await supportChannel.messages.fetch({ limit: 100 })

    for (const message of messages.values()) {
      if (message.createdTimestamp < date.getTime()) break

      if (!message.content || message.content.length < 4) continue

      console.log(`Training off of: ${message.content}`)

      if (message.reference?.messageId) {
        try {
          const referenced = await message.channel.messages.fetch(message.reference.messageId)
          if (referenced) {
            qaData.push(`Question: ${referenced.content}\nAnswer: ${message.content}\n\n`)
          }
        } catch (error) {
          console.warn(`Could not fetch referenced message: ${error.message}`)
        }
      }
      allData.push(message.content)
    }

    // Remove old files
    for (const file of files) {
      if (file.startsWith('history') || file.startsWith('qa')) {
        await fs.unlink(path.join('./data', file))
      }
    }

    // Write new files
    const dateStr = new Date().toISOString().split('T')[0]

    await fs.writeFile(`./data/qa-${dateStr}.txt`, '\n' + qaData.reverse().join('\n'), 'utf-8')

    await fs.writeFile(`./data/history-${dateStr}.txt`, '\n' + allData.reverse().join('\n'), 'utf-8')

    // Reinitialize the index with new data
    await initializeIndex()

    console.log('Finished updating support data')
  } catch (error) {
    console.error('Error in findTrainingData:', error)
  }
}

client.once('ready', async () => {
  console.log('Bot has logged in')

  // Make sure data directory exists
  await fs.mkdir('./data', { recursive: true })
  await loadRateLimits()
  await initializeIndex()

  client.user.setActivity({
    type: ActivityType.Watching,
    name: 'over the support channel',
  })
  
  // Update rate limits every 5 minutes
  setInterval(async () => {
    cleanupRateLimits()
    await saveRateLimits()
  }, 5 * 60 * 1000)
})


client.on('messageCreate', async (message) => {
  if (!SUPPORT_CHANNEL_IDS.includes(message.channelId) || message.author.bot) return

  try {
    console.log(`Processing message from ${message.author.tag}`)

    const userId = message.author.id;
    const convo = conversations.get(userId);
    let query = message.content;

    // Check if rate limited
    if (isRateLimited(message.author.id)) {
      // const timeLeft = getTimeUntilReset(message.author.id)
      // const minutesLeft = Math.ceil(timeLeft / (60 * 1000))
      // await message.reply(
      //   `You've reached the limit of ${RATE_LIMIT} questions per hour. ` +
      //   `Please try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`
      // )
      await message.reply(
        `You've sent too many messages in a short time period, please try again later.\n` +
        `If you still need help, ask for support in the <#1106957787516379267> channel.`
      )
      return
    }

    // Save updated rate limits
    await saveRateLimits()

    const loadingMessage = await message.reply('🤔 Processing your question... Please wait.')
    if (!loadingMessage) {
      logger.error('Failed to send loading message')
      return 
    }

    if (message.content.length > 1700) {
      await loadingMessage.edit('Sorry, the question is too long to process. Retry with a shorter question.')
      return
    }

    if (message.content.length < 15) {
      await loadingMessage.edit('Sorry, the question is too short to process. Please be more descriptive.')
      return
    }

    // Get AI response
    if (convo?.messages.length > 0) {
      query = "Previous conversation:\n" + 
        convo.messages.map(m => `User: ${m.query}\nAssistant: ${m.response}\n`).join('\n') +
        "\nCurrent question:\n" + query;
    }

    const response = await queryEngine.query({
      query: query
    });

    // Save the conversation history
    updateConversation(userId, message.content, response.toString());

    const deleteButton = new ButtonBuilder()
      .setCustomId('deletemessage')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)

    const row = new ActionRowBuilder().addComponents(deleteButton)

    const responseContent = response.toString()
    if (responseContent === 'Empty Response') {
      await loadingMessage.edit('Sorry, I could not find an answer to your question. Please try again later.')
      return
    }

    if (responseContent.includes('\\data\\') || responseContent.includes('throwback-ai-support')) {
      await loadingMessage.edit('Sorry, I could not find an answer to your question. Please try again later.')
      return
    }

    if (responseContent.length > 2000) {
      await loadingMessage.edit('Sorry, the response is too long to send. Please try again later. (2)')
      return
    }

    if (responseContent.length === 0) {
      await loadingMessage.edit('Sorry, I could not find an answer to your question. Please try again later. (3)')
      return
    }

    // Edit the loading message with the actual response
    await loadingMessage.edit({
      content: response.toString(),
      components: [row],
    })

    console.log(`Responded to '${message.content}' from ${message.author.tag} with '${response}'`)
    logger.info(`Responded to '${message.content}' from ${message.author.tag} with '${response}'`)
  } catch (error) {
    console.error('Error processing message:', error)
    if (loadingMessage) {
      await loadingMessage.edit('Sorry, I encountered an error processing your question. Please try again later.')
    } else {
      await message.reply('Sorry, I encountered an error processing your question. Please try again later.')
    }
  }
})

// Delete button interaction
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return
  if (interaction.customId !== 'deletemessage') return

  if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageMessages)) {
    return await interaction.reply({
      content: 'You do not have permissions to delete this!',
      ephemeral: true,
    })
  }

  try {
    await interaction.message.delete()
    await interaction.deferUpdate()
  } catch (error) {
    console.error('Error deleting message:', error)
    await interaction.reply({
      content: 'Failed to delete the message.',
      ephemeral: true,
    })
  }
})

console.log('Logging in...')
client.login(process.env.DISCORD_TOKEN)
  .catch((error) => {
    console.error('Error logging in:', error)
    process.exit(1)
  })
