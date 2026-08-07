# Commands und Undo

::: info Zusammenfassung
Das vollständige Kapitel gibt es nur auf Englisch: [Commands and
undo](/guide/commands-and-undo). Dort stehen alle zwanzig Commands mit ihren Feldern, das Drahtformat
und der Ablauf im Detail. Diese Seite fasst es zusammen.
:::

Jede Bearbeitung ist ein serialisierbarer Command. Es gibt keinen Pfad, der das Projekt direkt
verändert — daraus fallen Undo und später eine REST-API und ein MCP-Server aus einem Mechanismus statt
aus drei.

## Die zwanzig Commands

| Gruppe | Commands |
|---|---|
| `project.*` | `setSettings`, `setTitle` |
| `track.*` | `add`, `remove`, `reorder`, `rename`, `setVolume`, `setPan`, `setFlags` |
| `clip.*` | `add`, `remove`, `move`, `trim`, `split`, `setSpeed`, `setVolume` |
| `effect.*` | `add`, `setParam` |
| `media.*` | `import`, `remove` |

`track.setFlags` nimmt jede Marke als nullbaren Wert, damit ein Command eine beliebige Teilmenge
ändern kann; `null` heißt „unverändert lassen". Rückwärtslauf ist `clip.setSpeed` mit
`reverse: true`, kein eigener Clip-Typ. Die beiden `effect.*`-Commands pflegen nur das Modell;
gerendert wird nichts. `media.remove` entfernt auch jeden Clip, der das Asset benutzt, und steigt
dafür in verschachtelte Compound-Timelines ab.

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
Abschließen der Geste braucht es also nicht.
