import "./bootstrap.js";
import express, { Request, Response } from "express";
import { connect_to_db, get_time_records } from "./db.js";
import { time_record } from "./schemas.js";

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post("/sms", async (req: Request, res: Response) => {
    const from = req.body.From as string;
    const body = req.body.Body as string;
    console.log(`SMS from ${from}: ${body}`);
    const time_records = get_time_records();

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
