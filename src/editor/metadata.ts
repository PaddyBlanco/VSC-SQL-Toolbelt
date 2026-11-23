import { readRelation, type Relation, type Source } from "../mssql/columns";
import { readParameters, type Parameter } from "../mssql/parameters";
import { ToolkitError, withConnection, type Database, type SharedConnections } from "../mssql/connection";

type Cache<T> = Map<string, { until: number; result: Promise<T> }>;

// One cache per editor connection. Share identical in-flight requests and discard failed loads.
export class Metadata {
    private readonly relations: Cache<Relation> = new Map();
    private readonly procedures: Cache<Parameter[]> = new Map();

    constructor(readonly api: SharedConnections, readonly db: Database) {}

    resolve(token: string, sources: Source[]) {
        return this.lookup(token, sources, this.relations, readRelation);
    }

    async parameters(token: string, source: Source) {
        const [parameters] = await this.lookup(token, [source], this.procedures, readParameters);
        return parameters;
    }

    private async lookup<T>(token: string, sources: Source[], cache: Cache<T>,
        read: (api: SharedConnections, token: string, uri: string, db: Database, source: Source) => Promise<T>) {
        const [profile, database] = await Promise.all([
            this.api.getActiveEditorConnectionId(token), this.api.getActiveDatabase(token)
        ]);
        if (profile !== this.db.profile || database !== this.db.name) {
            throw new ToolkitError("Die Verbindung des SQL-Editors hat sich geändert. Bitte erneut ergänzen.");
        }
        const keys = sources.map(s => JSON.stringify([s.schema, s.name]));
        const hits = new Map<string, Promise<T>>();
        const missing = new Map<string, Source>();
        keys.forEach((key, i) => {
            const cached = cache.get(key);
            if (cached && cached.until > Date.now()) hits.set(key, cached.result);
            else missing.set(key, sources[i]);
        });
        if (missing.size) {
            const batch = withConnection(this.api, token, this.db, async uri => {
                const rows = new Map<string, T>();
                for (const [key, source] of missing) {
                    rows.set(key, await read(this.api, token, uri, this.db, source));
                }
                return rows;
            });
            for (const key of missing.keys()) {
                const result = batch.then(rows => rows.get(key)!);
                if (cache.size >= 64) cache.delete(cache.keys().next().value!);
                cache.set(key, { until: Date.now() + 30_000, result });
                hits.set(key, result);
                void result.catch(() => { if (cache.get(key)?.result === result) cache.delete(key); });
            }
        }
        return Promise.all(keys.map(key => hits.get(key)!));
    }
}
