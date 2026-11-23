# SQL-Toolbelt für VS Code

SQL-Toolbelt erweitert Microsoft MSSQL um das Tabellenmenü **Script Table as** und SQL-Vorlagen am Cursor. Im Objekt-Explorer erzeugst du unter anderem CREATE-, DROP-, INSERT- und UPDATE-Skripte. Im verbundenen Editor ergänzt Tab eine Spaltenliste für `SELECT *` oder eine passende `VALUES`-Liste für `INSERT INTO`.

Die Erweiterung liest Metadaten über die von dir freigegebene MSSQL-Verbindung. Erzeugte Skripte kannst du in einem SQL-Editor prüfen, als Datei speichern oder in die Zwischenablage kopieren. Sie können Namen und Definitionen aus deiner Datenbank enthalten. Verwende für öffentliche Beispiele eine eigens angelegte Testdatenbank.

## Lokal ausprobieren

Voraussetzungen sind Node.js ab 22 mit npm, Desktop-VS-Code ab 1.105 und die Erweiterung **SQL Server (mssql)** von Microsoft. Der Referenzstand für den klassischen Object Explorer ist MSSQL 1.48.0.

```sh
git clone https://github.com/PaddyBlanco/VSC-SQL-Toolbelt.git
cd VSC-SQL-Toolbelt
npm ci --ignore-scripts
npm test
code .
```

Starte mit **F5** die Konfiguration **SQL Developer Toolkit lokal testen**. Rechtsklicke im MSSQL-Objekt-Explorer auf eine Tabelle deiner Testdatenbank und wähle **Script Table as → CREATE To → New Query Editor Window**. Erwartet wird ein neues SQL-Dokument mit der Tabellendefinition.

Bedienung, Beispiele und Entwicklungsanleitung stehen im [Projekt-Wiki](https://github.com/PaddyBlanco/VSC-SQL-Toolbelt/wiki).

## Mitwirken

Beschreibe bei Fehlern den Aufruf, das erwartete Ergebnis und die verwendeten Versionen. Verwende erfundene Objekt- und Spaltennamen. Führe für Codeänderungen `npm test` aus und beschreibe das Ergebnis im Pull Request. Für vertrauliche Meldungen gilt die [Sicherheitsrichtlinie](https://github.com/PaddyBlanco/VSC-SQL-Toolbelt/blob/main/SECURITY.md).

## Lizenz

Dieses Projekt steht unter der [MIT-Lizenz](https://github.com/PaddyBlanco/VSC-SQL-Toolbelt/blob/main/LICENSE).
