---
title: Downloads
description: Videola für Windows, macOS, Linux, Android und iOS — und im Browser.
---

# Downloads

Videola läuft im Browser, ohne Installation. Die Desktop-Ausgaben sind derselbe Editor in einem
eigenen Fenster: sie öffnen und speichern Dateien über die Dialoge des Betriebssystems, merken sich,
wo sie waren, und können nach einer Aktualisierung sehen.

<Downloads lang="de" />

## Was eine Ausgabe kann und was nicht

Jede Ausgabe trägt den ganzen Editor: Zeitleiste, Effekte, Mischpult, Vorlagen, Schnittstelle und
MCP-Server. Keine bringt FFmpeg mit — der Export läuft auf den Encodern der Browser-Engine, und
darum kann ein Docker-Container den Editor ausliefern, aber nicht für dich rendern.

Das macOS-Abbild ist unsigniert, solange für die Ausgabe kein Apple-Zertifikat eingerichtet war;
Gatekeeper verweigert es dann, bis man es von Hand erlaubt. Android- und iOS-Dateien gibt es nur für
Ausgaben, die mit ihren Signaturschlüsseln gebaut wurden — fehlt ein Schlüssel, wird der Schritt
übersprungen, statt etwas auszuliefern, das sich nicht installieren lässt. Die ganze Tabelle steht
in [Bauen und Ausliefern](/de/guide/building-and-releasing).
