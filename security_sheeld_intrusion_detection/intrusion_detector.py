#!/usr/bin/env python3
"""
Security Shield - Module de Détection d'Intrusion Personnalisé
Alternative à Fail2ban pour Windows avec tableau de bord intégré
"""

import os
import sys
import time
import json
import sqlite3
import threading
import subprocess
from datetime import datetime, timedelta
from collections import defaultdict, deque
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple
import logging
import re

# Configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('intrusion_detection.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

@dataclass
class SecurityEvent:
    """Événement de sécurité détecté"""
    timestamp: datetime
    event_type: str
    source_ip: str
    target_service: str
    details: str
    severity: str  # LOW, MEDIUM, HIGH, CRITICAL

@dataclass
class BannedIP:
    """IP bannie avec détails"""
    ip_address: str
    ban_time: datetime
    unban_time: datetime
    reason: str
    attempt_count: int
    source_events: List[str]

class IntrusionDetector:
    """Détecteur d'intrusion principal"""
    
    def __init__(self, config_file: str = "config.json"):
        self.config = self.load_config(config_file)
        self.db_path = self.config.get('database_path', 'intrusion_detection.db')
        self.banned_ips = {}
        self.security_events = deque(maxlen=10000)
        self.whitelist = set(self.config.get('whitelist', []))
        self.running = False
        self.monitor_thread = None
        
        # Seuils de détection
        self.thresholds = {
            'failed_login': self.config.get('failed_login_threshold', 5),
            'failed_login_window': self.config.get('failed_login_window', 300),  # 5 minutes
            'port_scan_threshold': self.config.get('port_scan_threshold', 10),
            'port_scan_window': self.config.get('port_scan_window', 60),  # 1 minute
            'ban_duration': self.config.get('ban_duration', 3600)  # 1 hour
        }
        
        self.init_database()
        
    def load_config(self, config_file: str) -> dict:
        """Charger la configuration"""
        default_config = {
            "database_path": "intrusion_detection.db",
            "whitelist": ["127.0.0.1", "::1"],
            "failed_login_threshold": 5,
            "failed_login_window": 300,
            "port_scan_threshold": 10,
            "port_scan_window": 60,
            "ban_duration": 3600,
            "log_sources": [
                "Security",
                "System",
                "Application"
            ],
            "monitored_services": [
                "SSH",
                "RDP",
                "FTP",
                "HTTP",
                "HTTPS",
                "SMB"
            ]
        }
        
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    user_config = json.load(f)
                default_config.update(user_config)
            except Exception as e:
                logger.warning(f"Impossible de charger la config: {e}")
        
        return default_config
    
    def init_database(self):
        """Initialiser la base de données"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Table des événements
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS security_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                source_ip TEXT NOT NULL,
                target_service TEXT NOT NULL,
                details TEXT NOT NULL,
                severity TEXT NOT NULL
            )
        ''')
        
        # Table des IP bannies
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS banned_ips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip_address TEXT UNIQUE NOT NULL,
                ban_time TEXT NOT NULL,
                unban_time TEXT NOT NULL,
                reason TEXT NOT NULL,
                attempt_count INTEGER NOT NULL,
                is_active INTEGER DEFAULT 1
            )
        ''')
        
        # Table des statistiques
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS statistics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                total_events INTEGER NOT NULL,
                banned_ips_count INTEGER NOT NULL,
                top_attack_types TEXT NOT NULL
            )
        ''')
        
        conn.commit()
        conn.close()
        logger.info("Base de données initialisée")
    
    def get_windows_security_logs(self, hours_back: int = 24) -> List[SecurityEvent]:
        """Récupérer les logs de sécurité Windows"""
        events = []
        
        try:
            # Commande PowerShell pour récupérer les logs de sécurité
            ps_command = f'''
            Get-WinEvent -FilterHashtable @{{
                LogName='Security';
                StartTime=(Get-Date).AddHours(-{hours_back})
            }} | Select-Object TimeCreated, Id, LevelDisplayName, Message | ConvertTo-Json
            '''
            
            result = subprocess.run(
                ['powershell', '-Command', ps_command],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                logs_data = json.loads(result.stdout)
                if not isinstance(logs_data, list):
                    logs_data = [logs_data]
                
                for log_entry in logs_data:
                    event = self.parse_security_event(log_entry)
                    if event:
                        events.append(event)
                        
        except subprocess.TimeoutExpired:
            logger.error("Timeout lors de la récupération des logs")
        except Exception as e:
            logger.error(f"Erreur lors de la récupération des logs: {e}")
        
        return events
    
    def parse_security_event(self, log_entry: dict) -> Optional[SecurityEvent]:
        """Parser un événement de sécurité Windows"""
        try:
            timestamp = datetime.fromisoformat(log_entry['TimeCreated'].replace('Z', '+00:00'))
            event_id = log_entry['Id']
            message = log_entry['Message']
            
            # Extraire l'IP source du message
            ip_match = re.search(r'(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', message)
            source_ip = ip_match.group(1) if ip_match else "Unknown"
            
            # Classifier l'événement
            event_type, severity, service = self.classify_event(event_id, message)
            
            return SecurityEvent(
                timestamp=timestamp,
                event_type=event_type,
                source_ip=source_ip,
                target_service=service,
                details=message[:200],  # Limiter la taille
                severity=severity
            )
            
        except Exception as e:
            logger.error(f"Erreur parsing événement: {e}")
            return None
    
    def classify_event(self, event_id: int, message: str) -> Tuple[str, str, str]:
        """Classifier un événement de sécurité"""
        
        # Échecs de connexion
        if event_id in [4625, 4771, 4768, 4770]:
            if "RDP" in message or "Remote Desktop" in message:
                return "FAILED_LOGIN_RDP", "HIGH", "RDP"
            elif "SSH" in message:
                return "FAILED_LOGIN_SSH", "HIGH", "SSH"
            elif "FTP" in message:
                return "FAILED_LOGIN_FTP", "MEDIUM", "FTP"
            else:
                return "FAILED_LOGIN", "MEDIUM", "Unknown"
        
        # Succès de connexion
        elif event_id == 4624:
            return "SUCCESSFUL_LOGIN", "LOW", "Unknown"
        
        # Détection d'attaques
        elif event_id in [4626, 4648, 4769, 4776]:
            return "SUSPICIOUS_ACTIVITY", "MEDIUM", "Unknown"
        
        # Audit système
        elif event_id in [4672, 4673, 4674]:
            return "PRIVILEGE_USE", "MEDIUM", "System"
        
        # Événements réseau
        elif event_id in [5156, 5157]:
            return "NETWORK_CONNECTION", "LOW", "Network"
        
        else:
            return "UNKNOWN", "LOW", "Unknown"
    
    def detect_intrusions(self, events: List[SecurityEvent]):
        """Détecter les intrusions basées sur les événements"""
        
        # Grouper les événements par IP
        ip_events = defaultdict(list)
        for event in events:
            if event.source_ip != "Unknown" and event.source_ip not in self.whitelist:
                ip_events[event.source_ip].append(event)
        
        # Analyser chaque IP
        for ip, ip_event_list in ip_events.items():
            self.analyze_ip_activity(ip, ip_event_list)
    
    def analyze_ip_activity(self, ip: str, events: List[SecurityEvent]):
        """Analyser l'activité d'une IP spécifique"""
        
        # Compter les échecs de connexion récents
        now = datetime.now()
        failed_logins = [
            e for e in events 
            if "FAILED_LOGIN" in e.event_type 
            and (now - e.timestamp).total_seconds() < self.thresholds['failed_login_window']
        ]
        
        # Détecter les tentatives de force brute
        if len(failed_logins) >= self.thresholds['failed_login_threshold']:
            self.ban_ip(ip, f"Force brute attack: {len(failed_logins)} failed logins", failed_logins)
            return
        
        # Détecter les scans de ports
        recent_events = [
            e for e in events 
            if (now - e.timestamp).total_seconds() < self.thresholds['port_scan_window']
        ]
        
        if len(recent_events) >= self.thresholds['port_scan_threshold']:
            self.ban_ip(ip, f"Port scan detected: {len(recent_events)} events", recent_events)
    
    def ban_ip(self, ip: str, reason: str, events: List[SecurityEvent]):
        """Bannir une IP via Windows Firewall"""
        
        if ip in self.banned_ips:
            return  # Déjà bannie
        
        try:
            # Créer la règle firewall
            rule_name = f"SecurityShield_Blocked_{ip.replace('.', '_')}"
            
            # Vérifier si la règle existe déjà
            check_cmd = f'netsh advfirewall firewall show rule name="{rule_name}"'
            result = subprocess.run(check_cmd, capture_output=True, text=True)
            
            if "No rules match" in result.stdout:
                # Créer la règle de blocage
                block_cmd = f'netsh advfirewall firewall add rule name="{rule_name}" dir=in action=block remoteip={ip}'
                subprocess.run(block_cmd, shell=True, check=True)
                
                # Enregistrer le bannissement
                ban_time = datetime.now()
                unban_time = ban_time + timedelta(seconds=self.thresholds['ban_duration'])
                
                banned_ip = BannedIP(
                    ip_address=ip,
                    ban_time=ban_time,
                    unban_time=unban_time,
                    reason=reason,
                    attempt_count=len(events),
                    source_events=[str(e.timestamp) for e in events[:5]]
                )
                
                self.banned_ips[ip] = banned_ip
                self.save_banned_ip(banned_ip)
                
                logger.warning(f"IP {ip} bannie: {reason}")
                
        except subprocess.CalledProcessError as e:
            logger.error(f"Erreur lors du bannissement de {ip}: {e}")
        except Exception as e:
            logger.error(f"Erreur inattendue lors du bannissement: {e}")
    
    def save_banned_ip(self, banned_ip: BannedIP):
        """Sauvegarder une IP bannie en base de données"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO banned_ips 
            (ip_address, ban_time, unban_time, reason, attempt_count, is_active)
            VALUES (?, ?, ?, ?, ?, 1)
        ''', (
            banned_ip.ip_address,
            banned_ip.ban_time.isoformat(),
            banned_ip.unban_time.isoformat(),
            banned_ip.reason,
            banned_ip.attempt_count
        ))
        
        conn.commit()
        conn.close()
    
    def unban_expired_ips(self):
        """Débannir les IP dont le bannissement a expiré"""
        now = datetime.now()
        expired_ips = []
        
        for ip, banned_ip in list(self.banned_ips.items()):
            if now >= banned_ip.unban_time:
                expired_ips.append(ip)
        
        for ip in expired_ips:
            try:
                # Supprimer la règle firewall
                rule_name = f"SecurityShield_Blocked_{ip.replace('.', '_')}"
                unblock_cmd = f'netsh advfirewall firewall delete rule name="{rule_name}"'
                subprocess.run(unblock_cmd, shell=True, check=True)
                
                # Marquer comme inactive en base
                conn = sqlite3.connect(self.db_path)
                cursor = conn.cursor()
                cursor.execute('UPDATE banned_ips SET is_active = 0 WHERE ip_address = ?', (ip,))
                conn.commit()
                conn.close()
                
                del self.banned_ips[ip]
                logger.info(f"IP {ip} débannie")
                
            except Exception as e:
                logger.error(f"Erreur lors du débannissement de {ip}: {e}")
    
    def start_monitoring(self):
        """Démarrer la surveillance en continu"""
        self.running = True
        self.monitor_thread = threading.Thread(target=self.monitoring_loop, daemon=True)
        self.monitor_thread.start()
        logger.info("Surveillance de détection d'intrusion démarrée")
    
    def monitoring_loop(self):
        """Boucle de surveillance principale"""
        while self.running:
            try:
                # Récupérer les événements récents
                events = self.get_windows_security_logs(hours_back=1)
                
                # Détecter les intrusions
                self.detect_intrusions(events)
                
                # Nettoyer les bannissements expirés
                self.unban_expired_ips()
                
                # Attendre avant le prochain cycle
                time.sleep(30)  # Vérifier toutes les 30 secondes
                
            except Exception as e:
                logger.error(f"Erreur dans la boucle de surveillance: {e}")
                time.sleep(60)  # Attendre plus longtemps en cas d'erreur
    
    def stop_monitoring(self):
        """Arrêter la surveillance"""
        self.running = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=5)
        logger.info("Surveillance de détection d'intrusion arrêtée")
    
    def get_dashboard_data(self) -> dict:
        """Récupérer les données pour le tableau de bord"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Statistiques générales
        cursor.execute('''
            SELECT 
                COUNT(*) as total_events,
                COUNT(DISTINCT source_ip) as unique_ips,
                COUNT(CASE WHEN severity = 'HIGH' THEN 1 END) as high_severity,
                COUNT(CASE WHEN severity = 'CRITICAL' THEN 1 END) as critical_severity
            FROM security_events 
            WHERE timestamp > datetime('now', '-24 hours')
        ''')
        
        stats = cursor.fetchone()
        
        # IP actuellement bannies
        cursor.execute('SELECT COUNT(*) FROM banned_ips WHERE is_active = 1')
        banned_count = cursor.fetchone()[0]
        
        # Top 5 des types d'attaques
        cursor.execute('''
            SELECT event_type, COUNT(*) as count 
            FROM security_events 
            WHERE timestamp > datetime('now', '-24 hours')
            GROUP BY event_type 
            ORDER BY count DESC 
            LIMIT 5
        ''')
        
        top_attacks = cursor.fetchall()
        
        # Événements récents
        cursor.execute('''
            SELECT timestamp, event_type, source_ip, severity, details
            FROM security_events 
            WHERE timestamp > datetime('now', '-6 hours')
            ORDER BY timestamp DESC 
            LIMIT 20
        ''')
        
        recent_events = cursor.fetchall()
        
        conn.close()
        
        return {
            'statistics': {
                'total_events': stats[0] or 0,
                'unique_ips': stats[1] or 0,
                'high_severity': stats[2] or 0,
                'critical_severity': stats[3] or 0,
                'banned_ips': banned_count
            },
            'top_attacks': [{'type': row[0], 'count': row[1]} for row in top_attacks],
            'recent_events': [
                {
                    'timestamp': row[0],
                    'type': row[1],
                    'source_ip': row[2],
                    'severity': row[3],
                    'details': row[4]
                }
                for row in recent_events
            ],
            'active_bans': len(self.banned_ips)
        }

if __name__ == "__main__":
    # Point d'entrée principal
    detector = IntrusionDetector()
    
    try:
        detector.start_monitoring()
        
        # Garder le programme en cours d'exécution
        while True:
            time.sleep(1)
            
    except KeyboardInterrupt:
        logger.info("Arrêt demandé par l'utilisateur")
        detector.stop_monitoring()
    except Exception as e:
        logger.error(f"Erreur fatale: {e}")
        detector.stop_monitoring()