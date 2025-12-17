const faunadb = require('faunadb');
const q = faunadb.query;
const Pusher = require('pusher');

const client = new faunadb.Client({ secret: process.env.FAUNADB_SECRET });

const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
});

exports.handler = async (event, context) => {
    console.log("LSC Rain function triggered!");
    const rainAmount = 50000.00;

    try {
        // Find users active in the last, say, 1 hour (adjust as needed for "active")
        // For simplicity, let's target users with a recent last_active timestamp
        // This requires an index on last_active.
        // If no index, or for true "connected" users, you'd need client-side "pings" to update last_active.

        // Get all users (simplified - for real, query by last_active >= 1 hour ago)
        const allUsers = await client.query(
            q.Map(
                q.Paginate(q.Match(q.Index('all_users'))), // You'd need an 'all_users' index: Name: 'all_users', Collection: 'users', Terms: (empty)
                q.Lambda('userRef', q.Get(q.Var('userRef')))
            )
        );

        const activeUsers = allUsers.data.filter(user => {
            // Implement logic for "active" users.
            // For now, let's just use all users, but ideal would be to filter by `last_active`
            // Example: const lastActiveTime = new Date(user.data.last_active.value);
            // return (new Date() - lastActiveTime) < (3600 * 1000); // Active in last hour
            return true;
        });

        if (activeUsers.length === 0) {
            console.log("No active users for LSC Rain.");
            return { statusCode: 200, body: JSON.stringify({ message: "No active users for LSC Rain." }) };
        }

        const lscPerUser = rainAmount / activeUsers.length;

        for (const userDoc of activeUsers) {
            const newBalance = userDoc.data.lsc_balance + lscPerUser;
            await client.query(
                q.Update(
                    userDoc.ref,
                    { data: { lsc_balance: newBalance } }
                )
            );
            // Notify user via Pusher
            await pusher.trigger(`user-${userDoc.ref.id}`, 'balance-update', {
                new_balance: parseFloat(newBalance).toFixed(2),
                message: `LSC RAIN! You received ${parseFloat(lscPerUser).toFixed(2)} LSC!`
            });
            console.log(`User ${userDoc.data.username} (${userDoc.ref.id}) received ${parseFloat(lscPerUser).toFixed(2)} LSC.`);
        }

        // Notify chat channel about the rain
        await pusher.trigger('chat-channel', 'new-message', {
            username: 'SYSTEM',
            text: `🌧️ LSC RAIN! ${parseFloat(rainAmount).toFixed(2)} LSC distributed to active players! 🌧️`,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        });


        return { statusCode: 200, body: JSON.stringify({ message: `LSC Rain complete. ${activeUsers.length} users updated.` }) };

    } catch (error) {
        console.error('LSC Rain function error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Failed to run LSC Rain.', error: error.message }) };
    }
};
