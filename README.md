# Notepad v9

Bloc-notes personnel en français, servi comme site statique et synchronisé avec Firebase Realtime Database.

## Utilisation

- L’éditeur se redimensionne avec la séparation centrale, ou ses flèches gauche/droite au clavier. « Plein écran » agrandit l’éditeur dans la page ; Échap le réduit.
- Ctrl+S (ou ⌘S) enregistre la note. Les modifications restent manuelles : un avertissement protège les changements non enregistrés avant de quitter une note. Archiver et dupliquer enregistrent d’abord le contenu en cours.
- Les cartes affichent un aperçu du texte. Les cartes, filtres, onglets et couleurs sont accessibles au clavier.
- « Mettre à la corbeille » conserve la note et son historique. « Restaurer la note » la remet dans son état précédent, actif ou archivé. La suppression définitive exige une confirmation depuis la corbeille ; aucune purge automatique n’est activée.
- « Historique » permet de consulter et restaurer les 20 dernières versions du contenu. Il se constitue à partir des nouveaux enregistrements : les anciennes versions antérieures à cette mise à jour ne sont pas disponibles.
- « Exporter les notes » télécharge un JSON incluant notes, archives, corbeille et historique. Conserver ce fichier hors du dépôt public. L’import automatique n’est pas inclus dans cette version.
- Le filtre choisi pour chaque onglet, le tri et la largeur de l’éditeur sont mémorisés sur le navigateur. Les filtres sont séparés par compte connecté.
- La recherche ignore les accents et accepte plusieurs mots. Un compteur indique les résultats affichés.
- Les dates de modification et de consultation sont distinctes. Les anciennes dates ambiguës restent affichées comme « Date historique » ; aucune date de création n’est inventée pour les notes existantes.

## Organisation

- `index.html` : structure de la page et importmap Firebase.
- `styles.css` : présentation et adaptation aux petits écrans.
- `app.js` : interface, connexion et échanges avec Firebase.
- `notes.js` : contenu des notes, historique, filtrage, tri, export.
- `preferences.js` : préférences facultatives du navigateur.
- `tests/notepad.test.js` : tests avec DOM et base fictifs, sans accès aux notes réelles.

L’application ne demande aucune compilation. Les fichiers sont servis ensemble par GitHub Pages. Après une mise à jour, recharger les onglets déjà ouverts pour utiliser la nouvelle version.

## Vérification locale

Avec Node.js 22 ou supérieur :

```sh
npm ci
npm run check
npm test
```

Les tests couvrent notamment les modifications avant archivage, les conflits entre appareils, la sélection rapide de notes, la restauration, l’export et les filtres mémorisés.

## Données et compatibilité

Les données restent sous `/notes/<id>` dans Firebase. Les nouvelles propriétés (`revision`, `history`, `deletedAt`, `createdAt`, `modifiedAt`, `lastViewedAt`) sont ajoutées progressivement, sans migration globale ni suppression des données Firebase.

Les écritures de contenu vérifient la version lue et conservent les propriétés existantes. Un conflit laisse le texte dans l’éditeur et demande de le copier avant de rouvrir la note.

Le dossier historique `notes/` contenant des exports texte a été retiré des fichiers courants et est ignoré pour éviter sa réintroduction. Il demeure dans l’historique Git. Les règles Firebase existantes n’ont pas été modifiées par cette mise à jour.
