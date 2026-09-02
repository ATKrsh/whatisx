const sqlite3 = require('sqlite3').verbose();
const path = require('path');

let userDataPath;
if (process.versions.electron) {
    const { app } = require('electron');
    userDataPath = app.getPath('userData');
} else {
    userDataPath = __dirname;
}

const dbPath = path.join(userDataPath, 'whatisx.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Database connection error in whatisx:", err);
    } else {
        console.log("Connected to whatisx SQLite database.");
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS tweets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tweet_id TEXT UNIQUE,
        username TEXT,
        tweet_text TEXT,
        reply_text TEXT,
        prediction TEXT,
        status TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        error TEXT
    )`);
}

function saveTweet(tweet, callback) {
    db.run(`INSERT OR IGNORE INTO tweets (tweet_id, username, tweet_text, reply_text, prediction, status)
            VALUES (?, ?, ?, ?, ?, ?)`,
        [tweet.tweet_id, tweet.username, tweet.tweet_text, tweet.reply_text, tweet.prediction, tweet.status],
        function(err) {
            if (callback) callback(err, this ? this.lastID : null);
        }
    );
}

function updateTweetStatus(id, status, replyText, error, callback) {
    db.run(`UPDATE tweets SET status = ?, reply_text = ?, error = ? WHERE id = ?`,
        [status, replyText, error, id],
        function(err) {
            if (callback) callback(err);
        }
    );
}

function getPendingTweets(callback) {
    db.all(`SELECT * FROM tweets WHERE status = 'PENDING' ORDER BY timestamp DESC`, (err, rows) => {
        callback(err, rows);
    });
}

function getHistory(callback) {
    db.all(`SELECT * FROM tweets ORDER BY timestamp DESC LIMIT 50`, (err, rows) => {
        callback(err, rows);
    });
}

function clearLogs(callback) {
    db.run(`DELETE FROM tweets`, (err) => {
        callback(err);
    });
}

module.exports = {
    db,
    saveTweet,
    updateTweetStatus,
    getPendingTweets,
    getHistory,
    clearLogs
};
