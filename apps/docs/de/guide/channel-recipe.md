# Vom rohen Clip auf den Kanal

Ein Durchgang von vorn bis hinten: eine Vorlage, die Ihr Intro, Ihr Wasserzeichen und Ihren Abspann
um jedes Video legt, das Sie ihr geben, und ein Ziel, das das Ergebnis zu YouTube hochlädt.
Geschrieben gegen die Aufgabe, die es ersetzt — ein Upload-Skript mit festem Intro und einem
PNG-Wasserzeichen — und jeder Schritt hier ist etwas, das Sie einmal tun.

Zwei Hälften, unabhängig voneinander. Die Vorlage läuft im Browser, ohne irgendetwas dahinter. Das
Ziel braucht [einen Videola-Server](/de/guide/self-hosting): ein Upload trägt ein Geheimnis, und ein
Geheimnis im Browser ist keines.

## Die Vorlage

### 1. Das Video einmal bauen

Die Teile importieren — **Medien importieren** in der Kopfzeile, oder auf das Fenster ziehen:

- `intro.mp4`, Ihr Auftakt
- irgendein Video als Platzhalter für das Material, das jemand der Vorlage später gibt
- `outro.mp4`, Ihr Abspann
- `watermark.png`, Ihr Logo

Und auslegen:

1. Auf der Videospur: Intro, Platzhalter, Abspann, in dieser Reihenfolge. Jeder Import landet hinter
   dem letzten — in dieser Reihenfolge abgelegt, liegt es schon richtig.
2. Eine zweite Videospur anlegen und das Wasserzeichen darauf, über die anderen. Die rechte Kante
   ziehen, bis es über allem liegt.
3. Das Wasserzeichen auswählen und in den Eigenschaften platzieren: **Position X (px)**, **Position Y
   (px)**, **Breite (Faktor)**, **Höhe (Faktor)** und **Deckkraft**, wenn es zurücktreten soll. Die
   Zahlen sind Abstände von der Bildmitte, eine Ecke ist also eine positive und eine negative Zahl —
   und ein Bild, das kleiner ist als das Bildformat, braucht gar keine Skalierung. Genau deshalb
   lohnt es sich, das Logo gleich in der gewünschten Größe zu exportieren.
4. Sollen die Schnitte blenden statt springen: Platzhalter und Abspann auswählen und in den
   Eigenschaften einen **Übergang** setzen — eine Sekunde Kreuzblende ist das, was das alte Skript
   gemacht hat. Ein Übergang sitzt am Kopf des Clips, der ihn trägt.

Einmal durchspielen. Was Sie hier sehen, kommt aus der Vorlage wieder heraus, mit einem
ausgetauschten Clip.

### 2. Als Vorlage speichern

**Datei → Aus Vorlage → Projekt als Vorlage speichern**, und jetzt die eine Entscheidung, auf
die es ankommt:

- **Nur den Platzhalter** ankreuzen. Angekreuzt heißt *wird gefragt*: der Assistent fragt danach, wer
  immer die Vorlage benutzt.
- Intro, Abspann und Wasserzeichen **nicht** ankreuzen — *bleibt drin*. Das heißt: sie sind Teil der
  Vorlage, und bei einer Aufnahme heißt das mitsamt Datei. Die Vorlage wandert mit Ihrem Intro und
  Ihrem Logo darin.
- Beim Platzhalter **Länge: folgt dem Material** statt *wie in der Vorlage*.

Das Letzte ist es, was die Vorlage mit einem Video jeder Länge arbeiten lässt. Die Zeitleiste geht
mit dem Slot mit: der Abspann rückt um das, was das neue Material dazugebracht hat, und das
Wasserzeichen — das den gewachsenen Clip überspannt hat — wird mitgedehnt, damit es ihn weiter
überspannt. Nichts im Modell weiß, welcher Clip ein Wasserzeichen ist, und nichts muss es: ein Clip,
der den gewachsenen überspannt hat, ist genau der Clip, der mitwachsen muss.

Einen Namen geben und schreiben. Heraus kommt eine `.videolat`-Datei: Ihre Vorlage, Ihr Intro, Ihr
Abspann und Ihr Logo in einer Datei, die Sie auf einen anderen Rechner kopieren können.

### 3. Benutzen

**Datei → Aus Vorlage**, Ihre auswählen, **Verwenden**, die eine Frage beantworten, **Projekt
erstellen**. Heraus kommt ein ganz normales Projekt, bearbeitbar wie jedes andere; nichts daran
erinnert sich daran, dass es eine Vorlage war.

## Das Ziel

### 1. Ein Google-Projekt, das hochladen darf

Auf [console.cloud.google.com](https://console.cloud.google.com):

1. Ein Projekt anlegen oder ein vorhandenes nehmen.
2. **APIs und Dienste → Bibliothek → YouTube Data API v3 → Aktivieren**.
3. **OAuth-Zustimmungsbildschirm**: extern, Name der App, Ihre Adresse. Den Bereich
   `https://www.googleapis.com/auth/youtube.upload` hinzufügen und sich selbst als Testnutzer
   eintragen.
4. **Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID → Desktop-App**. **Client-ID** und
   **Client-Geheimnis** aufheben.

::: warning Ein Token aus einer App im Zustand „Test“ läuft nach sieben Tagen ab
Das macht Google mit Absicht. Wenn Sie fertig sind: auf dem Zustimmungsbildschirm **App
veröffentlichen** drücken. Der Warnhinweis über eine nicht verifizierte App bleibt, das Ablaufen des
Refresh-Tokens hört auf.
:::

### 2. Ein Refresh-Token

Im Server gibt es keinen Browser-Tanz: er hat keinen Ort für ein Redirect, und es wäre nur ein
zweiter Weg zu derselben Zeichenkette. Den Ablauf einmal selbst durchlaufen. Das hier als `token.mjs`
speichern und mit `node token.mjs` starten — es druckt eine Zeile:

```js
import { createServer } from "node:http";
const id = process.env.CLIENT_ID, secret = process.env.CLIENT_SECRET;
const redirect = "http://localhost:8731";
const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.search = new URLSearchParams({
  client_id: id, redirect_uri: redirect, response_type: "code",
  scope: "https://www.googleapis.com/auth/youtube.upload",
  access_type: "offline", prompt: "consent",
}).toString();
console.log("Diese Adresse öffnen und erlauben:\n" + url + "\n");
const code = await new Promise((resolve) => {
  const server = createServer((request, answer) => {
    const got = new URL(request.url, redirect).searchParams.get("code");
    answer.end("Fertig. Dieser Tab kann zu.");
    if (got) { server.close(); resolve(got); }
  }).listen(8731);
});
const answer = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: id, client_secret: secret, code,
    redirect_uri: redirect, grant_type: "authorization_code",
  }),
});
console.log("Refresh-Token:", (await answer.json()).refresh_token);
```

```bash
CLIENT_ID=… CLIENT_SECRET=… node token.mjs
```

Das Redirect `http://localhost:8731` muss beim Client in der Konsole eingetragen sein — unter
**Autorisierte Weiterleitungs-URIs** beim gerade angelegten OAuth-Client.

### 3. Videola Bescheid sagen

**Datei → Veröffentlichungsziele …**:

1. **Server**: Adresse Ihres Videola-Servers und dessen Token. Die Adresse leer lassen, wenn der
   Editor von genau diesem Server ausgeliefert wird.
2. **Neues Ziel**: Art **YouTube**, ein Name, den Sie wiedererkennen, dann **Client-ID**,
   **Client-Geheimnis** und **Refresh-Token**. **Sichtbarkeit** auf `unlisted` oder `public` setzen,
   wenn es etwas anderes sein soll als `private` — das ist ein Upload ohne Angabe.
3. **Ziel anlegen.**

Geheimnisse gehen hinein und kommen nie wieder heraus. Die Liste sagt, dass ein Ziel ein
Refresh-Token *hält*; nichts sagt, welches. Ein Token zu wechseln heißt, es neu zu schreiben, und das
ist ein Klick.

### 4. Veröffentlichen

Ganz normal exportieren und unter **Nach dem Export hochladen zu** Ihr Ziel wählen. Kodiert wird im
Browser; die fertige Datei geht an den Server, und der schickt sie mit den Zugangsdaten weiter, die
er hält. Der Titel ist der des Projekts, und ein gescheiterter Upload sagt, was die Plattform gesagt
hat.

## Was das ersetzt

Ein Skript mit einem fest eingebauten Intro, einer Wasserzeichen-Position im Code und einem Token in
einer Datei daneben. Der Unterschied ist nicht, dass es weniger Schritte sind — sondern dass der
Aufbau ein Video ist, das man ansehen und ändern kann, dass die Länge nicht einbetoniert ist, und
dass die Zugangsdaten an einer Stelle liegen, die sie nie wieder herausgibt.
