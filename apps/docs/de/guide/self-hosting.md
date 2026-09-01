# Auf der eigenen Maschine betreiben

::: info Zusammenfassung
Ein Node-Prozess liefert den Editor, die HTTP-Schnittstelle und den MCP-Server. Es gibt vier Wege zur
Installation — Docker, eine Unraid-Vorlage, eine Umbrel-App und ein Proxmox-Skript, das einen
LXC-Container anlegt — und alle vier setzen dieselbe Handvoll Variablen. Jeder /api-Aufruf braucht einen
Token, und der Server weigert sich, ohne einen auf einer erreichbaren Adresse zu lauschen.
:::

## Was da installiert wird

`videola-server` ist ein Prozess. Er liefert den gebauten Editor als statische Dateien aus, beantwortet
`/api` für die HTTP-Schnittstelle und trägt denselben Rust-Kern als WebAssembly wie die Browser-Ausgabe
— ein über die API geöffnetes Projekt und ein im Editor geöffnetes werden also von demselben Code
geöffnet.

| Variable | Standard | Was sie ist |
|---|---|---|
| `VIDEOLA_TOKEN` | keiner | Der Bearer-Token, den jeder `/api`-Aufruf trägt. **Pflicht** auf jeder Adresse außer Loopback |
| `VIDEOLA_HOST` | `127.0.0.1` | Die Bind-Adresse. In einem Container `0.0.0.0`, damit der veröffentlichte Port sie erreicht |
| `VIDEOLA_PORT` | `7331` | |
| `VIDEOLA_STORAGE_ROOT` | das Arbeitsverzeichnis | Projekte und importierte Medien. **Das ist das Verzeichnis für die Sicherung** |
| `VIDEOLA_WEB_ROOT` | keiner | Wo der gebaute Editor liegt. Ohne ihn beantwortet der Server die API und liefert keinen Editor |
| `VIDEOLA_WASM` | keiner | Der Kern. Ohne ihn kann der Server überhaupt kein Projekt öffnen |
| `VIDEOLA_LOCALE` | `en` | `en` oder `de`: was der *Server* in erzeugte Namen schreibt. Der Editor folgt dem Browser |
| `VIDEOLA_MAX_PROJECTS` | `8` | Wie viele Projekte im Speicher offen bleiben, jedes mit eigener Kerninstanz |

**Der Token ist keine Härtungsoption.** Der Server prüft die Bind-Adresse beim Start und weigert sich,
ohne Token auf etwas anderem als Loopback zu lauschen — denn ein offenes Videola gibt jeder Maschine, die
es erreicht, Lese- und Schreibzugriff auf den Speicherort. Diese Prüfung steht in `configFromEnv`, und
der Deployment-Test in `apps/server/src/deploy.test.ts` hält jede der folgenden Dateien dagegen: eine
Vorlage, die den Token als optional anbietet, fällt im Build durch, statt ausgeliefert zu werden.

Der Speicherort muss **existieren**; der Server legt ihn nicht an. Jeder Installer unten legt ihn an, und
ein Server, der es selbst täte, schriebe stillschweigend ein Projektverzeichnis in irgendein `cwd`.

## Docker

```sh
docker run -d --name videola \
  -p 7331:7331 \
  -e VIDEOLA_TOKEN="$(openssl rand -hex 24)" \
  -v videola-data:/data \
  ghcr.io/fgilde/videola:latest
```

Das Image setzt `VIDEOLA_HOST`, `VIDEOLA_PORT`, `VIDEOLA_STORAGE_ROOT`, `VIDEOLA_WEB_ROOT` und
`VIDEOLA_WASM` selbst; den Token ist das Einzige, was es nicht erfinden kann. Es läuft als Benutzer
`node` und deklariert `/data` als Volume.

## Unraid

`templates/videola.xml` ist eine Vorlage für Community Applications, und `ca_profile.xml` im
Wurzelverzeichnis ist das, was Community Applications liest, wenn man es auf dieses Repository richtet. Nach
`/boot/config/plugins/dockerMan/templates-user/` kopiert erscheint sie unter **Add Container**, oder man
richtet CA auf dieses Repository.

Sie bietet den Port, den `/data`-Pfad (voreingestellt `/mnt/user/appdata/videola`) und den Token, der als
Pflichtfeld markiert und maskiert ist. Die zwei erweiterten Variablen sind die Sprache und die Zahl
gleichzeitig offener Projekte. Die Vorlage setzt absichtlich `:latest`: eine Unraid-Kiste aktualisiert
einen Container durch Ziehen, und eine feste Version machte **Check for Updates** zu einem dauerhaften
Nein.

## Umbrel

`fgilde-videola/` enthält `umbrel-app.yml` und `docker-compose.yml` in der Form, die der App Store
erwartet, und `umbrel-app-store.yml` daneben macht das Repository selbst zu einem Community-App-Store:
unter *App Store → ⋯ → Community app stores* `https://github.com/fgilde/videola` eintragen. Die Compose-Datei nagelt die genaue Version fest, denn ein App Store zeigt dem
Installierenden eine Versionsnummer, und `latest` machte diese Nummer zu einer Vermutung — der
Deployment-Test prüft, dass Pin, `version:` im Manifest und der Release-Tag dieselbe Zeichenkette sind.

Zwei Dinge, die man über die Compose-Datei wissen sollte:

- **`APP_HOST` ist `fgilde-videola_server_1`, nicht `localhost`.** Umbrel stellt jede App hinter ihren eigenen
  Proxy-Container, und dieser Proxy veröffentlicht den Port. Der Server bindet `0.0.0.0` *innerhalb
  seines eigenen Containers*, damit der Proxy ihn erreicht; `127.0.0.1` wäre nur aus dem eigenen
  Netzwerk-Namensraum des Servers erreichbar.
- **Die Gesundheitsprüfung geht über `/api/health` mit dem Token.** Eine Prüfung gegen den offenen Port
  sagte, dass der Prozess gestartet ist; diese sagt, dass der Kern geladen hat und der Speicherort
  antwortet. Sie trägt den Token, weil der Endpunkt hinter derselben Sperre liegt wie alles andere — ein
  unauthentifizierter Health-Endpunkt wäre ein Loch an genau einer Stelle.

## CasaOS

`store/casaos/` ist eine CasaOS-Quelle mit einer App. In CasaOS unter *App Store → Add source*:

```
https://github.com/fgilde/videola/releases/download/store/casaos-appstore.zip
```

Das Archiv baut `.github/workflows/casaos-store.yml` bei jedem Push auf `store/casaos/` neu und hängt
es an einen Release-Tag, der sich nie ändert — die URL bleibt also gültig.

Der mitgelieferte Token lautet `change-this-token` und steht in einer öffentlichen Datei: im
Installationsdialog ändern.

## Cosmos

`store/cosmos/servapps/Videola/` ist eine Cosmos-ServApp: ein Dienst, ein benanntes Volume, eine
SERVAPP-Route auf Port 7331. Das Installationsformular fragt den Token ab, bevor der Container startet
— es läuft also nichts mit einem Token aus einer öffentlichen Datei.

## Proxmox VE

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/fgilde/videola/main/deploy/proxmox/videola.sh)"
```

Auf dem PVE-Host ausführen. Es legt einen **unprivilegierten Debian-13-Container** ohne Nesting an — der
Server ist ein Node-Prozess und braucht weder root im Namensraum des Hosts noch eine Container-Laufzeit
in sich selbst —, installiert Node aus Debians eigenem Archiv, holt das Serverpaket aus dem letzten
Release, erzeugt einen Token, schreibt eine systemd-Unit und wartet auf eine Antwort von `/api/health`,
bevor es URL und Token ausgibt.

`CTID`, `DISK_GB`, `CORES`, `RAM_MB`, `BRIDGE`, `STORAGE` und `PORT` sind Umgebungsvariablen mit
vernünftigen Standardwerten; ohne `CTID` nimmt es die nächste freie.

**Bewusst in sich geschlossen.** Die Community-Helper-Skripte laden zur Laufzeit eine gemeinsame
`build.func` aus einem anderen Repository. Das ist bequem und bedeutet, dass das Skript kaputtgeht,
sobald diese Datei umzieht. Dieses hier braucht `pct`, und das hat jeder PVE-Host.

`deploy/proxmox/install.sh` ist die Hälfte, die *im* Container läuft — und sie läuft auch allein: auf
einer schlichten Debian-VM, auf einem Raspberry Pi, in einem selbst angelegten Container:

```sh
curl -fsSL https://raw.githubusercontent.com/fgilde/videola/main/deploy/proxmox/install.sh | bash
```

Sie ist idempotent: noch einmal ausgeführt holt sie das aktuelle Release, behält Token und Speicherort,
die sie schon geschrieben hat, und startet den Dienst neu. Den Token bei jedem Lauf neu zu erzeugen
sperrte jeden Client aus, der ihn gespeichert hat.

### Was die Unit verbietet

Die Service-Datei ist der Teil einer Paketinstallation, der das Skript überlebt — was sie *nicht* darf,
zählt also mehr als was sie startet:

```ini
User=videola
ProtectSystem=strict
ProtectHome=yes
PrivateDevices=yes
NoNewPrivileges=yes
RestrictNamespaces=yes
ReadWritePaths=/var/lib/videola
```

Ein beschreibbarer Pfad und nichts anderes, was die Maschine anbietet. Ein Videoeditor hat mit einem
Gerät, einem Kernelmodul oder dem Heimatverzeichnis eines anderen nichts zu schaffen.

## Veröffentlichungsziele

Der letzte Schritt eines fertigen Videos ist selten „eine Datei im Download-Ordner". Ein Ziel ist ein
Ort, an den es geht — ein YouTube-Kanal, ein Vimeo-Konto oder irgendeine Adresse, die eine Datei
annimmt — einmal eingerichtet und danach benutzt.

| Art | Was sie braucht | Was sie tut |
|---|---|---|
| `youtube` | `clientId`, `clientSecret`, `refreshToken` | ein fortsetzbarer Upload über die Data API |
| `vimeo` | `accessToken` | ein tus-Upload ins Konto |
| `webhook` | `url` | schickt die Datei als Formular, mit Kopfzeilen Ihrer Wahl |

```bash
curl -X POST localhost:7331/api/destinations \
  -H "authorization: Bearer $VIDEOLA_TOKEN" -H "content-type: application/json" \
  -d '{"kind":"youtube","name":"Mein Kanal",
       "secrets":{"clientId":"…","clientSecret":"…","refreshToken":"…"},
       "settings":{"privacyStatus":"unlisted"}}'

curl -X POST "localhost:7331/api/destinations/dst_…/publish?title=Sommer" \
  -H "authorization: Bearer $VIDEOLA_TOKEN" -H "content-type: video/mp4" \
  --data-binary @sommer.mp4
```

**Geheimnisse gehen hinein und kommen nie zurück.** `GET /api/destinations` sagt, dass ein Ziel einen
Refresh-Token hält; nichts sagt, welcher es ist. Ein Token, den man auslesen kann, ist ein Token, der
über eine Bildschirmfreigabe, ein Protokoll oder einen Browserverlauf abhandenkommt. Ihn zu wechseln
heißt, ihn neu zu schreiben — ein Klick, und die Alternative wäre eine ganze Klasse von Unfällen.

**Privat, solange Sie nichts anderes sagen.** Ein YouTube-Upload ist `private`, ein Vimeo-Upload für
niemanden sichtbar, bis die Einstellungen des Ziels ein anderes Wort enthalten. Ein Versehen, das einen
Rohschnitt der Welt zeigt, nimmt kein Rückgängig zurück.

**Woher die Token kommen.** Hier gibt es keinen Browser-Tanz: dieser Server hat keinen Ort für eine
Rückleitung, und es wäre ein zweiter Weg zu derselben Zeichenkette. Führen Sie Googles eigenen Ablauf
für installierte Anwendungen einmal aus — `oauth2l`, ein fünfzeiliges Skript oder der Ablauf aus einer
ihrer Kurzanleitungen — und fügen Sie die drei Werte ein. Vimeo stellt auf der Kontoseite einen
persönlichen Token mit Upload-Recht aus, das ist ein Feld.

**Warum der Server und nicht der Browser.** Der Upload braucht ein Client-Geheimnis, und ein Geheimnis
im Browser ist keines. Der Encoder bleibt, wo das Material ist: der Editor exportiert im Tab, schickt
die Bytes hierher, und diese Seite spricht mit der Plattform.

**Was noch fehlt.** Ein abgebrochener Upload beginnt von vorn, statt fortzusetzen: dafür müsste die
Sitzungsadresse die Anfrage überleben, und das ist eine Warteschlange und ein anderes Feature. Es gibt
keinen Zeitplan, kein Vorschaubild und keine Playlist. Eine Art hinzuzufügen ist eine Funktion in
`publish.ts` und eine Zeile in der Tabelle dessen, was sie braucht.

## Das Serverpaket

`videola-server-<version>.tar.gz` hängt an jedem Release: die drei Einsprungpunkte, das WASM, in dem der
Kern lebt, der gebaute Editor und eine README. Es braucht **Node 22 und nichts weiter** — esbuild hat
jede Abhängigkeit schon in die Einsprungpunkte gebündelt, es gibt also kein `node_modules` zu
installieren und zur Laufzeit nichts aufzulösen.

Gebaut wird es mit `node deploy/bundle.mjs`, demselben Befehl, den der Release-Workflow fährt. Ein
Rezept, das nur in einem Workflow existiert, ist das Rezept, das an dem Tag kaputtgeht, an dem man es
braucht.

## Was zu sichern ist

Der Speicherort. Alles andere — Paket, Image, Container — ist in einer Minute wieder installiert; die
Projekte und die importierten Medien sind es nicht. Eine `.videola`-Datei ist ein ZIP mit den Medien
darin, eine Kopie dieses Verzeichnisses ist also eine Kopie der Arbeit, an der nichts zu rekonstruieren
ist.
