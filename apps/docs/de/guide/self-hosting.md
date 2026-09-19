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
| `VIDEOLA_YOUTUBE_CLIENT_ID` | keiner | Der OAuth-Client, über den die Anmeldung an einem Kanal läuft. Zusammen mit dem Geheimnis darunter, sonst gar nicht |
| `VIDEOLA_YOUTUBE_CLIENT_SECRET` | keiner | Die zweite Hälfte davon. Ohne beide gibt es keine Anmeldung, nur die Felder im Dialog |

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

## Material aus einem Link

Ein Link ist keine Datei, und eine Seite darf das Video einer fremden Herkunft nicht lesen. Also
macht es der Server, mit [yt-dlp](https://github.com/yt-dlp/yt-dlp). **Medien importieren** öffnet
einen Dialog mit beiden Wegen: Dateien von diesem Rechner auf der einen Seite, ein Link oder eine
Suche auf der anderen — Art, Codec, Format und Qualität so, wie MeTube danach fragt, und ein
Fortschrittsbalken, während es läuft. Was zurückkommt, wird importiert wie eine Datei, die jemand auf
das Fenster gezogen hat.

Dafür muss nichts zusätzlich installiert werden außer dem Server selbst. Das Image bringt `yt-dlp`
und `ffmpeg` mit, ein mit der Zeile oben gestarteter Container kann also sofort laden. Der Editor
findet den Server, von dem er ausgeliefert wurde, von allein; ein Editor, der auf videola.app
geöffnet wurde, bekommt seinen unter **Veröffentlichungsziele** genannt.

Das Image bringt `yt-dlp` und `ffmpeg` mit. Überall sonst: beides installieren, der Server findet es
über `PATH`; `VIDEOLA_YTDLP` zeigt auf ein anderes Binary. Ohne die beiden funktioniert alles andere
im Editor, und der Dialog sagt, dass dieser Server nicht laden kann — statt mitten im Download zu
scheitern.

```bash
curl "localhost:7331/api/fetch/ready" -H "authorization: Bearer $VIDEOLA_TOKEN"
curl "localhost:7331/api/fetch/search?q=chopin" -H "authorization: Bearer $VIDEOLA_TOKEN"
curl -X POST "localhost:7331/api/fetch?url=https://…&kind=video&format=mp4&quality=1080" \
  -H "authorization: Bearer $VIDEOLA_TOKEN" -o clip.mp4
```

**Nur dorthin, wo er hindarf.** Ein Server, der alles lädt, was man ihm hinhält, ist ein Weg in das
Netz, in dem er steht. Deshalb wird zuerst geprüft, auf welche Adresse ein Link wirklich zeigt, und
eine private, Loopback- oder Link-Local-Adresse wird abgelehnt — die Adresse eingeschlossen, unter
der eine Cloud-Instanz ihre Zugangsdaten hält.

**Nur Material, an dem Sie die Rechte haben.** Keine Software kann Ihren eigenen Vortrag vom Film
eines anderen unterscheiden, und diese versucht es nicht. Es ist ein Downloader auf einer Maschine,
die Sie betreiben.

## Veröffentlichungsziele

Der letzte Schritt eines fertigen Videos ist selten „eine Datei im Download-Ordner". Ein Ziel ist ein
Ort, an den es geht — ein YouTube-Kanal, ein Vimeo-Konto oder irgendeine Adresse, die eine Datei
annimmt — einmal eingerichtet und danach benutzt.

| Art | Was sie braucht | Was sie tut |
|---|---|---|
| `youtube` | `clientId`, `clientSecret`, `refreshToken` | ein fortsetzbarer Upload über die Data API |
| `vimeo` | `accessToken` | ein tus-Upload ins Konto |
| `peertube` | `accessToken`, dazu `instance` und `channelId` | lädt auf eine beliebige PeerTube-Instanz |
| `mastodon` | `accessToken`, dazu `instance` | hängt das Video an einen Beitrag |
| `bluesky` | `appPassword`, dazu `handle` | postet über den Videodienst des AT-Protokolls |
| `telegram` | `botToken`, dazu `chatId` | schickt es als Video in einen Chat oder Kanal |
| `facebook` | `pageToken`, dazu `pageId` | lädt es auf eine Seite, standardmäßig unveröffentlicht |
| `webhook` | `url` | schickt die Datei als Formular, mit Kopfzeilen Ihrer Wahl |

Was bewusst **nicht** dabei ist: Instagram und TikTok. Instagrams Veröffentlichungs-API bekommt eine
URL und holt sich das Video selbst — ein Server, den von außen niemand erreicht, kann das nicht
bedienen. TikTok verlangt eine geprüfte Entwickleranwendung, bevor überhaupt etwas anderes als ein
Entwurfsordner erreichbar ist. Beides wäre ein Knopf, der bei fast jedem, der ihn drückt, fehlschlägt.

Die kürzeste Einrichtung auf der Liste ist **Bluesky**: ein App-Passwort aus den eigenen
Kontoeinstellungen, kein Entwicklerkonto, keine Freigabe. Danach kommt **PeerTube** — freie Software
auf einer Maschine, die jemandem gehört, ohne Kontingent und ohne Firma dazwischen.

Im Dialog stehen die eingerichteten Ziele als Liste, jedes unter seinem eigenen Zeichen; **Neues
Ziel** und **Bearbeiten** öffnen dasselbe Formular. Ein Geheimnis wird dabei nie zurückgelesen: Beim
Bearbeiten bleiben die Felder leer, und ein leeres Feld heißt „so lassen“.

### Mit dem Konto anmelden statt Token abtippen

Die drei YouTube-Werte stammen aus zwei verschiedenen Seiten der Google-Konsole, und der dritte wird
überhaupt nur von einem Werkzeug ausgegeben, das kaum jemand installiert hat. Deshalb kann der Server
die Anmeldung selbst führen: Im Dialog **Veröffentlichungsziele** steht dann *Mit YouTube anmelden*,
der Browser geht zu Google, und was zurückkommt, ist genau der Refresh-Token, den der Publisher
ohnehin benutzt — samt dem Kanalnamen, nach dem das Ziel dann heißt.

Dafür braucht der Server einmalig einen eigenen OAuth-Client:

```bash
VIDEOLA_YOUTUBE_CLIENT_ID=…apps.googleusercontent.com
VIDEOLA_YOUTUBE_CLIENT_SECRET=…
```

Als Redirect-URI wird in der Google-Konsole genau die Adresse eingetragen, unter der der Editor
geöffnet wird, plus `/api/destinations/oauth/youtube/callback` — also etwa
`http://localhost:7331/api/destinations/oauth/youtube/callback`.

Ein Client wird **nicht mitgeliefert**: Ein OAuth-Geheimnis in einem offenen Repository ist ein
veröffentlichtes Geheimnis, und das daran hängende Kontingent wäre ein einziger Topf für jede
Installation der Welt. Ohne hinterlegten Client sagt der Dialog genau das und lässt die Felder
stehen; mit hinterlegtem Client ist jedes weitere Ziel ein Knopf.

Der Rückweg von Google trägt keinen Bearer-Token — er ist eine Weiterleitung und kein Aufruf des
Editors. An dessen Stelle steht ein `state`: von der geschützten Hälfte des Ablaufs erzeugt, einmal
gültig, zehn Minuten lang, nur im Speicher. Ein Rückruf mit unbekanntem `state` wird abgewiesen.

#### Woher der Client kommt

Einmal pro Server, in Googles Konsole:

1. [console.cloud.google.com](https://console.cloud.google.com/) öffnen und ein Projekt anlegen —
   der Name ist gleichgültig, er taucht nur in der Konsole auf.
2. **APIs & Dienste → Bibliothek**, dort die **YouTube Data API v3** aktivieren.
3. **OAuth-Zustimmungsbildschirm**: Nutzertyp *Extern*, App-Name und Kontakt-E-Mail eintragen. Als
   Bereiche `.../auth/youtube.upload` und `.../auth/youtube.readonly` hinzufügen — der zweite ist
   der, mit dem Videola das Ziel nach dem Kanal benennt. Sich selbst als **Testnutzer** eintragen.
4. **Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**, Anwendungstyp **Webanwendung**. Als
   autorisierte Weiterleitungs-URI genau die Adresse eintragen, unter der der Editor läuft, plus
   `/api/destinations/oauth/youtube/callback`.
5. Client-ID und Client-Schlüssel in die beiden Umgebungsvariablen oben — oder direkt in die Felder
   im Dialog, falls der Server keine bekommt.

Zwei Dinge, die Google nicht dazusagt. Solange die App im Status *Test* steht, **verfallen
Refresh-Token nach sieben Tagen**; wer das nicht will, stellt sie auf *In Produktion* und klickt sich
durch die Warnung für nicht verifizierte Apps. Und das Kontingent eines Projekts sind 10.000 Punkte
am Tag, ein Upload kostet 1.600 — also rund sechs Videos täglich, pro Projekt. Genau deshalb liefert
Videola keinen eigenen Client mit: Der wäre ein Topf für alle zusammen.

Wer das nicht will, hat auf dieser Liste zwei Ziele, die gar keine Konsole kennen: **Bluesky**
braucht ein App-Passwort aus den eigenen Kontoeinstellungen, **PeerTube** ein Token aus der eigenen
Instanz.

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
