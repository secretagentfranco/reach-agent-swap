import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
mkdirSync(".local", { recursive: true, mode: 0o700 });
chmodSync(".local", 0o700);
const db = new DatabaseSync(".local/reach.sqlite");
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id))",
);
export const store = {
  get<T = any>(kind: string, id: string): T | undefined {
    const x = db
      .prepare("SELECT body FROM records WHERE kind=? AND id=?")
      .get(kind, id) as any;
    return x ? JSON.parse(x.body) : undefined;
  },
  all<T = any>(kind: string): T[] {
    return (
      db.prepare("SELECT body FROM records WHERE kind=?").all(kind) as any[]
    ).map((x) => JSON.parse(x.body));
  },
  put(kind: string, id: string, value: unknown) {
    db.prepare("INSERT OR REPLACE INTO records VALUES (?,?,?)").run(
      kind,
      id,
      JSON.stringify(value),
    );
  },
};
