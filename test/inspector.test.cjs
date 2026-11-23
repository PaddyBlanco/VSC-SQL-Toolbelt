const test = require("node:test");
const assert = require("node:assert/strict");
const { candidate } = require("../out/editor/candidate");
const { hoverTarget } = require("../out/editor/hoverTarget");
const { detailRows } = require("../out/mssql/details");
const { saveDescription } = require("../out/mssql/description");
const { inspectorPage } = require("../out/editor/inspectorPage");
const { dml } = require("../out/objektskripte/dml");
const { replacement } = require("../out/editor/replacement");

test("der letzte eindeutige Datenbankwechsel entscheidet für Hover und Tab", () => {
    for (const [prefix, expected] of [
        ["USE Andere;\nUSE [Demo];\n", "Demo"], ["USE Demo;\nGO\nUSE Andere;\n", "Andere"],
        ["use [Buch Archiv] -- Kommentar\r\n", "Buch Archiv"], ["USE [A]]B]\nGO -- weiter\n", "A]B"],
        ["USE Erste\nUSE Zweite\n", "Zweite"], ["USE Erste\n\n/* USE Andere */\n", "Erste"],
        ["IF 1=1 USE Demo;\n", false], ["IF 1=1 USE Andere;\nGO\nUSE Demo;\n", "Demo"],
        [":connect Example\nUSE Demo;\n", false], ["USE [$(DB)];\n", false], ["USE [$(DB)];\nUSE Demo;\n", false],
        ["-- USE Andere;\n", undefined], ["USE Demo;\nIF 1=1 USE Andere;\n", false],
        ["USE Name.Zusatz;\n", false], ["USE Name-Rest;\n", false], ["!!echo ignored\nUSE Demo;\n", false],
        ["SELECT 1 WHERE 1!=2;\nUSE Demo\n", "Demo"]
    ]) {
        const sql = prefix + "SELECT * FROM dbo.Buch";
        for (const match of [candidate(sql, sql.lastIndexOf("*") + 1), hoverTarget(sql, sql.lastIndexOf("Buch"))]) {
            if (expected === false) assert.equal(match, undefined, prefix);
            else { assert.ok(match, prefix); assert.equal(match.database, expected, prefix); }
        }
    }
});

test("USE ohne Semikolon trennt SELECT, INSERT und EXEC vom Kopf und vom nächsten USE", () => {
    for (const [statement, needle, kind] of [["SELECT * FROM dbo.Buch", "*", "select"],
        ["INSERT INTO dbo.Buch", "Buch", "insert"], ["EXEC dbo.Suche", "Suche", "exec"]]) {
        const sql = "use Archiv\n" + statement + "\nUSE Andere\nSELECT * FROM dbo.Buch";
        const match = candidate(sql, sql.indexOf(needle) + needle.length);
        assert.equal(match.kind, kind);
        assert.equal(match.database, "Archiv");
        assert.equal(candidate(sql, sql.lastIndexOf("*") + 1).database, "Andere");
    }
});

test("Hover erkennt Objektpositionen, Klammern und Funktionen", () => {
    for (const sql of ["SELECT * FROM [dbo].[Buch]", "EXEC dbo.Buch", "SELECT dbo.Buch(1)", "SELECT * FROM Buch"]) {
        assert.equal(hoverTarget(sql, sql.indexOf("Buch"), "Demo").source.name, "Buch");
    }
    for (const sql of ["SELECT x.Buch FROM dbo.Test x", "SELECT * FROM Archiv.dbo.Buch", "SELECT 'dbo.Buch(1)'",
        "/* FROM dbo.Buch */", "SELECT * FROM #Buch", "WITH Buch AS (SELECT 1 AS n) SELECT * FROM Buch"]) {
        assert.equal(hoverTarget(sql, sql.lastIndexOf("Buch"), "Demo"), undefined);
    }
});

test("geänderte Objekt-ID oder Datenbank verhindert das Laden des Tabs", async () => {
    for (const row of [["Demo", "82", "dbo", "Buch", "Table"], ["Andere", "81", "dbo", "Buch", "Table"]]) {
        let calls = 0;
        const api = { executeSimpleQuery: async () => {
            calls++;
            return { rows: [row.map(displayValue => ({ displayValue }))] };
        } };
        await assert.rejects(detailRows(api, "", "", { profile: "Test", name: "Demo" },
            { id: 81, schema: "dbo", name: "Buch", type: "Table" }, "properties"));
        assert.equal(calls, 1);
    }
});

test("Keys / Indexes gruppiert Indexspalten und zusammengesetzte Fremdschlüssel in Katalogreihenfolge", async () => {
    const rows = [
        ["FOREIGN KEY", "BuchKey", "[Teil]", "", "[dbo].[Werk].[Teil]"],
        ["FOREIGN KEY", "BuchKey", "[Band]", "", "[dbo].[Werk].[Band]"],
        ["NONCLUSTERED", "BuchKey", "[Band] DESC", "", ""],
        ["NONCLUSTERED", "BuchKey", "[Teil] ASC", "", ""],
        ["NONCLUSTERED", "BuchKey", "", "[Titel, kurz]", ""],
        ["NONCLUSTERED", "BuchKey", "", "[Text]", ""],
        ["PRIMARY KEY", "PK_Buch", "[Id] ASC", "", ""]
    ];
    const api = { executeSimpleQuery: async (_, __, sql) => ({
        rows: (sql.startsWith("DECLARE") ? rows : [["Demo", "81", "dbo", "Buch", "Table"]])
            .map(row => row.map(displayValue => ({ displayValue })))
    }) };
    const result = await detailRows(api, "", "", { profile: "Test", name: "Demo" },
        { id: 81, schema: "dbo", name: "Buch", type: "Table" }, "indexes");
    assert.deepEqual(result, [
        ["FOREIGN KEY", "BuchKey", "[Teil], [Band]", "—", "[dbo].[Werk].[Teil], [dbo].[Werk].[Band]"],
        ["NONCLUSTERED", "BuchKey", "[Band] DESC, [Teil] ASC", "[Titel, kurz], [Text]", "—"],
        ["PRIMARY KEY", "PK_Buch", "[Id] ASC", "—", "—"]
    ]);
});

test("Beschreibung prüft die UTF-16-Grenze und meldet veraltete Texte oder Katalogfehler", async () => {
    const object = { id: 81, schema: "dbo", name: "Buch", type: "Table" }, db = { profile: "Test", name: "Demo" };
    let calls = 0, status = "changed", errors = false;
    const api = { executeSimpleQuery: async () => {
        calls++;
        return { rows: [[{ displayValue: status }]], messages: [{ isError: errors }] };
    } };
    const save = value => saveDescription(api, "", "", db, object, "Alt", value);
    await assert.rejects(save("📘".repeat(1875) + "X"), /7.500 Byte/);
    assert.equal(calls, 0);
    await assert.rejects(save("Neu"), /inzwischen geändert/);
    status = "saved";
    await save("📘".repeat(1875));
    errors = true;
    await assert.rejects(save(""), /Speichern fehlgeschlagen/);
});

test("Webview hat eine frische CSP und behandelt Katalogwerte ausschließlich als Text", () => {
    const page = inspectorPage();
    assert.match(page, /default-src 'none'/);
    assert.doesNotMatch(page, /innerHTML|outerHTML|insertAdjacentHTML|unsafe-inline|https?:\/\//);
    assert.notEqual(page, inspectorPage());
    assert.match(page, /pre\.textContent=m\.sql/);
    assert.match(page, /insertCell\(\)\.textContent=value/);
});

test("SELECT und INSERT behandeln Column Sets, Sparse-Spalten und verborgene Zeitspalten korrekt", () => {
    const table = { table: true, schema: "dbo", name: "Buch", columns: [
        { name: "Extra", type: "int", hidden: true, nullable: true, writable: true },
        { name: "Alle", type: "xml", hidden: false, writable: false },
        { name: "GueltigAb", type: "datetime2", hidden: true, writable: false }
    ] };
    const sql = "SELECT * FROM dbo.Buch";
    assert.equal(replacement(sql, candidate(sql, 8), [table], "  ", "\n").value.trim(), "[Alle]");
    assert.match(dml(table, "select"), /^SELECT TOP \(1000\)\n +\[Alle\]/);
    assert.doesNotMatch(dml(table, "select"), /\[Extra\]/);
    assert.match(dml(table, "insert"), /\[Extra\]/);
    assert.doesNotMatch(dml(table, "insert"), /\[Alle\]/);
    assert.doesNotMatch(dml(table, "select") + dml(table, "insert"), /GueltigAb/);
});
