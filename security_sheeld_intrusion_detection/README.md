# Security Shield - Module de Détection d'Intrusion

Alternative à Fail2ban pour Windows avec tableau de bord intégré.

## Fonctionnalités

- **Analyse en temps réel** des logs Windows Security Events
- **Blocage automatique** des IP malveillantes via Windows Firewall
- **Tableau de bord web** avec monitoring en temps réel
- **Gestion de whitelist** pour IPs de confiance
- **Configuration personnalisable** (seuils, durées, etc.)

## Installation

1. Installer les dépendances :
```bash
pip install -r requirements.txt
```

2. Lancer le tableau de bord :
```bash
python web_dashboard.py
```

3. Accéder au tableau de bord :
```
http://localhost:5000
```

## Utilisation

### Mode autonome (sans interface web)
```bash
python intrusion_detector.py
```

### Avec tableau de bord
```bash
python web_dashboard.py
```

## Configuration

Modifier `config.json` :

- `failed_login_threshold` : Nombre d'échecs avant bannissement (défaut: 5)
- `ban_duration` : Durée du bannissement en secondes (défaut: 3600)
- `whitelist` : Liste des IPs à ne jamais bannir
- `monitored_services` : Services à surveiller

## Architecture

```
security_sheeld_intrusion_detection/
├── intrusion_detector.py    # Moteur de détection
├── web_dashboard.py         # Serveur web Flask
├── config.json             # Configuration
├── requirements.txt        # Dépendances
└── templates/
    └── dashboard.html      # Interface web
```

## Prérequis

- Windows 10/11 ou Windows Server
- Python 3.8+
- Droits administrateur (pour modifier le firewall)

## Sécurité

⚠️ **Important** : Ce module nécessite des droits administrateur pour :
- Lire les logs de sécurité Windows
- Modifier les règles du pare-feu Windows
- Bloquer/débloquer des adresses IP