import { readRelation, type Relation, type Source } from "../mssql/columns";
import { ToolkitError, withConnection, type Database, type SharedConnections } from "../mssql/connection";

// One instance per explicit binding. Share identical in-flight requests and discard failed loads.
export class Metadata {
    private readonly cache = new Map<string, { until: number; result: Promise<Relation> }>();

    constructor(readonly api: SharedConnections, readonly db: Database) {}

    async resolve(token: string, sources: Source[]) {
        const [profile, database] = await Promise.all([
            this.api.getActiveEditorConnectionId(token), this.api.getActiveDatabase(token)
        ]);
        if (profile !== this.db.profile || database !== this.db.name) {
            throw new ToolkitError("Zuerst die Datenbank dieses SQL-Editors übernehmen.");
        }
        const keys = sources.map(s => JSON.stringify([s.schema, s.name]));
        const hits = new Map<string, Promise<Relation>>();
        const missing = new Map<string, Source>();
        keys.forEach((key, i) => {
            const cached = this.cache.get(key);
            if (cached && cached.until > Date.now()) hits.set(key, cached.result);
            else missing.set(key, sources[i]);
        });
        if (missing.size) {
            const batch = withConnection(this.api, token, this.db, async uri => {
                const rows = new Map<string, Relation>();
                for (const [key, source] of missing) {
                    rows.set(key, await readRelation(this.api, token, uri, this.db, source));
                }
                return rows;
            });
            for (const key of missing.keys()) {
                const result = batch.then(rows => rows.get(key)!);
                if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
                this.cache.set(key, { until: Date.now() + 30_000, result });
                hits.set(key, result);
                void result.catch(() => { if (this.cache.get(key)?.result === result) this.cache.delete(key); });
            }
        }
        return Promise.all(keys.map(key => hits.get(key)!));
    }
}
