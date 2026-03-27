import "./bootstrap.js";
const express = require("express");
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());


app.post("/sms", (req, res) => {
    const from = req.body.From;
    const body = req.body.Body;
    console.log(`SMS from ${from}: ${body}`);

    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
  <Response>                                                                                                                                          
      <Message>Got your message!</Message>
  </Response>
`);
});

app.listen(3000, () => console.log("Running on port 3000"));
