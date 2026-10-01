# Script PowerShell pour copier le projet Lottery Prediction AI
# dans le répertoire de travail de l'utilisateur

Write-Host "🚀 Copie du projet Lottery Prediction AI..." -ForegroundColor Green

# Répertoires
$source = "<HEPHAISTOS_ROOT>"
$destination = "<HEPHAISTOS_ROOT>"

# Créer le répertoire de destination s'il n'existe pas
if (!(Test-Path $destination)) {
    New-Item -ItemType Directory -Path $destination -Force
    Write-Host "✅ Répertoire créé: $destination" -ForegroundColor Green
}

# Copier tous les fichiers
Write-Host "📁 Copie des fichiers..." -ForegroundColor Yellow
Copy-Item -Path "$source\*" -Destination $destination -Recurse -Force

Write-Host "✅ Projet copié avec succès dans: $destination" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Prochaines étapes:" -ForegroundColor Cyan
Write-Host "1. cd $destination"
Write-Host "2. cd backend"
Write-Host "3. python -m venv venv"
Write-Host "4. venv\Scripts\activate"
Write-Host "5. pip install -r requirements.txt"
Write-Host "6. python test_scraper.py"