const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { Metadata } = require("../out/editor/metadata");

test("Tab löst SELECT, INSERT und EXEC mit USE am richtigen Katalog desselben Profils auf", async () => {
    const vscode = { window: {}, EndOfLine: { CRLF: 2 }, authentication: { getSession: async () => ({ accessToken: "fixture" }) } };
    const load = Module._load;
    let prepare;
    try {
        Module._load = function(name, ...args) { return name === "vscode" ? vscode : load.call(this, name, ...args); };
        ({ prepare } = require("../out/editor/prepare"));
    } finally { Module._load = load; }
    const bound = { profile: "Profil A", name: "Start" };
    let activeProfile = bound.profile;
    const connects = [], disconnects = [];
    const api = {
        getActiveEditorConnectionId: async () => activeProfile,
        getActiveDatabase: async () => bound.name,
        connect: async (_, profile, name) => { assert.equal(profile, bound.profile); connects.push(name); return name; },
        disconnect: async (_, uri) => { disconnects.push(uri); },
        executeSimpleQuery: async (_, uri, q) => {
            const canonical = uri === "archiv" ? "Archiv" : "Start";
            let row;
            if (q.startsWith("SELECT DB_NAME() WHERE DB_ID()")) {
                assert.ok(q.includes(Buffer.from(uri, "utf16le").toString("hex")));
                if (uri === "Fehlt") return { rows: [] };
                row = [canonical];
            } else if (q.includes("FROM sys.procedures")) {
                row = [canonical, "@Wert" + canonical, "int", 4, 10, 0, 0, 0, ""];
            } else {
                assert.match(q, /FROM sys.objects o JOIN sys.columns/);
                row = [canonical, 17, "dbo", "Buch", "U", "Nur" + canonical, "int", 4, 10, 0, 0, 0, 1, 0, 0, 0, "int"];
            }
            return { rows: [row.map(value => ({ displayValue: String(value) }))] };
        }
    };
    const store = new Metadata(api, bound);
    async function edit(sql) {
        const cursor = sql.includes("*") ? sql.indexOf("*") + 1 : sql.length;
        const document = { languageId: "sql", version: 1, lineCount: 1, offsetAt: p => p,
            lineAt: () => ({ range: { end: sql.length } }), getText: () => sql };
        vscode.window.activeTextEditor = { document, selections: [{}], selection: { isEmpty: true, active: cursor }, options: {} };
        return (await prepare(store, true)).change.value;
    }
    assert.match(await edit("SELECT * FROM dbo.Buch"), /NurStart/);
    assert.match(await edit("USE archiv\nSELECT * FROM dbo.Buch"), /NurArchiv/);
    assert.match(await edit("USE archiv\r\nINSERT INTO dbo.Buch"), /NurArchiv/);
    assert.match(await edit("USE archiv\nEXEC dbo.Suche"), /@WertArchiv/);
    assert.match(await edit("USE Start;\nSELECT * FROM dbo.Buch"), /NurStart/);
    assert.deepEqual(connects, ["Start", "archiv", "archiv"]);
    await assert.rejects(edit("USE Fehlt\nSELECT * FROM dbo.Buch"), /Datenbank konnte nicht bestätigt/);
    assert.deepEqual(disconnects, connects);
    activeProfile = "Profil B";
    await assert.rejects(edit("USE archiv\nSELECT * FROM dbo.Buch"), /Verbindung des SQL-Editors/);
    assert.equal(connects.length, 4);
});
