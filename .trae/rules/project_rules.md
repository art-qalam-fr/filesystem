# Règles Projet — Publication sécurisée et opérationnelle

1. Exclusions Git
   - Ignorer: `.env`, `config.json`, `.llm-context/`, `PRD/`, `prd-templates/`, `logs/`.
   - Vérifier avant push: `git ls-files config.json .env` renvoie vide.

2. Configurations d’exemple
   - Utiliser `config.example.json` dans le dépôt.
   - Créer localement `config.json` à partir de l’exemple; secrets via `.env`.

3. Sécurité
   - Interdiction de committer des clés API/tokens/URLs privées.
   - Scanner avant push les patterns sensibles (API_KEY, TOKEN, SECRET, etc.).

4. Démarrage et performance
   - Démarrage non bloquant; init `file-context` différée.
   - Resynchronisation à chaud des clones; clones masqués dans l’IDE.

5. Fiabilisation
   - Backoff supervisé pour les serveurs enfants.

6. Versionnage
   - Tag de version descriptif (ex. `dev-1.2`).

Ce fichier sert de mémo/règle locale dans l’IDE pour rappeler les pratiques obligatoires.
