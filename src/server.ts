import "./bootstrap.js";
import express, { Request, Response } from "express";
import { connect_to_db, get_db } from "./db.js"

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

interface time_record {
    _id: string;
    start: Date;
    end: Date;
    date: Date;
}

app.post("/sms", async (req: Request, res: Response) => {
    const from = req.body.From as string;
    const body = req.body.Body as string;
    console.log(`SMS from ${from}: ${body}`);
    const db = get_db();
    const time_records = db.collection<time_record>();
    const timeRecords = get_time_records();

    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Got your message!</Message>
</Response>
`);
});

connect_to_db().then(() => {
    app.listen(3000, () => console.log("Running on port 3000"));
});
