---
description: PRD – Évolutions du serveur MCP filesystem pour support des workspaces IDE
---

# 1. Contexte

- IDE : Windsurf (fichier de config MCP : `c:/Users/Administrator/.codeium/windsurf/mcp_config.json`).
- Serveur : MCP `filesystem` (repo : `f:/Promgramation-teste/servers/filesystem`).
- Point d’entrée : `dist/index.js` compilé depuis `index.ts`.
- Problème initial :
  - Le serveur n’autorisait que quelques répertoires statiques (ex. projet-gateway, Desktop).
  - Impossible d’accéder correctement aux **sous-répertoires des workspaces ouverts dans l’IDE** (y compris ceux ajoutés virtuellement).
  - Les variables d’environnement fournies par l’IDE (`FILE_WORKSPACE`, `WORKSPACE_n`, etc.) n’étaient pas pleinement exploitées pour enrichir la whitelist.

# 2. Objectifs

- **O1 – Support natif des workspaces IDE** :
  Utiliser automatiquement les workspaces et sous-workspaces de l’IDE comme racines autorisées (relation parent → enfants).

- **O2 – Config simple et flexible** :
  Permettre de déclarer des répertoires autorisés via :
  - le fichier de config de l’IDE (`mcp_config.json`) ;
  - le fichier `.env` dans `servers/filesystem`.

- **O3 – Sécurité** :
  Conserver un modèle strict de whitelist :
  - un chemin n’est autorisé que s’il est **sous** au moins une racine déclarée dans `allowedDirectories`.

# 3. Portée

## 3.1 Inclus

- Logique interne du serveur MCP `filesystem` dans `index.ts`.
- Chargement et utilisation des variables d’environnement suivantes :
  - Dynamiques IDE : `FILE_WORKSPACE`, `WORKSPACE_1..10`.
  - Statiques : `STATIC_ALLOWED_DIR_1..10`, `STATIC_DIR_1..10`, `MCP_GATEWAY_PATH`, `MCP_FS_PATH1..10`.
- Mise en cohérence avec la config IDE `mcp_config.json`.

## 3.2 Hors scope

- Autres serveurs MCP (git, memory, projet-gateway, etc.).
- Permissions système Windows (NTFS, antivirus, etc.).

# 4. Design technique

## 4.1 Chargement de la configuration

1. **Arguments CLI**

   Le serveur est lancé par Windsurf avec, par exemple :

   ```jsonc
   "filesystem": {
     "command": "node",
     "args": [
       "F:/Promgramation-teste/servers/filesystem/dist/index.js",
       "F:/Promgramation-teste/servers/",
       "C:/Users/Administrator/Desktop/"
     ],
     ...
   }
   ```

   Ces chemins deviennent les racines initiales :

   ```ts
   const args = process.argv.slice(2);
   const initialAllowed = args.map(dir => normalizePath(path.resolve(expandHome(dir))));
   let allowedDirectories = initialAllowed;
   ```

2. **Chargement du `.env`**

   En tout début de `index.ts` :

   ```ts
   import * as dotenv from 'dotenv';
   dotenv.config();
   ```

   Le fichier `f:/Promgramation-teste/servers/filesystem/.env` est donc chargé au démarrage.

3. **Enrichissement des `allowedDirectories`**

   - On collecte des répertoires supplémentaires via :
     - `getEnvDirs()` (environnements techniques, `MCP_EXTRA_ALLOWED_DIRS`, `MCP_INCLUDE_ACTIVE_ENVS`).
     - `getDotEnvDirs()` (variables du `.env` + variables d’environnement fournies par l’IDE).
   - Tous les chemins valides (existant et de type répertoire) sont fusionnés dans `allowedDirectories` :

   ```ts
   const envDirs = getEnvDirs();
   const dotEnvDirs = getDotEnvDirs();
   const existingEnvDirs: string[] = [];
   for (const d of [...envDirs, ...dotEnvDirs]) {
     // fs.stat(d) + vérification isDirectory
     // si OK → existingEnvDirs.push(normalizePath(d))
   }
   allowedDirectories = Array.from(new Set([...allowedDirectories, ...existingEnvDirs]));
   ```

## 4.2 getDotEnvDirs() – variables supportées

Fonction clé :

```ts
function getDotEnvDirs(): string[] {
  const dirs: string[] = [];
  const pushIfValid = (p?: string) => {
    if (p && p.trim()) dirs.push(p.trim());
  };

  // 1) STATIC_ALLOWED_DIR_1..10
  for (let i = 1; i <= 10; i++) {
    const key = `STATIC_ALLOWED_DIR_${i}`;
    const value = process.env[key];
    logToFile(`DEBUG: ${key}=${value}`);
    if (value) pushIfValid(value);
  }

  // 2) STATIC_DIR_1..10 (compatibilité avec mcp_config.json)
  for (let i = 1; i <= 10; i++) {
    const key = `STATIC_DIR_${i}`;
    const value = process.env[key];
    logToFile(`DEBUG: ${key}=${value}`);
    if (value) pushIfValid(value);
  }

  // 3) Variables dynamiques IDE
  logToFile(`DEBUG: MCP_GATEWAY_PATH=${process.env.MCP_GATEWAY_PATH}`);
  pushIfValid(process.env.MCP_GATEWAY_PATH);

  logToFile(`DEBUG: FILE_WORKSPACE=${process.env.FILE_WORKSPACE}`);
  pushIfValid(process.env.FILE_WORKSPACE);

  for (let i = 1; i <= 10; i++) {
    const key = `WORKSPACE_${i}`;
    const value = process.env[key];
    logToFile(`DEBUG: ${key}=${value}`);
    pushIfValid(value);
  }

  // 4) MCP_FS_PATH1..10 (pour chemins explicites complémentaires)
  for (let i = 1; i <= 10; i++) {
    const key = `MCP_FS_PATH${i}`;
    const value = process.env[key];
    logToFile(`DEBUG: ${key}=${value}`);
    pushIfValid(value);
  }

  return dirs.map(expandHome).map(p => path.resolve(p));
}
```

Effet :

- **Workspaces IDE** (`FILE_WORKSPACE`, `WORKSPACE_n`) deviennent des racines autorisées.
- **Répertoires statiques** (`STATIC_ALLOWED_DIR_*` et `STATIC_DIR_*`) peuvent être définis dans `.env` ou `mcp_config.json`.
- **Chemins personnalisés** (`MCP_FS_PATH*`) permettent d’ajouter des dossiers spécifiques si besoin.

## 4.3 Relation parent → enfants (sécurité)

Validation centrale dans `validatePath` :

```ts
function isSubPath(baseDir: string, targetPath: string): boolean {
  const base = normalizeForCompare(baseDir);
  const target = normalizeForCompare(targetPath);
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function validatePath(requestedPath: string): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);

  const normalizedRequested = normalizePath(absolute);

  // Check if path is within allowed directories
  const isAllowed = allowedDirectories.some(dir => isSubPath(dir, normalizedRequested));
  if (!isAllowed) {
    throw new Error(`Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`);
  }

  // Gestion des symlinks et du parent pour fichiers non existants…
}
```

Conséquences :

- Si un workspace IDE vaut `D:/Workspaces/MonProjet`, alors **tous ses sous-répertoires et fichiers** sont autorisés :
  - `D:/Workspaces/MonProjet/src`
  - `D:/Workspaces/MonProjet/apps/api/src`…
- Le modèle est purement parent → enfants : aucun accès en dehors des racines whitelistées.

# 5. Configuration recommandée pour l’IDE

Fichier : `c:/Users/Administrator/.codeium/windsurf/mcp_config.json` (extrait).

```jsonc
"filesystem": {
  "command": "node",
  "args": [
    "F:/Promgramation-teste/servers/filesystem/dist/index.js",
    "F:/Promgramation-teste/servers/",      // racine de tous les serveurs
    "C:/Users/Administrator/Desktop/"
  ],
  "disabled": false,
  "disabledTools": [],
  "env": {
    "MCP_FS_PATH5": "F:/Promgramation-teste/servers/filesystem",
    "FILE_WORKSPACE": "${fileWorkspaceFolder}",
    "MCP_GATEWAY_PATH": "F:/Promgramation-teste/servers/projet-gateway/",

    "STATIC_DIR_1": "C:/Users/Administrator/",
    "STATIC_DIR_2": "C:/Users/Administrator/Desktop/",
    "STATIC_DIR_3": "F:/Promgramation-teste/servers/",

    "WORKSPACE_1": "${workspaceFolder:1}",
    "WORKSPACE_2": "${workspaceFolder:2}",
    "WORKSPACE_3": "${workspaceFolder:3}",
    "WORKSPACE_4": "${workspaceFolder:4}"
  }
}
```

# 6. Exemple de `.env` pour le serveur filesystem

Fichier : `f:/Promgramation-teste/servers/filesystem/.env` (exemple minimal).

```env
# Répertoires statiques autorisés
STATIC_ALLOWED_DIR_1=F:/Promgramation-teste/servers
STATIC_ALLOWED_DIR_2=C:/Users/Administrator/Desktop

# Compatibilité avec la config Windsurf (également lus)
STATIC_DIR_1=C:/Users/Administrator/
STATIC_DIR_2=C:/Users/Administrator/Desktop/
STATIC_DIR_3=F:/Promgramation-teste/servers/

# Chemin explicite vers le serveur filesystem lui-même
MCP_FS_PATH5=F:/Promgramation-teste/servers/filesystem

# Inclure éventuellement le répertoire courant comme contexte
MCP_INCLUDE_ACTIVE_ENVS=true
```

# 7. Impacts et vérifications

## 7.1 Impacts

- Les workspaces IDE (FILE_WORKSPACE, WORKSPACE_n) deviennent des racines autorisées → tous leurs sous-répertoires sont accessibles.
- Ajout de compatibilité `STATIC_DIR_*` pour config côté IDE.
- Ajout de `MCP_FS_PATH*` pour chemins spécifiques supplémentaires.
- Le modèle de sécurité reste basé sur une whitelist stricte.

## 7.2 Tests de validation

1. **list_allowed_directories**
   - Appeler l’outil `list_allowed_directories` du serveur filesystem.
   - Vérifier la présence de :
     - `F:/Promgramation-teste/servers/`
     - les workspaces IDE (`FILE_WORKSPACE`, `WORKSPACE_n`),
     - éventuellement `F:/Promgramation-teste/servers/filesystem`.

2. **Accès à un sous-répertoire d’un workspace IDE**
   - Depuis l’IDE, ouvrir un workspace `W`.
   - Appeler `list_directory` ou `directory_tree` sur un sous-dossier profond de `W`.
   - Attendu : pas d’erreur "Access denied - path outside allowed directories".

3. **Écriture dans un sous-répertoire**
   - Appeler `write_file` dans un sous-dossier de `W`.
   - Attendu : fichier créé avec succès.

# 8. Instructions pour les contributeurs

- Ne pas retirer `dotenv.config()` en haut de `index.ts`.
- Toute nouvelle variable d’environnement pour des chemins doit :
  - être documentée,
  - être intégrée dans `getDotEnvDirs()` (ou équivalent),
  - produire des logs DEBUG via `logToFile`.
- En cas de changement majeur dans la logique d’autorisation, mettre à jour ce PRD.
