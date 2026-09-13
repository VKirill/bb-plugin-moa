import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Config, RunView, MemberView } from "./contract";
import type { Input } from "./core";

export type ThreadConfig = { config: Config; revision: number };
export type SharedSettings = { settings: Omit<Config, "enabled">; revision: number };
export type Member = MemberView & { advisorInput?: string };
export type Run = Omit<RunView, "members"> & { members?: Member[]; fingerprint: string; revision: number | string; input: Input; queueId: string; permissionMode?: Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0]["permissionMode"]; referenceText?: string; advisorInput?: string };
export type Session = { workerId: string; cursor: number; environmentId: string };
export type DraftSelection = { config: Config; projectId: string; threadId: string | null };
export type Bootstrap = { hostId: string; main: Config["a"] };
export function createStore(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE documents (key TEXT PRIMARY KEY, thread_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL)",
    "CREATE INDEX documents_thread_kind ON documents(thread_id, kind)",
  ]);
  return {
    get<T>(key: string): T | null {
      const row = db.prepare("SELECT value FROM documents WHERE key = ?").get(key) as { value: string } | undefined;
      return row ? JSON.parse(row.value) as T : null;
    },
    put(key: string, threadId: string, kind: string, value: unknown) {
      db.prepare("INSERT INTO documents VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(key, threadId, kind, JSON.stringify(value));
    },
    list<T>(threadId: string, kind: string): T[] {
      return (db.prepare("SELECT value FROM documents WHERE thread_id = ? AND kind = ? ORDER BY rowid DESC LIMIT 100")
        .all(threadId, kind) as { value: string }[]).map(r => JSON.parse(r.value) as T);
    },
    delete(key: string) { db.prepare("DELETE FROM documents WHERE key=?").run(key); },
  };
}
export type Store = ReturnType<typeof createStore>;
