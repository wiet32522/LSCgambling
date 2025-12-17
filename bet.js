const faunadb = require('faunadb');
const q = faunadb.query;

const client = new faunadb.Client({ secret: process.env.FAUNADB_SECRET });

exports.handler = async (event, context) => {
    try {
        const { userId, betAmount, targetMultiplier } = JSON.parse(event.body);

        if (!userId || isNaN(betAmount) || isNaN(targetMultiplier)) {
            return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Invalid bet parameters.' }) };
        }

        const houseEdge = 0.01; // 1% house edge

        // Get user data and update balance within a transaction
        const result = await client.query(
            q.Let(
                {
                    userRef: q.Ref(q.Collection('users'), userId),
                    userDoc: q.Get(q.Var('userRef'))
                },
                q.If(
                    q.LT(q.Select(['data', 'lsc_balance'], q.Var('userDoc')), betAmount),
                    q.Abort('Insufficient funds.'),
                    q.Let(
                        {
                            newBalanceAfterBet: q.Subtract(q.Select(['data', 'lsc_balance'], q.Var('userDoc')), betAmount),
                            rollResult: q.Multiply(q.Rand(), 100), // Random number between 0 and 100
                            winChance: q.Subtract(q.Divide(99.0, targetMultiplier), houseEdge),
                            isWin: q.LT(q.Var('rollResult'), q.Var('winChance'))
                        },
                        q.Do(
                            q.Update(
                                q.Var('userRef'),
                                { data: { lsc_balance: q.Var('newBalanceAfterBet') } } // Deduct bet first
                            ),
                            q.If(
                                q.Var('isWin'),
                                q.Let(
                                    { winnings: q.Multiply(betAmount, targetMultiplier) },
                                    q.Do(
                                        q.Update(
                                            q.Var('userRef'),
                                            { data: { lsc_balance: q.Add(q.Var('newBalanceAfterBet'), q.Var('winnings')) } } // Add winnings
                                        ),
                                        {
                                            roll_result: q.Var('rollResult'),
                                            bet_amount: betAmount,
                                            target_multiplier: targetMultiplier,
                                            win: true,
                                            winnings: q.Var('winnings'),
                                            new_balance: q.Add(q.Var('newBalanceAfterBet'), q.Var('winnings'))
                                        }
                                    )
                                ),
                                {
                                    roll_result: q.Var('rollResult'),
                                    bet_amount: betAmount,
                                    target_multiplier: targetMultiplier,
                                    win: false,
                                    winnings: 0.00,
                                    new_balance: q.Var('newBalanceAfterBet')
                                }
                            )
                        )
                    )
                )
            )
        );

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, outcome: result })
        };

    } catch (error) {
        console.error('Bet function error:', error);
        if (error.message === 'Insufficient funds.') {
            return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Insufficient funds.' }) };
        }
        return { statusCode: 500, body: JSON.stringify({ success: false, message: error.message || 'An error occurred during the bet.' }) };
    }
};
