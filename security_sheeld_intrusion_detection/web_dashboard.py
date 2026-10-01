#!/usr/bin/env python3
"""
Tableau de bord web pour Security Shield Intrusion Detection
Interface de monitoring en temps réel
"""

from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit
import json
import sqlite3
from datetime import datetime, timedelta
import threading
import time
from intrusion_detector import IntrusionDetector

app = Flask(__name__)
app.config['SECRET_KEY'] = 'security_shield_secret_key'
socketio = SocketIO(app, cors_allowed_origins="*")

# Instance du détecteur
detector = IntrusionDetector()

@app.route('/')
def index():
    """Page principale du tableau de bord"""
    return render_template('dashboard.html')

@app.route('/api/dashboard')
def get_dashboard_data():
    """API pour récupérer les données du tableau de bord"""
    try:
        data = detector.get_dashboard_data()
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/events')
def get_events():
    """API pour récupérer les événements récents"""
    try:
        hours = request.args.get('hours', 6, type=int)
        limit = request.args.get('limit', 50, type=int)
        
        conn = sqlite3.connect(detector.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT timestamp, event_type, source_ip, target_service, severity, details
            FROM security_events 
            WHERE timestamp > datetime('now', '-{} hours')
            ORDER BY timestamp DESC 
            LIMIT ?
        '''.format(hours), (limit,))
        
        events = []
        for row in cursor.fetchall():
            events.append({
                'timestamp': row[0],
                'type': row[1],
                'source_ip': row[2],
                'service': row[3],
                'severity': row[4],
                'details': row[5]
            })
        
        conn.close()
        return jsonify(events)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/banned')
def get_banned_ips():
    """API pour récupérer les IP bannies"""
    try:
        conn = sqlite3.connect(detector.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT ip_address, ban_time, unban_time, reason, attempt_count, is_active
            FROM banned_ips 
            ORDER BY ban_time DESC 
            LIMIT 100
        ''')
        
        banned = []
        for row in cursor.fetchall():
            banned.append({
                'ip': row[0],
                'ban_time': row[1],
                'unban_time': row[2],
                'reason': row[3],
                'attempt_count': row[4],
                'active': bool(row[5])
            })
        
        conn.close()
        return jsonify(banned)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/unban', methods=['POST'])
def unban_ip():
    """API pour débannir manuellement une IP"""
    try:
        data = request.get_json()
        ip = data.get('ip')
        
        if not ip:
            return jsonify({'error': 'IP requise'}), 400
        
        # Utiliser la méthode du détecteur
        if ip in detector.banned_ips:
            detector.unban_expired_ips()
            # Forcer le débannissement de cette IP spécifique
            try:
                rule_name = f"SecurityShield_Blocked_{ip.replace('.', '_')}"
                import subprocess
                subprocess.run(f'netsh advfirewall firewall delete rule name="{rule_name}"', shell=True, check=True)
                
                conn = sqlite3.connect(detector.db_path)
                cursor = conn.cursor()
                cursor.execute('UPDATE banned_ips SET is_active = 0 WHERE ip_address = ?', (ip,))
                conn.commit()
                conn.close()
                
                if ip in detector.banned_ips:
                    del detector.banned_ips[ip]
                
                return jsonify({'success': True, 'message': f'IP {ip} débannie'})
                
            except Exception as e:
                return jsonify({'error': f'Erreur lors du débannissement: {e}'}), 500
        else:
            return jsonify({'error': 'IP non trouvée dans la liste des bannies'}), 404
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/whitelist', methods=['GET', 'POST'])
def manage_whitelist():
    """API pour gérer la whitelist"""
    try:
        if request.method == 'GET':
            return jsonify({'whitelist': list(detector.whitelist)})
        
        elif request.method == 'POST':
            data = request.get_json()
            action = data.get('action')
            ip = data.get('ip')
            
            if not ip:
                return jsonify({'error': 'IP requise'}), 400
            
            if action == 'add':
                detector.whitelist.add(ip)
                return jsonify({'success': True, 'message': f'IP {ip} ajoutée à la whitelist'})
            elif action == 'remove':
                detector.whitelist.discard(ip)
                return jsonify({'success': True, 'message': f'IP {ip} retirée de la whitelist'})
            else:
                return jsonify({'error': 'Action invalide'}), 400
                
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/config', methods=['GET', 'POST'])
def manage_config():
    """API pour gérer la configuration"""
    try:
        if request.method == 'GET':
            return jsonify(detector.config)
        
        elif request.method == 'POST':
            data = request.get_json()
            
            # Mettre à jour la configuration
            for key, value in data.items():
                if key in detector.config:
                    detector.config[key] = value
            
            # Sauvegarder la configuration
            with open('config.json', 'w') as f:
                json.dump(detector.config, f, indent=2)
            
            # Recharger les seuils
            detector.thresholds.update({
                'failed_login': detector.config.get('failed_login_threshold', 5),
                'failed_login_window': detector.config.get('failed_login_window', 300),
                'port_scan_threshold': detector.config.get('port_scan_threshold', 10),
                'port_scan_window': detector.config.get('port_scan_window', 60),
                'ban_duration': detector.config.get('ban_duration', 3600)
            })
            
            return jsonify({'success': True, 'message': 'Configuration mise à jour'})
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@socketio.on('connect')
def handle_connect():
    """Gestion de la connexion WebSocket"""
    emit('status', {'message': 'Connecté au tableau de bord Security Shield'})

def background_updater():
    """Thread de mise à jour en arrière-plan"""
    while True:
        try:
            # Envoyer les données mises à jour tous les 5 secondes
            data = detector.get_dashboard_data()
            socketio.emit('dashboard_update', data)
            time.sleep(5)
        except Exception as e:
            print(f"Erreur dans le background updater: {e}")
            time.sleep(10)

if __name__ == '__main__':
    # Démarrer le détecteur en arrière-plan
    detector.start_monitoring()
    
    # Démarrer le thread de mise à jour
    update_thread = threading.Thread(target=background_updater, daemon=True)
    update_thread.start()
    
    # Démarrer le serveur web
    print("Tableau de bord Security Shield démarré sur http://localhost:5000")
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)