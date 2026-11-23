const test = require("node:test");
const assert = require("node:assert/strict");
const { candidate } = require("../out/editor/candidate.js");
const { replacement } = require("../out/editor/replacement.js");
const { dml } = require("../out/objektskripte/dml.js");
const { execReplacement } = require("../out/editor/exec.js");
const { Metadata } = require("../out/editor/metadata.js");

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

test("EXEC übernimmt die Signatur vom gebundenen Katalog und gibt nur OUTPUT-Parameter aus", async () => {
    const db = { profile: "Testprofil", name: "Demo" };
    let reads = 0;
    const api = {
        getActiveEditorConnectionId: async () => db.profile,
        getActiveDatabase: async () => db.name,
        connect: async () => "Verbindung", disconnect: async () => {},
        async executeSimpleQuery(token, uri, query) {
            reads++;
            assert.match(query, /FROM sys\.procedures/);
            assert.match(query, /ORDER BY p\.parameter_id/);
            assert.doesNotMatch(query, /GetTotal/);
            const rows = [
                ["@OrderId", "int", 4, 10, 0, 0, 0, ""],
                ["@Lines", "LineType", -1, 0, 0, 0, 0, "[sales].[LineType]"],
                ["@Total", "decimal", 9, 12, 2, 1, 0, ""],
                ["@Note", "nvarchar", -1, 0, 0, 1, 0, ""]
            ];
            return { rows: rows.map(row => [db.name, ...row].map(value => ({ displayValue: String(value) }))) };
        }
    };
    const sql = "USE [Demo];\r\nDECLARE @OrderId int;\r\n\texec [sales].[GetTotal];\r\nSELECT 1;";
    const pos = sql.indexOf("GetTotal]") + "GetTotal]".length;
    const match = candidate(sql, pos, db.name);
    assert.equal(match.kind, "exec");
    assert.equal(match.source.schema, "sales");
    const metadata = new Metadata(api, db);
    const parameters = await metadata.parameters("token", match.source);
    await metadata.parameters("token", match.source);
    assert.equal(reads, 1);
    const edit = execReplacement(sql, match, parameters, "\t", "\r\n");
    assert.equal(sql.slice(0, edit.start) + edit.value + sql.slice(edit.end), [
        "USE [Demo];", "DECLARE @OrderId int;", "\tDECLARE @OrderId_2 int;", "\tDECLARE @Lines [sales].[LineType];",
        "\tDECLARE @Total decimal(12,2);", "\tDECLARE @Note nvarchar(max);", "", "\texec [sales].[GetTotal]",
        "\t\t@OrderId = @OrderId_2,", "\t\t@Lines = @Lines,", "\t\t@Total = @Total OUTPUT,", "\t\t@Note = @Note OUTPUT;", "",
        "\tSELECT @Total AS [Total],", "\t\t@Note AS [Note];", "SELECT 1;"
    ].join("\r\n"));
    api.getActiveDatabase = async () => "Andere";
    await assert.rejects(metadata.parameters("token", match.source), /Verbindung des SQL-Editors/);
});

test("EXECUTE ohne Ausgabeparameter erzeugt Deklaration und Aufruf", () => {
    const sql = "EXECUTE [My]]Proc] ";
    const match = candidate(sql, sql.length);
    assert.equal(match.source.name, "My]Proc");
    assert.equal(execReplacement(sql, match, [{ name: "@Id", declarationType: "int", output: false }], "    ", "\n").value,
        "DECLARE @Id int;\n\nEXECUTE [My]]Proc]\n    @Id = @Id;");
});

test("EXEC ergänzt nur einen eigenständigen, noch leeren Aufruf in der gebundenen Datenbank", () => {
    for (const sql of ["EXEC dbo.P @Id = 1", "EXEC dbo.P\n  @Id = 1", "EXEC dbo.P WITH RECOMPILE", "EXEC dbo.P;2",
        "EXEC dbo.P.Extra", "INSERT INTO dbo.T\nEXEC dbo.P", "IF 1=1\nEXEC dbo.P", "-- EXEC dbo.P",
        "SELECT 'EXEC dbo.P'", "USE [Andere]; EXEC dbo.P"]) {
        assert.equal(candidate(sql, sql.indexOf("dbo.P") + 5, "Demo"), undefined, sql);
    }
    for (const sql of ["EXEC (@sql)", "EXEC @proc", "EXEC AS", "EXEC @rc = dbo.P"]) {
        assert.equal(candidate(sql, sql.length), undefined, sql);
    }
});
