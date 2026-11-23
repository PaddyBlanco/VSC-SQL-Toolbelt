const test = require("node:test");
const assert = require("node:assert/strict");
const { candidate } = require("../out/editor/candidate");
const { hoverTarget } = require("../out/editor/hoverTarget");
const { detailRows } = require("../out/mssql/details");
const { inspectorPage } = require("../out/editor/inspectorPage");
const { dml } = require("../out/objektskripte/dml");
const { replacement } = require("../out/editor/replacement");

test("der letzte eindeutige Datenbankwechsel entscheidet für Hover und Tab", () => {
    for (const [prefix, enabled] of [
        ["USE Andere;\nUSE [Demo];\n", true], ["USE Demo;\nGO\nUSE Andere;\n", false],
        ["IF 1=1 USE Demo;\n", false], ["IF 1=1 USE Andere;\nGO\nUSE Demo;\n", true],
        [":connect Example\nUSE Demo;\n", false], ["USE [$(DB)];\n", false], ["USE [$(DB)];\nUSE Demo;\n", false],
        ["-- USE Andere;\n", true], ["USE Demo;\nIF 1=1 USE Andere;\n", false]
    ]) {
        const sql = prefix + "SELECT * FROM dbo.Buch";
        assert.equal(!!candidate(sql, sql.indexOf("*") + 1, "Demo"), enabled);
        assert.equal(!!hoverTarget(sql, sql.lastIndexOf("Buch"), "Demo"), enabled);
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

test("Webview hat eine frische CSP und behandelt Katalogwerte ausschließlich als Text", () => {
    const page = inspectorPage();
    assert.match(page, /default-src 'none'/);
    assert.doesNotMatch(page, /innerHTML|outerHTML|insertAdjacentHTML|unsafe-inline|https?:\/\//);
    assert.notEqual(page, inspectorPage());
    assert.match(page, /pre\.textContent=m\.sql/);
    assert.match(page, /insertCell\(\)\.textContent=value/);
});

test("das Column Set erscheint in SELECT, beschreibbare Sparse-Spalten in INSERT", () => {
    const table = { table: true, schema: "dbo", name: "Buch", columns: [
        { name: "Extra", type: "int", hidden: true, nullable: true, writable: true },
        { name: "Alle", type: "xml", hidden: false, writable: false }
    ] };
    const sql = "SELECT * FROM dbo.Buch";
    assert.equal(replacement(sql, candidate(sql, 8), [table], "  ", "\n").value.trim(), "[Alle]");
    assert.match(dml(table, "select"), /\[Alle\]/);
    assert.doesNotMatch(dml(table, "select"), /\[Extra\]/);
    assert.match(dml(table, "insert"), /\[Extra\]/);
    assert.doesNotMatch(dml(table, "insert"), /\[Alle\]/);
});