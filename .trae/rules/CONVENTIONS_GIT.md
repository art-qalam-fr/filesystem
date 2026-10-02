# Conventions Git — Git Flow & Commits Conventionnels

## Branches (Git Flow)
- `main`: production stable; protégé.
- `develop`: intégration continue.
- `feature/*`, `release/*`, `hotfix/*`, `docs`.

## Workflow Git Flow
- `feature/*` → PR vers `develop` (tests/lint/CI).
- `release/x.y.z` depuis `develop` → merge vers `main` + tag → back‑merge vers `develop`.
- `hotfix/*` depuis `main` → merge vers `main` → back‑merge vers `develop`.

## Commits conventionnels
- Format: `type(scope): sujet`.
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Footer: `BREAKING CHANGE: ...`.

## Sécurité (Git)
- `.gitignore`: `.env`, `config.json`, `.llm-context/`, `PRD/`, `logs/`, `.trae/`.
- Interdiction de secrets en dépôt.

## PR
- Titre en Conventional Commits, CI verte, 1+ review.

## Commandes utiles
```
git checkout -b feature/x develop
git checkout -b release/1.2.0 develop
git checkout -b hotfix/y main
git tag v1.2.0 && git push origin v1.2.0
```
