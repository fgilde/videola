# Design-Dokumente

Das sind die ursprünglichen Aufzeichnungen, aus denen das Projekt gebaut wurde. Sie sind auf Deutsch
und werden verlinkt, nicht kopiert, damit die Aufzeichnung die Aufzeichnung bleibt.

## Die Design-Spec

[`docs/superpowers/specs/2026-08-07-videola-design.md`](https://github.com/fgilde/videola/blob/main/docs/superpowers/specs/2026-08-07-videola-design.md)

Das Architektur-Dokument, freigegeben am Ende des Brainstormings. Es behandelt die Anforderungen, die
technischen Entscheidungen und ihre Begründung, das Datenmodell, den Command-Bus, Rendering und
Wiedergabe, das Effekt- und Plugin-System, das Template-Format, das Packaging, die Teststrategie, die
Code-Konventionen und die Roadmap von M0 bis M8.

Zu lesen ist es als Aussage über den **angestrebten Umfang, nicht als Beschreibung des Bestehenden**.
Es beschreibt einen fertigen Editor mit Timeline, Wiedergabe, Effektbibliothek, Audio-Werkzeugkasten,
Template-Modus sowie REST- und MCP-API. Davon ist fast nichts gebaut. Das Kapitel
[Architektur](/de/guide/architecture) hält fest, welche Teile es wirklich gibt; die Abschnitte der
Spec ohne Gegenstück dort sind Entwurf, nicht Code.

## Die Umsetzungspläne

[`docs/superpowers/plans/2026-08-07-videola-m0-skeleton.md`](https://github.com/fgilde/videola/blob/main/docs/superpowers/plans/2026-08-07-videola-m0-skeleton.md)

Der M0-Plan: das Monorepo, `videola-core` mit Modell, Commands, Undo und der `.videola`-Ein- und
Ausgabe, die WASM-Bindings mit generierten Typen und der Anwendungsrahmen mit Theme und i18n. Das ist
der Meilenstein, der tatsächlich fertig ist, der Plan liegt also nah am heutigen Code.

[`docs/superpowers/plans/2026-08-07-videola-m7-packaging.md`](https://github.com/fgilde/videola/blob/main/docs/superpowers/plans/2026-08-07-videola-m7-packaging.md)

Der M7-Plan: die Tauri-Hülle, die sechs Bauziele, der Release-Workflow, die Secrets für Signatur und
Notarisierung und das Docker-Image. Umgesetzt vor M1 bis M6, das Packaging existiert also, während der
Editor, den es verpackt, noch nicht existiert. Das Ergebnis beschreibt [Bauen und
Ausliefern](/de/guide/building-and-releasing).

[`docs/superpowers/plans/2026-08-07-videola-m1-editor.md`](https://github.com/fgilde/videola/blob/main/docs/superpowers/plans/2026-08-07-videola-m1-editor.md)

Der M1-Plan: Medienimport nach OPFS, eine Timeline, ein WebGL2-Compositor und ein Audiograph in einem
neuen Paket `@videola/engine`, ein keyframebarer Effekt und Übergang und MP4-Export über WebCodecs.
Der ist noch nicht umgesetzt und damit die klarste Aussage darüber, was als Nächstes kommt. Er hält
außerdem drei bewusste Abweichungen von der Spec samt Begründung fest: WebGL2 vor WebGPU, Medien in
OPFS statt im WASM-Speicher, und kein Golden-Frame-Test, solange kein zweiter Compositor zum
Vergleichen existiert.
