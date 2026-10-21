// Applique le thème choisi avant l'affichage de la page (évite un éclair de clair). Clair par défaut.
(function () {
  try { if (localStorage.getItem("pqc-theme") === "dark") document.documentElement.dataset.theme = "dark"; } catch (e) { /* stockage indisponible : thème clair */ }
})();
