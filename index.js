const path = require('path');
const fs = require('fs');

let userDataPath;
if (process.versions.electron) {
    const { app } = require('electron');
    userDataPath = app.getPath('userData');
} else {
    userDataPath = __dirname;
}

// Ensure the userDataPath directory exists
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}

// Load env from userDataPath if it exists, otherwise fall back to local
const envPath = path.join(userDataPath, '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
} else {
    require('dotenv').config();
}

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const dbManager = require('./database');
const geminiService = require('./gemini-service');
const twitterService = require('./twitter-service');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration Management
const configPath = path.join(userDataPath, 'config.json');
let systemConfig = {
    geminiModel: "gemini-2.5-flash-lite",
    basePrompt: "You are a witty, smart, and insightful Twitter/X AI persona representing the user. Evaluate the trending post or news. Formulate a concise, engaging, and relevant reply (under 280 characters). You can express predictions, humor, or deep insights, but never mention you are an AI.",
    mode: "manual",
    searchQuery: "AI, Tech, Science, Space, History, World News",
    llmProvider: "gemini",
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "llama3",
    twitterAuthType: "user",
    twitterUsername: "",
    twitterEmail: ""
};

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const fileData = fs.readFileSync(configPath, 'utf8');
            systemConfig = { ...systemConfig, ...JSON.parse(fileData) };
            console.log("whatisx configuration loaded.");
        } else {
            saveConfig();
        }
    } catch (error) {
        console.error("Error loading config.json in whatisx, using defaults:", error);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(systemConfig, null, 2), 'utf8');
    } catch (error) {
        console.error("Failed to save config.json in whatisx:", error);
    }
}

function saveTwitterCredentials(apiKey, apiSecret, accessToken, accessSecret) {
    try {
        const envPath = path.join(userDataPath, '.env');
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }
        
        function setEnvVar(name, value) {
            const regex = new RegExp(`^${name}=.*`, 'm');
            if (envContent.match(regex)) {
                envContent = envContent.replace(regex, `${name}=${value}`);
            } else {
                envContent += `\n${name}=${value}`;
            }
        }
        
        if (apiKey) setEnvVar('TWITTER_API_KEY', apiKey);
        if (apiSecret) setEnvVar('TWITTER_API_SECRET', apiSecret);
        if (accessToken) setEnvVar('TWITTER_ACCESS_TOKEN', accessToken);
        if (accessSecret) setEnvVar('TWITTER_ACCESS_SECRET', accessSecret);
        setEnvVar('TWITTER_AUTH_TYPE', 'keys');
        setEnvVar('MOCK_MODE', 'false');
        
        fs.writeFileSync(envPath, envContent, 'utf8');
        console.log("Twitter credentials saved to .env and MOCK_MODE set to false.");
    } catch (error) {
        console.error("Failed to write Twitter credentials to .env:", error);
    }
}

function saveTwitterUserCredentials(username, password, email) {
    try {
        const envPath = path.join(userDataPath, '.env');
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }
        
        function setEnvVar(name, value) {
            const regex = new RegExp(`^${name}=.*`, 'm');
            if (envContent.match(regex)) {
                envContent = envContent.replace(regex, `${name}=${value}`);
            } else {
                envContent += `\n${name}=${value}`;
            }
        }
        
        if (username) setEnvVar('TWITTER_USERNAME', username);
        if (password) setEnvVar('TWITTER_PASSWORD', password);
        if (email) setEnvVar('TWITTER_EMAIL', email);
        setEnvVar('TWITTER_AUTH_TYPE', 'user');
        setEnvVar('MOCK_MODE', 'false');
        
        fs.writeFileSync(envPath, envContent, 'utf8');
        console.log("Twitter direct user credentials saved to .env and MOCK_MODE set to false.");
    } catch (error) {
        console.error("Failed to write Twitter user credentials to .env:", error);
    }
}

// Services initialization
loadConfig();
const activeModel = systemConfig.llmProvider === 'ollama' ? systemConfig.ollamaModel : systemConfig.geminiModel;
geminiService.initialize(
    process.env.GEMINI_API_KEY,
    activeModel,
    systemConfig.basePrompt,
    systemConfig.llmProvider,
    systemConfig.ollamaUrl
);
twitterService.initialize();

// WebSocket Helper Functions
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(wsClient => {
        if (wsClient.readyState === WebSocket.OPEN) {
            wsClient.send(message);
        }
    });
}

function broadcastState() {
    broadcast({
        type: 'STATUS_SYNC',
        state: {
            mode: systemConfig.mode,
            searchQuery: systemConfig.searchQuery,
            isMock: twitterService.isMock,
            loginStatus: twitterService.loginStatus,
            authUser: twitterService.authUser,
            llmProvider: systemConfig.llmProvider || 'gemini',
            geminiActive: systemConfig.llmProvider === 'ollama' ? true : !!geminiService.genAI,
            twitterAuthType: systemConfig.twitterAuthType || 'user',
            twitterUsername: systemConfig.twitterUsername || '',
            twitterEmail: systemConfig.twitterEmail || ''
        }
    });
}

wss.on('connection', (ws) => {
    console.log("WebSocket client connected to whatisx.");
    
    // Sync status immediately
    ws.send(JSON.stringify({
        type: 'STATUS_SYNC',
        state: {
            mode: systemConfig.mode,
            searchQuery: systemConfig.searchQuery,
            isMock: twitterService.isMock,
            loginStatus: twitterService.loginStatus,
            authUser: twitterService.authUser,
            llmProvider: systemConfig.llmProvider || 'gemini',
            geminiActive: systemConfig.llmProvider === 'ollama' ? true : !!geminiService.genAI,
            twitterAuthType: systemConfig.twitterAuthType || 'user',
            twitterUsername: systemConfig.twitterUsername || '',
            twitterEmail: systemConfig.twitterEmail || ''
        }
    }));

    // Send latest logs & pending tweets
    sendLogsAndPending(ws);
});

function sendLogsAndPending(ws) {
    dbManager.getPendingTweets((err, pendingRows) => {
        if (!err && pendingRows) {
            ws.send(JSON.stringify({
                type: 'PENDING_SYNC',
                pending: pendingRows
            }));
        }
    });

    dbManager.getHistory((err, historyRows) => {
        if (!err && historyRows) {
            ws.send(JSON.stringify({
                type: 'HISTORY_SYNC',
                history: historyRows
            }));
        }
    });
}

// Periodic Search & Evaluation loop
let isSearching = false;
async function searchAndEvaluateTrends() {
    if (isSearching) return;
    isSearching = true;
    console.log("Starting trend search and evaluation loop...");
    
    try {
        // Query keywords (split search query string)
        const queries = systemConfig.searchQuery.split(',').map(q => q.trim());
        const selectedQuery = queries[Math.floor(Math.random() * queries.length)];
        
        console.log(`Searching tweets for topic: "${selectedQuery}"`);
        const tweets = await twitterService.searchTrendingTweets(selectedQuery);
        
        for (const tweet of tweets) {
            // Check if already processed
            const alreadyProcessed = await new Promise((resolve) => {
                dbManager.db.get("SELECT id FROM tweets WHERE tweet_id = ?", [tweet.tweet_id], (err, row) => {
                    resolve(!!row);
                });
            });

            if (alreadyProcessed) continue;

            console.log(`Evaluating tweet from @${tweet.username}: "${tweet.tweet_text}"`);
            
            // Analyze and generate reply
            const result = await geminiService.evaluateTrendAndGenerateReply(tweet.tweet_text);
            
            const tweetRecord = {
                tweet_id: tweet.tweet_id,
                username: tweet.username,
                tweet_text: tweet.tweet_text,
                reply_text: result.replyText,
                prediction: result.prediction,
                status: systemConfig.mode === 'automatic' ? 'SUCCESS' : 'PENDING'
            };

            if (systemConfig.mode === 'automatic') {
                // Instantly reply
                try {
                    await twitterService.replyToTweet(tweet.tweet_id, result.replyText);
                    dbManager.saveTweet(tweetRecord, () => {
                        console.log(`Automatically replied to @${tweet.username}`);
                        broadcastUpdate();
                    });
                } catch (err) {
                    tweetRecord.status = 'ERROR';
                    tweetRecord.error = err.message || err;
                    dbManager.saveTweet(tweetRecord, () => broadcastUpdate());
                }
            } else {
                // Save as pending for manual review
                dbManager.saveTweet(tweetRecord, () => {
                    console.log(`Saved pending tweet from @${tweet.username} for manual review.`);
                    broadcastUpdate();
                });
            }
        }
    } catch (err) {
        console.error("Error in trend search loop:", err);
    } finally {
        isSearching = false;
    }
}

function broadcastUpdate() {
    dbManager.getPendingTweets((err, pending) => {
        if (!err) broadcast({ type: 'PENDING_SYNC', pending });
    });
    dbManager.getHistory((err, history) => {
        if (!err) broadcast({ type: 'HISTORY_SYNC', history });
    });
}

// Start periodic loop (every 30 seconds)
const searchInterval = setInterval(searchAndEvaluateTrends, 30000);

// --- REST API Endpoints ---

// Get Configuration
app.get('/api/config', (req, res) => {
    const cookiePath = path.join(userDataPath, 'twitter_cookies.json');
    const hasCookies = fs.existsSync(cookiePath);
    res.json({
        ...systemConfig,
        hasCookies
    });
});

// Update Configuration
app.post('/api/config', async (req, res) => {
    const { 
        mode, 
        searchQuery, 
        basePrompt, 
        llmProvider, 
        ollamaUrl, 
        ollamaModel,
        twitterAuthType,
        twitterUsername,
        twitterPassword,
        twitterEmail,
        twitterAuthToken,
        twitterCt0,
        twitterApiKey,
        twitterApiSecret,
        twitterAccessToken,
        twitterAccessSecret
    } = req.body;
    
    systemConfig.mode = mode || systemConfig.mode;
    systemConfig.searchQuery = searchQuery || systemConfig.searchQuery;
    systemConfig.basePrompt = basePrompt || systemConfig.basePrompt;
    systemConfig.llmProvider = llmProvider || systemConfig.llmProvider || 'gemini';
    systemConfig.ollamaUrl = ollamaUrl || systemConfig.ollamaUrl || 'http://localhost:11434';
    systemConfig.ollamaModel = ollamaModel || systemConfig.ollamaModel || 'llama3';
    systemConfig.twitterAuthType = twitterAuthType || systemConfig.twitterAuthType || 'user';
    systemConfig.twitterUsername = twitterUsername !== undefined ? twitterUsername : systemConfig.twitterUsername;
    systemConfig.twitterEmail = twitterEmail !== undefined ? twitterEmail : systemConfig.twitterEmail;
    
    saveConfig();

    if (systemConfig.twitterAuthType === 'user') {
        let hasNewCookies = false;
        if (twitterAuthToken && twitterCt0) {
            const cookiePath = path.join(userDataPath, 'twitter_cookies.json');
            const cookiesArray = [
                {
                    "key": "auth_token",
                    "value": twitterAuthToken,
                    "domain": ".twitter.com",
                    "path": "/",
                    "secure": true,
                    "httpOnly": true
                },
                {
                    "key": "ct0",
                    "value": twitterCt0,
                    "domain": ".twitter.com",
                    "path": "/",
                    "secure": true
                }
            ];
            fs.writeFileSync(cookiePath, JSON.stringify(cookiesArray, null, 2), 'utf8');
            console.log("Direct X cookies saved to twitter_cookies.json");
            hasNewCookies = true;
        }

        if (hasNewCookies || twitterUsername || twitterPassword || twitterEmail) {
            saveTwitterUserCredentials(twitterUsername, twitterPassword, twitterEmail);
            if (twitterUsername) process.env.TWITTER_USERNAME = twitterUsername;
            if (twitterPassword) process.env.TWITTER_PASSWORD = twitterPassword;
            if (twitterEmail) process.env.TWITTER_EMAIL = twitterEmail;
            process.env.TWITTER_AUTH_TYPE = 'user';
            process.env.MOCK_MODE = 'false';
            
            await twitterService.initialize();
        }
    } else {
        if (twitterApiKey || twitterApiSecret || twitterAccessToken || twitterAccessSecret) {
            saveTwitterCredentials(twitterApiKey, twitterApiSecret, twitterAccessToken, twitterAccessSecret);
            if (twitterApiKey) process.env.TWITTER_API_KEY = twitterApiKey;
            if (twitterApiSecret) process.env.TWITTER_API_SECRET = twitterApiSecret;
            if (twitterAccessToken) process.env.TWITTER_ACCESS_TOKEN = twitterAccessToken;
            if (twitterAccessSecret) process.env.TWITTER_ACCESS_SECRET = twitterAccessSecret;
            process.env.TWITTER_AUTH_TYPE = 'keys';
            process.env.MOCK_MODE = 'false';
            
            await twitterService.initialize();
        }
    }
    
    const activeModel = systemConfig.llmProvider === 'ollama' ? systemConfig.ollamaModel : systemConfig.geminiModel;
    geminiService.initialize(
        process.env.GEMINI_API_KEY,
        activeModel,
        systemConfig.basePrompt,
        systemConfig.llmProvider,
        systemConfig.ollamaUrl
    );
    
    broadcastState();
    res.json({ success: true, config: systemConfig });
});

// Trigger search & evaluation manually
app.post('/api/evaluate', async (req, res) => {
    if (isSearching) {
        return res.status(400).json({ error: "Search loop is already running." });
    }
    // Run async in background, return immediate success
    searchAndEvaluateTrends();
    res.json({ success: true, message: "Trend evaluation loop triggered." });
});

// Approve and post a pending tweet
app.post('/api/approve', async (req, res) => {
    const { id, replyText } = req.body;
    
    dbManager.db.get("SELECT * FROM tweets WHERE id = ?", [id], async (err, tweet) => {
        if (err || !tweet) {
            return res.status(400).json({ error: "Tweet not found." });
        }
        
        try {
            await twitterService.replyToTweet(tweet.tweet_id, replyText);
            dbManager.updateTweetStatus(id, 'SUCCESS', replyText, null, (updateErr) => {
                if (updateErr) {
                    return res.status(500).json({ error: "Failed to update record status." });
                }
                broadcastUpdate();
                res.json({ success: true });
            });
        } catch (postErr) {
            dbManager.updateTweetStatus(id, 'ERROR', replyText, postErr.message || postErr, () => {
                broadcastUpdate();
            });
            res.status(500).json({ error: postErr.message || "Failed to post reply to Twitter." });
        }
    });
});

// Reject a pending tweet
app.post('/api/reject', (req, res) => {
    const { id } = req.body;
    dbManager.updateTweetStatus(id, 'REJECTED', null, null, (err) => {
        if (err) {
            return res.status(500).json({ error: "Failed to reject tweet." });
        }
        broadcastUpdate();
        res.json({ success: true });
    });
});

// Clear logs
app.post('/api/clear-logs', (req, res) => {
    dbManager.clearLogs((err) => {
        if (err) {
            res.status(500).json({ error: "Failed to clear database logs." });
        } else {
            broadcastUpdate();
            res.json({ success: true });
        }
    });
});

if (!process.versions.electron) {
    server.listen(PORT, () => {
        console.log(`whatisx Twitter auto-replier listening on port http://localhost:${PORT}`);
    });
}

module.exports = server;
