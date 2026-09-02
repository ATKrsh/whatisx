const { TwitterApi } = require('twitter-api-v2');
const { Scraper, SearchMode } = require('agent-twitter-client');
const fs = require('fs');
const path = require('path');

let userDataPath;
if (process.versions.electron) {
    const { app } = require('electron');
    userDataPath = app.getPath('userData');
} else {
    userDataPath = __dirname;
}

class TwitterService {
    constructor() {
        this.client = null; // Official Twitter API client
        this.scraper = null; // agent-twitter-client scraper client
        this.isMock = true;
        this.authType = 'user'; // 'user' or 'keys'
        this.cookiePath = path.join(userDataPath, 'twitter_cookies.json');
        this.authUser = null; // Logged-in username
        this.loginStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'mock' | 'error'
    }

    async initialize() {
        const authType = process.env.TWITTER_AUTH_TYPE || 'user';
        this.authType = authType;
        const mockMode = process.env.MOCK_MODE === 'true';

        this.loginStatus = 'connecting';
        this.authUser = null;

        if (mockMode) {
            console.log("Twitter service initialized in MOCK MODE (using mock trends and tweets).");
            this.isMock = true;
            this.loginStatus = 'mock';
            this.client = null;
            this.scraper = null;
            return;
        }

        if (authType === 'user') {
            const username = process.env.TWITTER_USERNAME;
            const password = process.env.TWITTER_PASSWORD;
            const email = process.env.TWITTER_EMAIL;

            const hasCookiesFile = fs.existsSync(this.cookiePath);

            if (!hasCookiesFile && (!username || !password)) {
                console.log("X account credentials and cached cookies are missing. Falling back to MOCK MODE.");
                this.isMock = true;
                this.scraper = null;
                return;
            }

            try {
                console.log(`Initializing X Scraper...`);
                this.scraper = new Scraper();
                
                // 1. Try loading cached cookies
                let loggedIn = false;
                if (hasCookiesFile) {
                    try {
                        console.log("Loading Twitter cached cookies...");
                        const rawCookies = JSON.parse(fs.readFileSync(this.cookiePath, 'utf8'));
                        
                        // Normalize cookies: agent-twitter-client setCookies() expects an array
                        // of cookie strings in "name=value; Domain=x; Path=/" format.
                        // Handle both plain objects and already-formatted strings.
                        const cookieStrings = rawCookies.map(c => {
                            if (typeof c === 'string') return c;
                            // Convert cookie object to string format
                            let str = `${c.key || c.name}=${c.value}`;
                            if (c.domain) str += `; Domain=${c.domain}`;
                            if (c.path) str += `; Path=${c.path}`;
                            if (c.secure) str += `; Secure`;
                            if (c.httpOnly) str += `; HttpOnly`;
                            if (c.sameSite) str += `; SameSite=${c.sameSite}`;
                            return str;
                        });

                        await this.scraper.setCookies(cookieStrings);
                        loggedIn = await this.scraper.isLoggedIn();
                        if (loggedIn) {
                            console.log("Successfully logged in to Twitter via cached cookies.");
                        } else {
                            console.log("Cached cookies are expired or invalid.");
                        }
                    } catch (cookieErr) {
                        console.warn("Failed to load or verify cached cookies:", cookieErr.message);
                    }
                }

                // 2. Direct login if cookies not present or invalid, and we have credentials
                if (!loggedIn) {
                    if (username && password) {
                        console.log(`Authenticating direct login for X account @${username}...`);
                        await this.scraper.login(username, password, email);
                        
                        loggedIn = await this.scraper.isLoggedIn();
                        if (loggedIn) {
                            console.log("Direct login successful. Saving cookies to cache...");
                            const cookies = await this.scraper.getCookies();
                            fs.writeFileSync(this.cookiePath, JSON.stringify(cookies, null, 2), 'utf8');
                        } else {
                            throw new Error("Direct login verification failed. Check credentials/email.");
                        }
                    } else {
                        throw new Error("Cached cookies are invalid/expired and no username/password credentials were provided to log in.");
                    }
                }

                this.isMock = false;
                this.loginStatus = 'connected';
                // Try to get the logged-in profile
                try {
                    const me = await this.scraper.me();
                    this.authUser = me?.username || process.env.TWITTER_USERNAME || null;
                    console.log(`Logged in as @${this.authUser}`);
                } catch(e) {
                    this.authUser = process.env.TWITTER_USERNAME || null;
                }
                console.log("Twitter service initialized in USER LOGIN MODE.");
            } catch (error) {
                console.error("Failed to initialize X Scraper Client, falling back to mock mode:", error);
                this.isMock = true;
                this.loginStatus = 'error';
                this.authUser = null;
                this.scraper = null;
            }
        } else {
            // Official API Keys authentication
            const apiKey = process.env.TWITTER_API_KEY;
            const apiSecret = process.env.TWITTER_API_SECRET;
            const accessToken = process.env.TWITTER_ACCESS_TOKEN;
            const accessSecret = process.env.TWITTER_ACCESS_SECRET;

            if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
                console.log("Twitter API Keys missing. Falling back to MOCK MODE.");
                this.isMock = true;
                this.client = null;
                return;
            }

            try {
                this.client = new TwitterApi({
                    appKey: apiKey,
                    appSecret: apiSecret,
                    accessToken: accessToken,
                    accessSecret: accessSecret,
                });
                this.isMock = false;
                this.loginStatus = 'connected';
                this.authUser = null; // API key mode doesn't expose a specific user
                this.scraper = null;
                console.log("Twitter Service initialized in OFFICIAL API MODE.");
            } catch (error) {
                console.error("Failed to initialize Twitter API Client, falling back to mock mode:", error);
                this.isMock = true;
                this.loginStatus = 'error';
                this.authUser = null;
                this.client = null;
            }
        }
    }

    async searchTrendingTweets(query) {
        if (this.isMock) {
            // Return simulated trending tweets from human history, tech, and science
            const mockTweets = [
                {
                    tweet_id: "mock_12345",
                    username: "SpaceXFanatic",
                    tweet_text: "Starship Flight 6 test looks like it's targetting a launch next month. Will they catch the booster again?"
                },
                {
                    tweet_id: "mock_67890",
                    username: "HistoryGeek",
                    tweet_text: "On this day in 1969, Neil Armstrong and Buzz Aldrin walked on the Moon. Still the peak of human exploration!"
                },
                {
                    tweet_id: "mock_11223",
                    username: "AIUniverse",
                    tweet_text: "Open-source AI models are catching up to proprietary ones at an unbelievable speed. Are closed API business models dead?"
                },
                {
                    tweet_id: "mock_44556",
                    username: "TechInsider",
                    tweet_text: "Quantum computers just achieved a new quantum supremacy benchmark, performing calculations in minutes that take supercomputers 40 years."
                },
                {
                    tweet_id: "mock_77889",
                    username: "NatureScience",
                    tweet_text: "New archaeological discoveries in Egypt suggest that the pyramids were built using highly advanced hydraulic engineering systems."
                }
            ];
            
            // Randomly pick 2-3 mock tweets
            const count = Math.floor(Math.random() * 2) + 2;
            const shuffled = mockTweets.sort(() => 0.5 - Math.random());
            return shuffled.slice(0, count);
        }

        if (this.authType === 'user' && this.scraper) {
            try {
                console.log(`Searching tweets for topic "${query}" using Scraper client...`);
                // Limit results to 10 tweets
                const response = await this.scraper.searchTweets(query, 10, SearchMode.Latest);
                const tweets = [];
                
                for await (const tweet of response) {
                    // Check fields to ensure we don't crash on incomplete data
                    if (tweet && tweet.id && tweet.text) {
                        tweets.push({
                            tweet_id: tweet.id,
                            username: tweet.username || `user_${tweet.userId || 'unknown'}`,
                            tweet_text: tweet.text
                        });
                    }
                }
                
                console.log(`Found ${tweets.length} tweets.`);
                return tweets;
            } catch (error) {
                console.error("Error searching tweets via Scraper in live mode:", error);
                throw error;
            }
        } else if (this.client) {
            try {
                // Perform live search using Twitter API v2
                const response = await this.client.v2.search(query, {
                    'tweet.fields': ['author_id', 'created_at'],
                    max_results: 10
                });
                
                const tweets = [];
                for await (const tweet of response) {
                    tweets.push({
                        tweet_id: tweet.id,
                        username: `user_${tweet.author_id}`, // Twitter API v2 requires extra lookups for username handles, we simplify here
                        tweet_text: tweet.text
                    });
                }
                return tweets;
            } catch (error) {
                console.error("Error searching tweets via API in live mode:", error);
                throw error;
            }
        }
        
        return [];
    }

    async replyToTweet(tweetId, text) {
        if (this.isMock) {
            console.log(`[Mock Reply] Successfully replied to tweet ${tweetId} with: "${text}"`);
            return { success: true, id: `mock_reply_${Date.now()}` };
        }

        if (this.authType === 'user' && this.scraper) {
            try {
                console.log(`[User Reply] Posting reply to tweet ${tweetId} using Scraper...`);
                const response = await this.scraper.sendTweet(text, tweetId);
                console.log(`[User Reply] Posted successfully.`, response);
                return { success: true, id: `user_reply_${Date.now()}` };
            } catch (error) {
                console.error(`Failed to post reply via Scraper to tweet ${tweetId}:`, error);
                throw error;
            }
        } else if (this.client) {
            try {
                const response = await this.client.v2.reply(text, tweetId);
                console.log(`[Live Reply] Posted successfully to tweet ${tweetId}: ${response.data.id}`);
                return { success: true, id: response.data.id };
            } catch (error) {
                console.error(`Failed to post reply to tweet ${tweetId}:`, error);
                throw error;
            }
        }
        
        throw new Error("No active live connection to Twitter available.");
    }
}

module.exports = new TwitterService();
