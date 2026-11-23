const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("Query-Editor erhält SQL erst bei bestätigtem Profil, Datenbank und unverändertem Ziel", async t => {
    const mock = {};
    const load = Module._load;
    let deliver;
    try {
        Module._load = function(name, ...args) {
            return name === "vscode" ? mock : load.call(this, name, ...args);
        };
        ({ deliver } = require("../out/objektskripte/destination"));
    } finally { Module._load = load; }

    for (const scenario of ["Quelle", "anderes Profil", "andere Datenbank", "abgebrochen", "Editor gewechselt", "Editor bearbeitet", "explizit verbunden", "Explorer"]) {
        await t.test(scenario, async () => {
            const db = { profile: "Demo-A", name: "Demo" };
            const previous = { document: { getText: () => "SELECT 1" } };
            let inserted;
            let profile = ["Quelle", "Explorer", "andere Datenbank"].includes(scenario) ? db.profile : "Demo-B";
            const api = { getActiveEditorConnectionId: async () => profile,
                getActiveDatabase: async () => scenario === "andere Datenbank" ? "Andere" : db.name,
                onDidChangeActiveEditorConnection: () => ({ dispose() {} }) };
            const doc = { isUntitled: true, languageId: "sql", version: 1, getText: () => "" };
            const target = { document: doc, edit: async cb => { cb({ insert: (_, sql) => { inserted = sql; } }); return true; } };
            mock.extensions = { getExtension: () => ({ activate: async () => ({ getSharedConnectionsApi: () => api }) }) };
            mock.authentication = { getSession: async () => ({ accessToken: "fixture" }) };
            mock.Position = class {};
            mock.workspace = { textDocuments: [previous.document], openTextDocument: async options => {
                assert.deepEqual(options, { language: "sql" }); return doc;
            } };
            mock.window = { activeTextEditor: previous, showTextDocument: async () => (mock.window.activeTextEditor = target),
                onDidChangeActiveTextEditor: () => ({ dispose() {} }), showInformationMessage: async (_, check) => {
                    if (scenario === "Editor gewechselt") mock.window.activeTextEditor = previous;
                    if (scenario === "Editor bearbeitet") doc.version++;
                    if (scenario === "explizit verbunden") profile = db.profile;
                    return scenario === "abgebrochen" ? undefined : check;
                } };
            const node = scenario === "Explorer" ? {} : undefined;
            mock.commands = { executeCommand: async (command, arg) => {
                assert.equal(command, "mssql.objectExplorerNewQuery"); assert.equal(arg, node); mock.window.activeTextEditor = target;
            } };
            const send = deliver("editor", "SELECT 2", db, "Beispiel", node);
            if (["anderes Profil", "andere Datenbank", "Editor gewechselt", "Editor bearbeitet"].includes(scenario)) await assert.rejects(send);
            else await send;
            assert.equal(inserted, ["Quelle", "explizit verbunden", "Explorer"].includes(scenario) ? "SELECT 2" : undefined);
        });
    }
});