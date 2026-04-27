function require_env_string(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Environment variable ${name} (string) is required but not set.`);
    return value;
}

export const config = {
    mongo: {
        uri: require_env_string("MONGO_URI"),
        db_name: require_env_string("MONGO_DB"),
        time_records: require_env_string("MONGO_TIME_RECORDS"),
        hresources: require_env_string("MONGO_HRESOURCES"),
        contracts: require_env_string("MONGO_CONTRACTS")
    }
};
