const faunadb = require('faunadb');
const q = faunadb.query;

const client = new faunadb.Client({ secret: process.env.FAUNADB_SECRET });

exports.handler = async (event, context) => {
    try {
        const response = await client.query(
            q.Map(
                q.Paginate(q.Match(q.Index('all_chat_messages')), { size: 50, reverse: true }), // Fetch last 50 messages
                q.Lambda(['ts', 'ref'], q.Select('data', q.Get(q.Var('ref'))))
            )
        );

        const chatMessages = response.data.reverse(); // Reverse to show oldest first

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, messages: chatMessages })
        };
    } catch (error) {
        console.error('Get chat history error:', error);
        return { statusCode: 500, body: JSON.stringify({ success: false, message: 'Failed to retrieve chat history.' }) };
    }
};
