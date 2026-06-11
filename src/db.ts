import { MongoClient, type Collection, type Db } from "mongodb";
import { config } from "./config.js"
import { time_record, hresource, contract_route } from "./models.js"

let client: MongoClient;

async function connect(): Promise<void> {
    client = new MongoClient(config.mongo.uri, {appName: `zetrick-api-${config.env}`});
    await client.connect();
    ilog("Connected to MongoDB");
}

export function get_db(): Db {
    return client.db(config.mongo.db_name);
}

export function get_trecs(): Collection<time_record> {
    const db = get_db();
    return db.collection<time_record>(config.mongo.time_records);
}

export function get_hresources(): Collection<hresource> {
    const db = get_db();
    return db.collection<hresource>(config.mongo.hresources);
}

export function get_conts(): Collection<contract_route> {
    const db = get_db();
    return db.collection<contract_route>(config.mongo.contracts);
}

const mongo = {
    connect,
    get_db,
    get_trecs,
    get_hresources,
    get_conts
};

export default mongo;
