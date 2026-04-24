function require_env_string(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Environment variable ${name} (string) is required but not set.`);
    return value;
}

export const config = {
    mongo_uri: require_env_string("MONGO_URI"),
    mongo_db_name: require_env_string("MONGO_DB"),
    mongo_time_records: require_env_string("MONGO_TIME_RECORDS"),
};
