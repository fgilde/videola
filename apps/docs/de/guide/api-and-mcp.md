# Die API und der MCP-Server

::: info Zusammenfassung
Das vollständige Kapitel gibt es nur auf Englisch: [The API and the MCP
server](/guide/api-and-mcp). Dort stehen alle Routen, alle Werkzeuge, die Beispielabläufe und die
Fallstricke im Detail. Diese Seite fasst es zusammen.
:::

Videola bietet eine HTTP-Schnittstelle und einen MCP-Server für KI-Agenten. Beide schicken dieselben
Commands, die auch die Timeline der Oberfläche schickt, durch denselben Rust-Kern. Das ist der ganze
Entwurf: eine Schnittstelle auf dem Command-Katalog kann per Konstruktion nichts, was die Oberfläche
nicht kann, und nichts weniger.

Beides liegt in `apps/server`. Routen und Werkzeuge sind dünne Hüllen um eine Klasse, `Api` in
`apps/server/src/api.ts` — das Einzige im Paket, das ein Dokument hält. Keiner der beiden Transporte
erreicht den Kern selbst, also kann keiner etwas anbieten, was dem anderen fehlt, und keiner eine
Prüfung überspringen.

## Der Kern läuft als WebAssembly, nicht als nativer Build

Der Server lädt dasselbe `.wasm`-Artefakt, das auch der Browser lädt. Der Grund ist die
Vertrauensgrenze: `format/reader.rs` bemisst seine Obergrenzen gegen das 32-Bit-`usize` von wasm32
und den Speicher eines Browser-Tabs. Ein nativer Build würde dieselben Zahlen auf einem anderen
Adressraummodell auslegen. Dasselbe Artefakt zu fahren macht „der Server prüft, was der Browser
prüft“ zu einer Eigenschaft des Builds statt zu einer Behauptung über zwei Builds. Es gibt auch noch
nichts Natives, das einen zweiten Übersetzungspfad rechtfertigt: `videola-render` und
`videola-compositor` existieren nicht, also ist da kein FFmpeg und kein `wgpu` zu linken.

Der Preis, offen gesagt: ein Node-Prozess, eine Serialisierung an der WASM-Grenze und die Decke von
2 GiB Medien pro Prozess, die der WASM-Speicher setzt. Sobald die Render-Kisten da sind, kippt das
Argument — ein Server, der FFmpeg fahren muss, gehört nach Rust, und `Api` ist die Naht, an der man
dort ansetzt.

## Medien ohne OPFS

Im Browser landen importierte Dateien in OPFS, adressiert über den SHA-256 ihrer eigenen Bytes. Ein
Server hat kein OPFS; hier hält der Kern die Bytes in seinem WASM-Speicher — daher die Decke. Für die
Schnittstelle heißt das: **Import** nimmt einen Pfad im Storage-Root oder einen rohen HTTP-Body,
niemals base64. **Export** heißt eine `.videola`-Datei schreiben; einen Video-Encoder gibt es auf dem
Server nicht. Medien-Ids sind Inhaltshashes, ein zweiter Import derselben Datei kostet also nichts.

## Was es nicht gibt

| Fehlt | Warum |
|---|---|
| `get_frame` | Braucht einen Compositor. Der des Browsers ist WebGL2 in `@videola/engine`, den in Rust gibt es nicht. Ein Agent kann sein Ergebnis hier nicht **sehen**. |
| `render`, Export als Video | Dazu noch ein Encoder. `.videola` ist die einzige Ausgabe. |
| `get_audio_peaks` | Braucht einen Decoder außerhalb des Browsers. |
| Templates | Das Format ist M5. |
| WebSocket `/api/events`, MCP über SSE | Es gibt noch nichts zu schieben: die Command-Antwort trägt den Patch schon, und einen Render-Fortschritt gibt es nicht. MCP läuft nur über stdio. |

## Betrieb

```sh
pnpm wasm
pnpm --filter videola-server build
node apps/server/dist/serve.mjs   # HTTP
node apps/server/dist/mcp.mjs     # MCP über stdio
```

Eingestellt wird ausschließlich über die Umgebung: `VIDEOLA_HOST` (Vorgabe `127.0.0.1`),
`VIDEOLA_PORT` (`7331`), `VIDEOLA_TOKEN`, `VIDEOLA_STORAGE_ROOT`, `VIDEOLA_MAX_PROJECTS` (`8`),
`VIDEOLA_MAX_BODY_BYTES` (512 MiB), `VIDEOLA_LOCALE`, `VIDEOLA_WASM`, `VIDEOLA_WEB_ROOT`.

Eine Adresse außerhalb von Loopback **ohne** Token wird nicht gebunden, sondern mit einer Begründung
abgelehnt. Ist ein Token gesetzt, braucht jede Anfrage `Authorization: Bearer …`; verglichen wird in
konstanter Zeit.

`VIDEOLA_WEB_ROOT` zeigt auf ein Verzeichnis mit der gebauten Web-App, die dann neben der
Schnittstelle mit ausgeliefert wird — so macht es das Docker-Image. Ohne die Variable antwortet jeder
Pfad außerhalb von `/api` mit 404. Ausgeliefert wird sie **ohne** Token: der Editor hält seine
Projekte im Browser des Besuchers, und die Speicherwurzel bleibt hinter `/api`.

Der MCP-Server liest nur `VIDEOLA_STORAGE_ROOT`, `VIDEOLA_MAX_PROJECTS` und `VIDEOLA_LOCALE`. Er hört
auf nichts, also darf ihn eine Bindeadresse für den HTTP-Server nicht am Start hindern — genau das
täte sonst ein Container, der `VIDEOLA_HOST` für seine Schnittstelle setzt.

Dieselben Bündel bringen eine CLI mit (`dist/cli.mjs`), die eine Command-Folge aus einer Datei auf ein
Projekt anwendet und es speichert; siehe [Bauen und Ausliefern](./building-and-releasing.md).

## Die Vertrauensgrenze

Jeder Skalar aus HTTP oder von einem Agenten ist unvertraut, und jede `.videola`-Datei ist es auch.
Diese Prüfungen liegen **nicht** in `apps/server`, sondern in `Project::normalize` und in den
Command-Handlern — dort, wo auch die Dispatches der Oberfläche geprüft werden. Eine zweite Prüfung
hier wäre eine zweite Regel, die man mit der ersten synchron halten müsste.

Was die Server-Schicht selbst trägt:

* **Pfade.** Ein Pfad aus einer Anfrage wird gegen den Storage-Root aufgelöst und dann gegen den
  *echten* Pfad geprüft, weil ein Symlink im Root immer noch hinausführen kann. Absolute Pfade werden
  abgelehnt. Die Eindämmung steht fest, bevor irgendein Verzeichnis angelegt wird — eine abgelehnte
  Anfrage hinterlässt außerhalb des Roots nichts.
* **Token und Body-Größe.** Die Größe wird beim Eintreffen der Blöcke gezählt, nicht aus
  `Content-Length` übernommen.
* **Atomare Batches.** `POST /api/projects/:id/commands` wendet seine Commands unter einem
  Coalesce-Schlüssel an, wird also ein einziger Historieneintrag. Wird ein Command abgelehnt, nimmt
  `Document::rollback` das Gelandete zurück — und lässt, anders als `undo`, nichts auf dem
  Redo-Stapel liegen, das ein späteres `redo` zur Hälfte wieder anwenden könnte.
* **Revisionen.** Jede Ansicht trägt eine `revision`; ein Batch darf `ifRevision` mitschicken, eine
  Abweichung wird mit `409` beantwortet und ändert nichts. Das Dokument wird nur synchron angefasst,
  zwei Anfragen können sich also nicht in einem Batch verschränken. Schreibvorgänge auf denselben
  Pfad werden gereiht und laufen über eine Zwischendatei mit anschließendem Umbenennen, damit ein
  Absturz mitten im Schreiben kein bestehendes Archiv abschneidet.

## Werkzeuge und Routen

Sechsundzwanzig MCP-Werkzeuge kommen unmittelbar aus dem erzeugten Katalog — eines je Command, mit
Unterstrich statt Punkt (`clip.split` wird `clip_split`). Jedes nimmt die Felder des Commands plus
`project`, optional `ifRevision`; das `type`-Feld ist keine Eingabe, weil der Werkzeugname es schon
festlegt. Ein neuer Command im Rust-Enum wird zu einem Werkzeug, ohne dass jemand den Server
anfasst.

Dazu dreizehn eigene: `project_create`, `project_open`, `project_list`, `project_get`,
`project_describe`, `project_validate`, `project_save`, `project_close`, `media_importFile`,
`history_undo`, `history_redo`, `effects_list`.

Über HTTP entsprechen dem `GET /api/health`, `GET /api/schema`, `GET|POST /api/projects`,
`GET|DELETE /api/projects/:id`, `POST /api/projects/:id/commands`, `…/undo`, `…/redo`, `…/describe`,
`…/validate`, `POST …/media`, `GET|PUT …/file`.

`project_describe` ist wichtiger, als seine Größe vermuten lässt: ohne Einzelbild-Renderer ist es der
einzige Weg, auf dem ein Agent prüfen kann, was er wirklich gebaut hat. Nach jeder Änderung lesen,
nicht annehmen.

## Fallstricke

Zeiten sind **Flicks**: 705 600 000 Flicks sind eine Sekunde, ein Bild bei 30 fps 23 520 000.

* `clip.trim` nimmt ein Delta, nie eine absolute Kante — jeweils aus der *tatsächlichen* Kante
  rechnen, ein abgelehnter Schritt darf nicht in den nächsten übernommen werden.
* `clip.split` braucht einen Punkt echt innerhalb des Clips.
* `effect.add` für einen Effekt, den der Clip schon trägt, ist stillschweigend wirkungslos — ebenso
  `media.import` für eine Id, die schon in der Bibliothek steht. Beide antworten mit einem leeren
  Patch, daran erkennt man es.
* `media.remove` löscht jeden Clip, der das Medium benutzt, auch in verschachtelten Timelines.
* `sizeBytes` eines `MediaAsset` ist auf der Leitung eine gewöhnliche JSON-Zahl, was der erzeugte
  TypeScript-Typ zum Rust-`u64` auch sagt.
* `volume` und `pan` werden geklemmt (0…4 bzw. −1…1), `speed.rate` außerhalb von (0, 100] wird
  abgelehnt.
