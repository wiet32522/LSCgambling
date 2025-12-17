const faunadb = require('faunadb');
const q = faunadb.query;

const client = new faunadb.Client({ secret: process.env.FAUNADB_SECRET });

exports.handler = async (event, context) => {
    try {
        const { userId } = JSON.parse(event.body || '{}'); // Expect userId in body for security, or pass in headers
        // For actual production, userId should come from an authenticated session/token, not directly from client body.
        // For this example, we'll assume the client is sending a valid userId after login.

        if (!userId) {
             return { statusCode: 400, body: JSON.stringify({ success: false, message: 'User ID is required.' }) };
        }

        const userDoc = await client.query(
            q.Get(q.Ref(q.Collection('users'), userId))
        );

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                user: {
                    id: userDoc.ref.id,
                    username: userDoc.data.username,
                    lsc_balance: parseFloat(userDoc.data.lsc_balance).toFixed(2)
                }
            })
        };
    } catch (error) {
        if (error.requestResult && error.requestResult.statusCode === 404) {
            return { statusCode: 404, body: JSON.stringify({ success: false, message: 'User not found.' }) };
        }
        console.error('Get user data function error:', error);
        return { statusCode: 500, body: JSON.stringify({ success: false, message: 'Failed to fetch user data.' }) };
    }
};
