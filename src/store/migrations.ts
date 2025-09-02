export type Migration = (raw: any) => any;
export const MIGRATIONS: Migration[] = [];
export function runMigrations(raw: any): any {
    return MIGRATIONS.reduce((acc, m) => m(acc), raw);
}
