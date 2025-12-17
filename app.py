import os
import random
import threading
import time
from datetime import datetime, timedelta

from flask import Flask, request, jsonify, render_template_string, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

# --- Flask App Configuration ---
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your_super_secret_key_here') # Use a strong, random key in production
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///wiet_casino.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet') # Allow all origins for development, use specific ones in production

# --- Database Models ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(120), nullable=False)
    lsc_balance = db.Column(db.Float, default=1000.00) # Starting balance
    last_active = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'lsc_balance': round(self.lsc_balance, 2)
        }

# --- Global State for Chat and LSC Rain ---
chat_messages = []
connected_users = {} # {user_id: socket_id, ...}
rain_amount = 50000.00
rain_interval_seconds = 3600 # 1 hour

# --- Database Initialization ---
with app.app_context():
    db.create_all()
    print("Database created (if it didn't exist).")

# --- Authentication Routes ---
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password are required.'}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({'success': False, 'message': 'Username already exists.'}), 409

    new_user = User(username=username)
    new_user.set_password(password)
    db.session.add(new_user)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Registration successful. Please log in.'})

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    user = User.query.filter_by(username=username).first()

    if user and user.check_password(password):
        session['user_id'] = user.id
        session['username'] = user.username
        user.last_active = datetime.utcnow() # Update last active on login
        db.session.commit()
        return jsonify({'success': True, 'message': 'Login successful.', 'user': user.to_dict()})
    else:
        return jsonify({'success': False, 'message': 'Invalid username or password.'}), 401

@app.route('/logout', methods=['POST'])
def logout():
    session.pop('user_id', None)
    session.pop('username', None)
    return jsonify({'success': True, 'message': 'Logged out successfully.'})

@app.route('/user_data', methods=['GET'])
def get_user_data():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not authenticated.'}), 401
    
    user = User.query.get(session['user_id'])
    if user:
        return jsonify({'success': True, 'user': user.to_dict()})
    return jsonify({'success': False, 'message': 'User not found.'}), 404

# --- Game Logic Route (Simplified for Roll) ---
@app.route('/place_bet', methods=['POST'])
def place_bet():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Not authenticated.'}), 401

    data = request.get_json()
    bet_amount = float(data.get('bet_amount'))
    target_multiplier = float(data.get('target_multiplier'))
    house_edge = 0.01 # 1% house edge

    user = User.query.get(session['user_id'])

    if not user or user.lsc_balance < bet_amount:
        return jsonify({'success': False, 'message': 'Insufficient funds.'}), 400
    
    if bet_amount <= 0 or target_multiplier < 1.01:
        return jsonify({'success': False, 'message': 'Invalid bet or multiplier.'}), 400

    user.lsc_balance -= bet_amount
    db.session.commit()

    win_chance = (99.0 / target_multiplier) - house_edge
    roll_result = random.uniform(0, 100) # Random number between 0 and 100

    outcome = {
        'roll_result': round(roll_result, 2),
        'bet_amount': round(bet_amount, 2),
        'target_multiplier': round(target_multiplier, 2),
        'win': False,
        'winnings': 0.00,
        'new_balance': round(user.lsc_balance, 2)
    }

    if roll_result < win_chance:
        winnings = bet_amount * target_multiplier
        user.lsc_balance += winnings
        db.session.commit()
        outcome['win'] = True
        outcome['winnings'] = round(winnings, 2)
        outcome['new_balance'] = round(user.lsc_balance, 2)

    # Emit balance update to the specific user
    socketio.emit('balance_update', {'new_balance': outcome['new_balance']}, room=connected_users.get(user.id))
    
    return jsonify({'success': True, 'outcome': outcome})

# --- Socket.IO Events ---
@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    user_id = session.get('user_id')
    if user_id:
        connected_users[user_id] = request.sid
        join_room(request.sid) # Each user has their own room for private messages (like balance updates)
        print(f'User {session.get("username")} ({user_id}) connected with SID {request.sid}')
        # Send recent chat history to newly connected user
        emit('chat_history', chat_messages, room=request.sid)

@socketio.on('disconnect')
def handle_disconnect():
    user_id = session.get('user_id')
    if user_id and connected_users.get(user_id) == request.sid:
        del connected_users[user_id]
        print(f'User {session.get("username")} ({user_id}) disconnected.')
    print(f'Client disconnected: {request.sid}')

@socketio.on('message')
def handle_message(data):
    user_id = session.get('user_id')
    username = session.get('username')
    if not user_id or not username:
        emit('error', {'message': 'You must be logged in to chat.'}, room=request.sid)
        return

    message_text = data.get('text')
    if message_text:
        timestamp = datetime.utcnow().strftime('%H:%M')
        full_message = {'username': username, 'text': message_text, 'timestamp': timestamp}
        chat_messages.append(full_message)
        # Keep chat history trimmed
        if len(chat_messages) > 50:
            chat_messages.pop(0)
        emit('new_message', full_message, broadcast=True)
        print(f'Chat message from {username}: {message_text}')

# --- LSC Rain Function ---
def lsc_rain_task():
    global rain_interval_seconds
    while True:
        with app.app_context():
            print("Running LSC Rain task...")
            # Only consider users active in the last 1 hour (or connected)
            active_user_ids = list(connected_users.keys())
            
            if active_user_ids:
                total_active_users = len(active_user_ids)
                lsc_per_user = rain_amount / total_active_users
                
                print(f"Distributing {rain_amount} LSC among {total_active_users} active users.")

                for user_id in active_user_ids:
                    user = User.query.get(user_id)
                    if user:
                        user.lsc_balance += lsc_per_user
                        db.session.commit()
                        socketio.emit('lsc_rain_notification', 
                                    {'amount': round(lsc_per_user, 2), 'new_balance': round(user.lsc_balance, 2)}, 
                                    room=connected_users.get(user_id))
                        print(f"User {user.username} received {round(lsc_per_user, 2)} LSC.")
            else:
                print("No active users for LSC Rain.")
        
        # Adjust sleep time if needed for debugging or faster testing
        print(f"Next LSC Rain in {rain_interval_seconds / 60} minutes.")
        time.sleep(rain_interval_seconds)

# Start LSC Rain background task
rain_thread = threading.Thread(target=lsc_rain_task, daemon=True)
rain_thread.start()

# --- Main HTML Route (Serves the frontend) ---
@app.route('/')
def index():
    # This will render your updated index.html, including the login/signup functionality
    with open('index.html', 'r') as f:
        html_content = f.read()
    return render_template_string(html_content)

if __name__ == '__main__':
    print("Starting Flask-SocketIO server...")
    socketio.run(app, debug=True, port=5000)
