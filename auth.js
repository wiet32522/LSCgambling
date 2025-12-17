const faunadb = require('faunadb');
const q = faunadb.query;
const bcrypt = require('bcryptjs');

// Initialize FaunaDB client
const client = new faunadb.Client({ secret: process.env.FAUNADB_SECRET });

exports.handler = async (event, context) => {
    try {
        const { username, password, type } = JSON.parse(event.body);

        if (!username || !password || !type) {
            return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Username, password, and type (login/register) are required.' }) };
        }

        if (type === 'register') {
            const hashedPassword = await bcrypt.hash(password, 10);
            try {
                const newUser = await client.query(
                    q.Create(
                        q.Collection('users'),
                        { data: { username, password_hash: hashedPassword, lsc_balance: 1000.00 } }
                    )
                );
                return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Registration successful. Please log in.' }) };
            } catch (error) {
                if (error.requestResult.statusCode === 400 && error.message.includes('instance not unique')) {
                    return { statusCode: 409, body: JSON.stringify({ success: false, message: 'Username already exists.' }) };
                }
                console.error('Registration error:', error);
                return { statusCode: 500, body: JSON.stringify({ success: false, message: 'Failed to register user.' }) };
            }
        } else if (type === 'login') {
            try {
                const userRef = await client.query(
                    q.Get(q.Match(q.Index('users_by_username'), username))
                );
                const isPasswordValid = await bcrypt.compare(password, userRef.data.password_hash);

                if (isPasswordValid) {
                    // Update last_active
                    await client.query(
                        q.Update(
                            userRef.ref,
                            { data: { last_active: q.Now() } }
                        )
                    );
                    return {
                        statusCode: 200,
                        body: JSON.stringify({
                            success: true,
                            message: 'Login successful.',
                            user: {
                                id: userRef.ref.id,
                                username: userRef.data.username,
                                lsc_balance: parseFloat(userRef.data.lsc_balance).toFixed(2)
                            }
                        })
                    };
                } else {
                    return { statusCode: 401, body: JSON.stringify({ success: false, message: 'Invalid username or password.' }) };
                }
            } catch (error) {
                if (error.requestResult.statusCode === 404) {
                    return { statusCode: 401, body: JSON.stringify({ success: false, message: 'Invalid username or password.' }) };
                }
                console.error('Login error:', error);
                return { statusCode: 500, body: JSON.stringify({ success: false, message: 'Failed to log in.' }) };
            }
        } else {
            return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Invalid authentication type.' }) };
        }
    } catch (error) {
        console.error('Authentication function error:', error);
        return { statusCode: 500, body: JSON.stringify({ success: false, message: 'An unexpected error occurred.' }) };
    }
};
