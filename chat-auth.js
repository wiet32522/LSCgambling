const Pusher = require('pusher');

const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
});

exports.handler = async (event, context) => {
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
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
    };

    try {
        const body = JSON.parse(event.body);
        const socketId = body.socket_id;
        const channelName = body.channel_name;
        // Optionally, check if user is authenticated here if using private channels

        const auth = pusher.authorizeChannel(socketId, channelName);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(auth)
        };
    } catch (error) {
        console.error('Pusher authentication error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, message: error.message || 'Failed to authenticate Pusher channel.' })
        };
    }
};
