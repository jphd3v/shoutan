// Types for issues.mjs, so the TypeScript tests can import it.
export interface Report {
  id: number;
  kind: string;
  message: string;
  fingerprint?: string | null;
  occurrences?: number;
  app_version?: string | null;
  player_name?: string | null;
  details?: Record<string, unknown>;
}

export interface IssueClient {
  createIssue(issue: { title: string; body: string; labels: string[] }): Promise<{ html_url: string }>;
  getIssue(n: number): Promise<{ state: string; html_url: string }>;
  comment(n: number, body: string): Promise<unknown>;
}

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export function issueFor(report: Report, schema: string): { title: string; body: string; labels: string[] };

export function syncReports(options: {
  db: Queryable;
  gh: IssueClient;
  schemas: string[];
  log?: (line: string) => void;
}): Promise<{ schema: string; id: number; url: string }[]>;
