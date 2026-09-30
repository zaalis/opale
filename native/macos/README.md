# Opale pour macOS

Cette cible utilise une fenêtre `WKWebView`, le même serveur Node et la même interface que les deux autres systèmes. Les données de l’application sont stockées dans `~/Library/Application Support/Opale` avec des permissions privées.

Sur un Mac avec Xcode et Node.js :

```bash
npm ci
npm run build:macos
npm run build:macos -- --dmg
```

La compilation doit être effectuée sur macOS : elle produit `dist/macos/Opale.app` et, avec `--dmg`, une image disque. Une signature/notarisation Apple n’est pas réalisée par ce script.
