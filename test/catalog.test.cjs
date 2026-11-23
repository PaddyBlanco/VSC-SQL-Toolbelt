const test = require("node:test");
const assert = require("node:assert/strict");
const { ddlScript } = require("../out/objektskripte/script.js");
const { objectsQuery } = require("../out/mssql/catalog.js");
const { readParameters } = require("../out/mssql/parameters.js");

const db = { profile: "Profil B", name: "B" };
const table = { type: "Table", schema: "dbo", name: "Test", id: 123 };

function provider({ database = "B", drop = "DROP TABLE [dbo].[Test];", create = "CREATE TABLE [dbo].[Test] (b int);", queryError = false } = {}) {
    const calls = [];
    const api = {
        async connect(token, profile, databaseName) {
            calls.push("connect");
            assert.equal(profile, db.profile);
            assert.equal(databaseName, db.name);
            return "connection-to-B";
        },
        async executeSimpleQuery(token, uri, query) {
            calls.push("catalog");
            assert.equal(uri, "connection-to-B");
            assert.match(query, /^SELECT DB_NAME\(\)/);
            assert.match(query, /object_id = 123$/);
            return {
                rows: [[database, "dbo", "Test"].map(displayValue => ({ displayValue }))],
                messages: [{ isError: queryError }]
            };
        },
        async scriptObject(token, uri, operation, target) {
            calls.push(operation);
            assert.equal(uri, "connection-to-B");
            assert.deepEqual(target, { type: "Table", schema: "dbo", name: "Test" });
            return operation === 4 ? drop : create;
        },
        async disconnect(token, uri) {
            calls.push("disconnect");
            assert.equal(uri, "connection-to-B");
        }
    };
    return { api, calls };
}

test("rechtsgeklicktes B liefert vollständige Batches auf genau einer Verbindung", async () => {
    const { api, calls } = provider();
    const script = await ddlScript(api, "session", db, table, "dropAndCreate");
    assert.equal(script, "USE [B];\nGO\nDROP TABLE [dbo].[Test];\nGO\nCREATE TABLE [dbo].[Test] (b int);");
    assert.deepEqual(calls, ["connect", "catalog", 4, 1, "disconnect"]);
});

test("eine vorhandene Batchgrenze bleibt erhalten", async () => {
    const { api } = provider({ drop: "DROP TABLE [dbo].[Test];\r\nGO\r\n" });
    assert.equal((await ddlScript(api, "session", db, table, "dropAndCreate")).match(/^GO$/gm).length, 2);
});

for (const [operation, code] of [["create", 1], ["drop", 4]]) {
    test(operation + " fordert nur den gewünschten DDL-Teil an", async () => {
        const { api, calls } = provider();
        const result = await ddlScript(api, "session", db, table, operation);
        assert.match(result, new RegExp(operation + " TABLE", "i"));
        assert.deepEqual(calls, ["connect", "catalog", code, "disconnect"]);
    });
}

for (const [label, options, operations] of [
    ["falsche Datenbank", { database: "A" }, []],
    ["Katalogfehler", { queryError: true }, []],
    ["leeres DROP", { drop: " " }, [4]],
    ["leeres CREATE", { create: "" }, [4, 1]]
]) {
    test(label + " verwirft das Ergebnis und schließt die Verbindung", async () => {
        const { api, calls } = provider(options);
        await assert.rejects(ddlScript(api, "session", db, table, "dropAndCreate"));
        assert.deepEqual(calls, ["connect", "catalog", ...operations, "disconnect"]);
    });
}

test("nur ganzzahlige Katalog-IDs gelangen in die Abfrage", () => {
    assert.throws(() => objectsQuery("1abc"));
    assert.throws(() => objectsQuery(NaN));
    assert.match(objectsQuery(7), /schema_id = 7 /);
});

test("EXEC verwirft leere Signaturen, fremde Datenbanken und nicht darstellbare Parameter", async () => {
    for (const rows of [[], [["A", "@Id", "int", "4", "10", "0", "0", "0", ""]],
        [["B", "@Result", "cursor", "0", "0", "0", "1", "1", ""]],
        [["B", "@Data", "xml", "-1", "0", "0", "0", "0", "?"]]]) {
        const api = { executeSimpleQuery: async () => ({ rows: rows.map(row => row.map(displayValue => ({ displayValue }))) }) };
        await assert.rejects(readParameters(api, "session", "uri", db, { name: "GetTotal" }));
    }
});
