import type { RawSettingsData } from "../services/package-types";

export type Migration = (raw: RawSettingsData) => RawSettingsData;
export const MIGRATIONS: Migration[] = [];
export function runMigrations(raw: RawSettingsData): RawSettingsData {
    return MIGRATIONS.reduce((acc, m) => m(acc), raw);
}
