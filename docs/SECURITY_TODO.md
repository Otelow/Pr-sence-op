# Dette sécurité front

Le dashboard garde encore des handlers inline historiques (`onclick`, `onchange`, `onsubmit`) dans les pages privées et certains templates JS. La CSP conserve donc temporairement `unsafe-inline`.

À faire par passes courtes :

- remplacer les handlers inline par `addEventListener` ;
- utiliser des attributs `data-action` / `data-id` pour les actions UI ;
- éviter toute interpolation de valeur utilisateur dans un attribut JS ;
- retirer `scriptSrcAttr 'unsafe-inline'` puis `scriptSrc 'unsafe-inline'` quand les handlers auront disparu ;
- garder Chart.js en local via `/vendor/chart.umd.js`.
