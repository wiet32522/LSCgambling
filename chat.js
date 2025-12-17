const Pusher = require('pusher');
const faunadb = require('faunadb');
const q = faunadb.query;

const faunaClient = new faunadb.Client({ secret: process.env.FAUNADB_SECRET });

const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
});

exports.handler = async (event, context) => {
    // CORS headers for preflight requests and actual requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
            }
        };
    }

    const headers = {
        "Access-Control-Allow-Origin": "*", // Allow all origins for development
        "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
    };

    try {
        const { userId, username, text } = JSON.parse(event.body);

        if (!userId || !username || !text) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ success: false, message: 'User ID, username, and message text are required.' })
            };
        }

        const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        // Store message in FaunaDB
        await faunaClient.query(
            q.Create(
                q.Collection('chat_messages'),
                { data: { userId, username, text, timestamp, createdAt: q.Now() } }
            )
        );

        // Trigger Pusher event for real-time delivery
        await pusher.trigger('chat-channel', 'new-message', { userId, username, text, timestamp });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'Message sent.' })
        };

    } catch (error) {
        console.error('Chat function error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, message: error.message || 'Failed to send message.' })
        };
    }
};
