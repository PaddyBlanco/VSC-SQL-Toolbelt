const test = require("node:test");
const assert = require("node:assert/strict");
const { candidate } = require("../out/editor/candidate.js");
const { replacement } = require("../out/editor/replacement.js");
const { dml } = require("../out/objektskripte/dml.js");

const col = { name: "Name", type: "nvarchar", bytes: 30, key: 0, writable: true, nullable: false };
const table = { table: true, schema: "dbo", name: "Test", columns: [
    { ...col, name: "Id", type: "int", key: 1, writable: false }, col
] };

test("DELETE ohne und mit zusammengesetztem PK enthält ein sicheres WHERE", () => {
    assert.match(dml({ ...table, columns: [col] }, "delete"), /WHERE 1 = 0;/);
    const sql = dml({ ...table, columns: [...table.columns, { ...col, name: "Mandant", key: 2 }] }, "delete");
    assert.match(sql, /DELETE FROM \[dbo\].\[Test\]\nWHERE \[Id\] = @pk1\n  AND \[Mandant\] = @pk2;/);
});

test("SELECT mit Alias und JOIN ersetzt nur d.*", () => {
    const sql = "SELECT d.* FROM dbo.Test d JOIN dbo.Other o ON d.Id = o.Id;";
    const c = candidate(sql, sql.indexOf("*") + 1);
    const edit = replacement(sql, c, [table, table], "    ", "\n");
    assert.equal(sql.slice(0, edit.start) + edit.value + sql.slice(edit.end),
        "SELECT\n    [d].[Id],\n    [d].[Name] FROM dbo.Test d JOIN dbo.Other o ON d.Id = o.Id;");
});

for (const sql of ["SELECT COUNT(*) FROM dbo.Test", "SELECT '*' FROM dbo.Test", "SELECT 4 * 2 FROM dbo.Test",
    "SELECT x.* FROM dbo.Test d", "SELECT * FROM (SELECT Id FROM dbo.Test) q", "SELECT 1 /* nested /* * */ still comment */"]) {
    test("keine Expansion: " + sql, () => assert.equal(candidate(sql, sql.indexOf("*") + 1), undefined));
}

test("INSERT am Cursor verwendet den Rechtsklick-Generator und erhält den Zielnamen", () => {
    const sql = "INSERT INTO dbo.Test";
    const relation = { ...table, columns: [
        ...table.columns.slice(0, 1), { ...col, bytes: 100 },
        { ...col, name: "Betrag", type: "decimal", precision: 12, scale: 2, nullable: true },
        { ...col, name: "CreatedAt", type: "datetime2", hasDefault: true }
    ] };
    const c = candidate(sql, sql.length);
    const edit = replacement(sql, c, [relation], "    ", "\n");
    const body = "\n(\n    [Name],\n    [Betrag]\n)\nVALUES\n(\n" +
        "    N'<Name>', -- [Name] [nvarchar(50)] -- NOT NULL\n    NULL -- [Betrag] [decimal(12,2)] -- NULL\n);";
    assert.equal(sql.slice(0, edit.start) + edit.value + sql.slice(edit.end), sql + body);
    assert.equal(dml(relation, "insert"), "INSERT INTO [dbo].[Test]" + body);
});

test("INSERT kommentiert MAX und Aliastypen auch bei mehrzeiligen Bezeichnern", () => {
    const columns = [{ ...col, name: "Text", bytes: -1 },
        { ...col, name: "Preis]\r\nnetto", type: "decimal", declaredType: "Geldbetrag", nullable: true }];
    const sql = dml({ ...table, columns }, "insert", "\t", "\r\n");
    assert.equal(sql.split("VALUES\r\n")[1], "(\r\n\tN'<Text>', -- [Text] [nvarchar(max)] -- NOT NULL\r\n" +
        "\tNULL -- [Preis]] netto] [Geldbetrag] -- NULL\r\n);");
});

test("INSERT ohne einzusetzende Spalten erzeugt DEFAULT VALUES", () => {
    assert.equal(dml({ ...table, columns: [{ ...col, hasDefault: true }] }, "insert"),
        "INSERT INTO [dbo].[Test] DEFAULT VALUES;");
});

test("beide TAB-Positionen in SELECT d.*,* wählen genau eine Wildcard", () => {
    const sql = "select d.*,* from data d";
    for (const [pos, expected] of [
        [sql.indexOf("*") + 1, "select\n    [d].[Id],\n    [d].[Name],* from data d"],
        [sql.lastIndexOf("*") + 1, "select d.*,[Id],\n[Name] from data d"]
    ]) {
        const c = candidate(sql, pos);
        assert.equal(c.kind, "select");
        const edit = replacement(sql, c, [table], "    ", "\n");
        assert.equal(sql.slice(0, edit.start) + edit.value + sql.slice(edit.end), expected);
    }
});

test("INSERT in einem SQL-Arbeitsblatt erkennt Klammern und horizontales Leerzeichen", () => {
    const sql = "USE [DemoDb];\r\nGO\r\nSELECT 1\r\nINSERT INTO [demo].[ExampleTable]  ";
    const c = candidate(sql, sql.length, "DemoDb");
    assert.equal(c.kind, "insert");
    assert.equal(c.start, sql.lastIndexOf("]") + 1);
    assert.equal(c.sources[0].schema, "demo");
    assert.equal(c.sources[0].name, "ExampleTable");
    assert.equal(candidate(sql, sql.length, "Other"), undefined);
    assert.equal(candidate(sql + "VALUES (1)", sql.length, "DemoDb"), undefined);
});

test("UPDATE mit zusammengesetztem PK enthält beide Vergleiche", () => {
    const sql = dml({ ...table, columns: [...table.columns, { ...col, name: "Mandant", key: 2 }] }, "update");
    assert.match(sql, /WHERE \[Id\] = @pk1\n  AND \[Mandant\] = @pk2;/);
    assert.match(sql, /DECLARE @pk2 nvarchar\(15\) = NULL/);
    assert.throws(() => dml({ ...table, columns: [col] }, "update"));
});
