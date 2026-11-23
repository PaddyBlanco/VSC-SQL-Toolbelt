# SQL-Toolbelt für VS Code

**Ein Druck auf <kbd>Tab</kbd> schreibt `SELECT *` aus, ergänzt `INSERT INTO` um Spalten und Werte oder baut für `EXEC` einen typisierten Prozeduraufruf.** Zeige auf einen SQL-Objektnamen, um Definition, Abhängigkeiten, Schlüssel und Indizes direkt im Editor zu erkunden.

**Per Rechtsklick stehen sieben Skriptvarianten wie in SSMS bereit.** Erzeuge `DROP` und `CREATE` zusammen in einem Skript oder ein `UPDATE`, das jede Primärschlüsselspalte im `WHERE` berücksichtigt.

## Vom Rechtsklick zum Tabellenskript

Klicke im **MSSQL-Objekt-Explorer** mit der rechten Maustaste auf eine Tabelle. Mit **Script Table as → CREATE To → New Query Editor Window** öffnest du ihre Definition in einem neuen SQL-Editor.

![Tabellen-Kontextmenü mit geöffnetem „Script Table as“, dem Untermenü „CREATE To“ und den vier Ausgabezielen](assets/script-table-as.png)

Über dasselbe Menü erzeugst du auch SELECT, INSERT, UPDATE, DELETE oder ein kombiniertes DROP und CREATE. Als Ziel kannst du den Editor, eine Datei, die Zwischenablage oder einen Entwurf für einen SQL-Agent-Job wählen. Du entscheidest anschließend, ob du das Skript ausführst.

## Drei Abkürzungen mit Tab

Öffne einen verbundenen SQL-Editor und wähle in der Befehlspalette **SQL Developer Toolkit: Datenbank aus SQL-Editor übernehmen**. Sobald der Hinweis am Cursor erscheint, ist die Ergänzung bereit. Beide Demos verwenden die fiktive Tabelle `dbo.Buch`.

### `SELECT *` → Spalten ausschreiben

Setz den Cursor direkt hinter `*` und drück <kbd>Tab</kbd>. Aus dem Sternchen werden hier `[Id]`, `[Titel]` und `[Seiten]`. Bei `SELECT b.*` bleiben die ergänzten Spalten mit dem Alias `b` qualifiziert.

![Animierte Demo. Tab ersetzt das Sternchen durch die drei Spalten von dbo.Buch. Die FROM-Zeile bleibt erhalten.](assets/select-tab.gif)

### `INSERT INTO` → Spalten und Werte ergänzen

Drück <kbd>Tab</kbd> direkt hinter `INSERT INTO dbo.Buch`. Du bekommst die Spaltenliste und einen passenden `VALUES`-Block. Im Beispiel erzeugt die Datenbank die ID selbst. Zum Ausfüllen bleiben Titel und Seitenzahl.

![Animierte Demo. Tab ergänzt Titel und Seiten sowie einen VALUES-Block mit einem Textplatzhalter und NULL.](assets/insert-tab.gif)

### `EXEC` → Prozedurparameter ergänzen

Drück <kbd>Tab</kbd> direkt hinter `EXEC [dbo].[GetTotal]`. Über dem Aufruf stehen dann typisierte `DECLARE`-Variablen für alle Parameter. Der Aufruf übergibt sie mit Namen. Hat die Prozedur Ausgabeparameter, zeigt ein `SELECT` darunter deren Werte. Fülle die Eingabevariablen vor dem Ausführen aus.

## Objektdetails per Hover

Zeige im verbundenen SQL-Editor zum Beispiel auf `dbo.Buch` in `SELECT * FROM dbo.Buch`. Über **Details öffnen** siehst du vier Tabs für die Tabelle, View, Prozedur oder T-SQL-Funktion.

| Tab | Was du siehst |
| --- | --- |
| Dependencies | Statische ein- und ausgehende Referenzen sowie Fremdschlüssel, soweit deine Berechtigungen sie sichtbar machen |
| Create | Die MSSQL-Definition. Doppelklick oder **Im SQL-Editor öffnen** übernimmt sie in ein neues Abfragefenster |
| Keys / Indexes | Namen, Schlüsselspalten in Reihenfolge, Sortierung, INCLUDE-Spalten und Fremdschlüsselziele |
| Properties | Name, Typ, Schema, Beschreibung, Datenbank und Server. Bei Tabellen auch Identity-Spalte, Indexierbarkeit, Lock Escalation und Datenspeicher |

Das neue Abfragefenster erhält SQL erst, wenn MSSQL das ursprüngliche Verbindungsprofil und die Datenbank bestätigt. Falls VS Code einen leeren Editor öffnet, verbinde ihn über MSSQL und wähle **Verbindung prüfen und einfügen**.

## Ausprobieren

Du brauchst Desktop-VS-Code ab **1.105**, **Node.js ab 22** mit npm und Microsofts Erweiterung [SQL Server (mssql)](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql). Der Referenzstand für den klassischen Objekt-Explorer ist MSSQL 1.48.0.

```sh
git clone https://github.com/PaddyBlanco/VSC-SQL-Toolbelt.git
cd VSC-SQL-Toolbelt
npm ci --ignore-scripts
npm test
code .
```

Starte mit **F5** die Konfiguration **SQL Developer Toolkit lokal testen**. Wenn du SQL-Toolbelt dauerhaft in deinem VS Code verwenden möchtest, baue und installiere die VSIX im Projektordner.

```sh
npx --yes --package=@vscode/vsce@4.1.1 vsce package --no-dependencies --out sql-toolbelt.vsix
code --install-extension ./sql-toolbelt.vsix
```

## Mitwirken

Beschreibe im Issue den Aufruf, das erwartete Ergebnis und deine Versionen. Verwende für Screenshots und SQL-Beispiele eine fiktive Datenbank. Generierte Skripte können echte Objektdefinitionen enthalten. Für Pull Requests bitte `npm test` ausführen und das Ergebnis angeben.

[Issue öffnen](https://github.com/PaddyBlanco/VSC-SQL-Toolbelt/issues) · [Sicherheitslücke privat melden](https://github.com/PaddyBlanco/VSC-SQL-Toolbelt/security/advisories/new) · [Sicherheitsrichtlinie](SECURITY.md) · [MIT-Lizenz](LICENSE)
