import * as vscode from "vscode";
import { explorerTable } from "../mssql/explorerTable";
import { report, session } from "../mssql/session";
import { objectScript } from "./objectScript";
import { deliver, destinations } from "./destination";

const operations = ["create", "drop", "dropAndCreate", "select", "insert", "update", "delete"] as const;

export function registerTableMenu(context: vscode.ExtensionContext) {
    for (const op of operations) {
        for (const destination of destinations) {
            const command = vscode.commands.registerCommand(`sqlToolbelt.table.${op}.${destination}`, async node => {
                try {
                    const { db, object } = explorerTable(node);
                    const { api, token } = await session();
                    const sql = await objectScript(api, token, db, { ...object, type: "Table" }, op);
                    await deliver(destination, sql, db.name, `${object.schema}.${object.name} - ${op}`);
                } catch (error) { report(error); }
            });
            context.subscriptions.push(command);
        }
    }
}
