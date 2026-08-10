# Commands und Undo

::: info Zusammenfassung
Das vollständige Kapitel gibt es nur auf Englisch: [Commands and
undo](/guide/commands-and-undo). Dort stehen alle achtunddreißig Commands mit ihren Feldern, das
Drahtformat und der Ablauf im Detail. Diese Seite fasst es zusammen.
:::

Jede Bearbeitung ist ein serialisierbarer Command. Es gibt keinen Pfad, der das Projekt direkt
verändert — daraus fallen Undo, die HTTP-API und der MCP-Server aus einem Mechanismus statt aus drei.
Die beiden nach außen gerichteten stehen in [Die API und der MCP-Server](/de/guide/api-and-mcp).

## Die achtunddreißig Commands

| Gruppe | Commands |
|---|---|
| `project.*` | `setSettings`, `setTitle`, `setMasterVolume` |
| `track.*` | `add`, `remove`, `reorder`, `rename`, `setVolume`, `setPan`, `setSurround`, `setFlags` |
| `clip.*` | `add`, `remove`, `move`, `trim`, `split`, `rippleDelete`, `rippleTrim`, `roll`, `slip`, `slide`, `paste`, `group`, `ungroup`, `nest`, `setSpeed`, `setVolume`, `setMotionBlur`, `setEnabled`, `setTransform`, `setGenerator`, `setTransition` |
| `effect.*` | `add`, `remove`, `setEnabled`, `setParam` |
| `keyframe.*` | `add`, `remove`, `move`, `setInterp`, `setHandles` |
| `marker.*` | `add`, `remove`, `rename` |
| `media.*` | `import`, `remove` |

`effect.remove` nimmt den Effekt mit seinen Parametern und Keyframes heraus; `effect.setEnabled` ist
Überbrücken und lässt all das stehen. Bis beide da waren, ließ sich ein Effekt hinzufügen und nie mehr
entfernen, und `Effect.enabled` stand im Modell, ohne dass irgendetwas es setzen konnte — Renderer und
Tongraph haben die Marke seit dem ersten Schema beachtet.

`track.setFlags` nimmt jede Marke als nullbaren Wert, damit ein Command eine beliebige Teilmenge
ändern kann; `null` heißt „unverändert lassen“. Rückwärtslauf ist `clip.setSpeed` mit
`reverse: true`, kein eigener Clip-Typ. `media.remove` entfernt auch jeden Clip, der das Asset
benutzt, und steigt dafür in verschachtelte Compound-Timelines ab.

## Ripple, Roll, Slip und Slide

Die fünf Kommandos neben `clip.trim` fassen mehr an als den Clip, den sie nennen.
`clip.rippleDelete` entfernt einen Clip und zieht alles, was an seinem Ende oder danach beginnt, um
seine Länge zurück — ein Clip, der über dieses Ende hinwegreicht, bleibt liegen, sonst tauschte
das Schließen einer Lücke sie gegen eine Überlappung. `clip.rippleTrim` tut dasselbe für eine
Trimmung; am *Kopf* bleibt der Start des Clips liegen, weil ein Ripple dort das Material bewegt.
`clip.roll` verschiebt den Schnitt, den eine Kante mit dem anliegenden Clip teilt, und lehnt ab, wo
keiner anliegt. `clip.slip` verschiebt das Material hinter einem liegenbleibenden Clip,
`clip.slide` verschiebt den Clip und lässt die anliegenden Clips den Schritt aufnehmen. Alle
lehnen ab, bevor irgendetwas geschrieben ist — eine halbe Slide ist keine Bearbeitung.

`clip.paste` nimmt einen ganzen `Clip` entgegen und macht Kopieren, Duplizieren und Einfügen zu
einer Sache. Der Kern vergibt frische Ids, auch für die Clips in einem geschachtelten Timeline,
löst die mitgebrachte Gruppenzugehörigkeit und prüft die Nutzlast an derselben Schranke wie ein
geladenes Projekt. `clip.group` bindet mindestens zwei Clips zusammen, `clip.ungroup` löst die
Gruppe über alle Spuren hinweg.

Marker liegen nach Zeit sortiert, in welcher Reihenfolge sie auch gesetzt wurden.

## Transformation und Übergang

`clip.setTransform` trägt die ganze `Transform` — Position, Skalierung, Drehung, Ankerpunkt,
Deckkraft und Crop — so wie `clip.setSpeed` alle drei Geschwindigkeitsfelder trägt. Die Oberfläche
liest die aktuelle Transformation, ersetzt das eine geänderte Feld und schickt sie zurück. Das ist
auch der einzige Weg, einen Clip auf das Bild einzupassen: die Zeichenliste bildet ein Quellpixel auf
ein Projektpixel ab, ein 640x360-Clip sitzt in einem 1080p-Projekt also in seiner eigenen Größe
mittendrin, bis eine Transformation etwas anderes sagt.

`clip.setTransition` schreibt die *eingehende* Kante eines Clips, `null` löscht sie. Für die
ausgehende Kante gibt es keinen Command, weil sie niemand liest: ein Übergang wird gezeichnet, indem
der eingehende Clip in das Bild gemischt wird, das der Frame schon trägt — er gehört also dem Clip,
der ankommt. Eine gelöschte Überblendung ist im Modell *abwesend*, nicht `null`.

## Wo ein Effekt wohnt

`effect.add` und `effect.setParam` nennen mit `target` die Kette, nicht den Clip:
`{ kind: "clip", clip }`, `{ kind: "track", track }` oder `{ kind: "project" }`. Eine Weichzeichnung
auf einem Clip, ein Equalizer auf einer Spur und ein Limiter in der Mastering-Kette sind dieselben
zwei Commands, anders gerichtet. Alle drei Plätze stehen seit dem ersten Schema im Modell —
`Clip.effects`, `Track.effects`, `MasterSettings.effects` — und bis es die Adresse gab, war nur der
erste erreichbar.

`project.setMasterVolume` bewegt den einen Regler, durch den die ganze Mischung läuft. Er wird auf
dieselben `0 .. 4` geklemmt wie der Regler einer Spur.

## Keyframes

Ein Keyframe adressiert dieselbe Kette wie `effect.setParam` — ein Tripel aus `target`, `effectType`
und `key`. Ein Parameter mit Keyframe-Spur wird aus der Spur gelesen, einer ohne aus dem statischen
Wert. Der statische Wert bleibt darunter erhalten, also nimmt das Löschen des letzten Keyframes den
Parameter wieder von der Uhr, statt ihn einzufrieren.

`keyframe.add` ist ein *Upsert*: dieselbe Zeit noch einmal ersetzt den dortigen Keyframe, statt einen
zweiten daneben zu legen. Genau das macht einen Schieberzug im Inspector zur selben Form wie einen
Clipzug — eine Sendung pro Zeigerbewegung, alle unter einem Coalesce-Key, ein Undo-Schritt.

`interp` ist `linear`, `hold`, `ease` oder `bezier`. `keyframe.move` weigert sich, auf einer schon
besetzten Zeit zu landen, nimmt aber einen Zug hin, der dort endet, wo er anfing.

`keyframe.setHandles` ist das, was ein Kurveneditor zieht: `handleOut` formt den Weg vom Schlüssel
fort, `handleIn` den ankommenden, beide als Punkt im Einheitsquadrat des Abschnitts — dasselbe Paar,
das CSS `cubic-bezier` nimmt —, und `null` setzt einen auf die Voreinstellung zurück, auf der ein
Bezier-Schlüssel öffnet. Beide gehen bei jeder Schreibung mit, weil ein Paar je Schlüssel die Form
ist, die das Modell trägt; nur den einen unter der Hand zu senden würde den anderen löschen. Gelesen
werden die Anfasser nur, solange der Nachbarschlüssel auf `bezier` steht.

`Project::normalize` prüft beide Anfasser auf Endlichkeit, und `keyframe.setHandles` läuft durch
dieselbe Funktion: ein NaN dort erreicht `cubic_bezier_y_at`, kommt aus dem interpolierten Wert
wieder heraus und landet in JavaScript als `null`. `keyframe.add` fasst das Paar nie an — sein
Upsert würde eine Kurve sonst bei jeder Zeigerbewegung eines Schieberzuges flach ziehen.

Eine **Ratenspur** nimmt Anfasser, aber nie den Verlauf, der sie liest: `keyframe::integrate` hat
unter einer Bezier keine exakte Fläche, und mit ihr fiele die Additivität, auf der `consumed_source`
steht. `keyframe.setInterp` lehnt `bezier` auf der `speed`-Spur ab, und der Ladepfad ebenso.

### Eine Transformation keyframen

Lässt man `effectType` weg — sendet also `null` —, adressiert der Keyframe statt eines Effekts die
Transformation des Clips selbst. Die Schlüssel sind ihre eigenen Feldnamen: `x`, `y`, `scaleX`,
`scaleY`, `rotation`, `anchorX`, `anchorY`, `opacity`, `cropLeft`, `cropTop`, `cropRight`,
`cropBottom`. Jeder andere Name wird abgelehnt: ein Keyframe, den die Darstellung nie liest, ist
schlimmer als keiner — er wird gespeichert, wieder geladen und tut nichts, und der Editor, der ihn
geschrieben hat, merkt es nicht.

Ein gekeyframtes Feld gewinnt gegen das gleichnamige Feld aus `clip.setTransform`, genau wie ein
gekeyframter Parameter gegen `effect.setParam` gewinnt. Nur ein Clip hat eine Transformation;
`{ kind: "track" }` und `{ kind: "project" }` werden hier abgelehnt.

Platziert wird das Bild aus `transformsAt`, nicht aus `clip.transform` — siehe
[Architektur](/de/guide/architecture).

## Drahtformat

Commands sind ein `serde`-Enum mit gepunktetem Tag und camelCase-Feldern, also ist das JSON, das ein
TypeScript-Client sendet, genau das JSON, das Rust deserialisiert:

```json
{ "type": "clip.move", "clip": "clp_1", "toTrack": "trk_1", "start": 42 }
```

`start` ist eine schlichte Ganzzahl, weil `Time` transparent als Flicks serialisiert. Um den Command
liegt eine Hülle mit dem optionalen Coalesce-Key:

```json
{
  "command": { "type": "clip.move", "clip": "clp_1", "toTrack": "trk_1", "start": 42 },
  "coalesceKey": "drag:clp_1"
}
```

In TypeScript bauen die `cmd.*`-Helfer aus `@videola/core` die Command-Objekte, und
`VideolaDocument.dispatch(command, coalesceKey?)` schickt sie ab:

```ts
import { cmd, createWasmBackend, VideolaDocument } from "@videola/core";

const doc = new VideolaDocument(await createWasmBackend());
doc.dispatch(cmd.trackAdd("video", "V1"));
doc.undo();
doc.redo();
```

Für `media.import` gibt es keinen `cmd.*`-Helfer, weil der Aufrufer den Inhalts-Hash nicht selbst
bildet: `doc.importMedia(file, bytes)` übergibt die Bytes an den Kern, der hasht, das `MediaAsset`
baut, den Command abschickt und die `MediaId` zurückgibt.

## Dispatch und Patch

`Document::dispatch` serialisiert das Projekt, wendet den Command auf einen Klon an, serialisiert das
Ergebnis, bildet die Differenz in beide Richtungen, legt das Paar auf den Undo-Stack, löscht den
Redo-Stack und übernimmt den Klon. Zurück kommt immer dieselbe Form:

```ts
interface DispatchResult {
  patch: JsonPatch;   // Operationen nach RFC 6902
  label: string;      // ein Katalog-Schlüssel, z. B. "cmd.track.add"
  canUndo: boolean;
  canRedo: boolean;
}
```

Der Patch macht die Grenze billig: die Oberfläche braucht nach jeder Bearbeitung nicht das ganze
Projekt zurück, sondern nur die Änderungen. Das `label` ist ein Katalog-Schlüssel, kein Satz — der
Kern gibt keinen nutzersichtbaren Text aus.

Zwei Feinheiten sind Absicht: ein Command, der nichts ändert, legt keinen Historieneintrag an und
lässt den Redo-Stack in Ruhe; und Redo wird erst geleert, wenn der Eintrag wirklich steht. Undo nimmt
nichts vom Stack, bevor der Umkehr-Patch erfolgreich angewendet wurde. Der Stack hält 500 Einträge
und wirft die ältesten weg.

Der Klon verdient sich einen Teil seiner Kosten unabhängig vom Diff: `media.remove` kann an der
Tiefenbegrenzung scheitern, nachdem auf flacheren Ebenen schon Clips entfernt wurden. Diese
Teilmutation landet auf dem Klon und wird verworfen — der Command greift also ganz oder gar nicht.

## Coalescing fasst ein Ziehen zu einem Undo-Schritt zusammen

Ein gezogener Clip erzeugt einen `clip.move` pro Zeigerbewegung, also ohne weiteres hundert
Undo-Schritte zurück zum Ausgangspunkt.

Trägt der oberste Eintrag denselben `coalesceKey`, legt der neue Command keinen Eintrag an, sondern
schreibt den vorhandenen so um, dass er von Beginn der Gruppe bis zum jetzigen Zustand reicht: der
Anfangszustand wird aus dem Umkehr-Patch des obersten Eintrags rekonstruiert — gespeichert ist er
nirgends — und der Eintrag danach mit den Diffs von dort nach `after` und zurück ersetzt.

Damit bleibt für das gesamte Ziehen genau ein Eintrag, dessen Umkehrung die Position vor dem Ziehen
wiederherstellt, nicht die von einer Bewegung vorher. Der Key muss nur für die Dauer der Geste stabil
und gegen fremde Bearbeitungen eindeutig sein; `"drag:clp_1"` ist die natürliche Form. Ohne Key wird
nie zusammengefasst, und ein abweichender Key beginnt einen neuen Eintrag — ein ausdrückliches
Abschließen der Geste braucht es also nicht. Ein Schieber im Inspector braucht dieselbe Sorgfalt eine
Ebene tiefer: der Key muss auch das Feld nennen, sonst verschmelzen ein Zug an `x` und danach einer an
`y` zu einem einzigen Undo-Schritt, der beide zusammen zurücknimmt.
