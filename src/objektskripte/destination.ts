import * as vscode from "vscode";
import { agentJobScript } from "./job";

export const destinations = ["editor", "file", "clipboard", "job"] as const;
export type Destination = typeof destinations[number];

export async function deliver(destination: Destination, sql: string, database: string, label: string) {
    switch (destination) {
        case "clipboard":
            await vscode.env.clipboard.writeText(sql);
            return;
        case "file": {
            const uri = await vscode.window.showSaveDialog({ filters: { SQL: ["sql"] }, title: "Save SQL Script" });
            if (uri) await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(sql));
            return;
        }
        case "job": {
            const name = await vscode.window.showInputBox({
                title: "Agent Job ...", prompt: "Jobname für das Einrichtungsskript",
                value: label.replaceAll("%", "_").slice(0, 128),
                validateInput: text => !text.trim() || text.length > 128 || text.includes("%")
                    ? "Einen Jobnamen mit 1–128 Zeichen ohne % eingeben." : undefined
            });
            if (!name) return;
            sql = agentJobScript(name.trim(), database, sql);
            break;
        }
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "sql", content: sql }));
}
