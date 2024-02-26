const {
  default: makeWASocket,
  MessageType,
  MessageOptions,
  Mimetype,
  DisconnectReason,
  BufferJSON,
  AnyMessageContent,
  delay,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  MessageRetryMap,
  useMultiFileAuthState,
  msgRetryCounterMap,
} = require('@whiskeysockets/baileys');
const request = require('request');
const log = (pino = require("pino"));
const { session } = { session: "session_auth_info" };
const { Boom } = require("@hapi/boom");
const path = require("path");
const fs = require("fs");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = require("express")();
const axios = require('axios');
// enable files upload
app.use(
  fileUpload({
    createParentPath: true,
  })
);
const base64Img = require('base64-img');
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);

require('dotenv').config()


const port = process.env.port;
const qrcode = require("qrcode");

app.use("/assets", express.static(__dirname + "/client/assets"));

app.get("/scan", (req, res) => {
  res.sendFile("./client/index.html", {
    root: __dirname,
  });
});

app.get("/", (req, res) => {
  res.send("server working");
});

let sock;
let qrDinamic;
let soket;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("session_auth_info");

  sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    logger: log({ level: "silent" }),
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    qrDinamic = qr;
    if (connection === "close") {
      let reason = new Boom(lastDisconnect.error).output.statusCode;
      if (reason === DisconnectReason.badSession) {
        console.log(
          `Bad Session File, Please Delete ${session} and Scan Again`
        );
        soket?.emit("msg", `Bad Session File, Please Delete ${session} and Scan Again`);
        sock.logout();
      } else if (reason === DisconnectReason.connectionClosed) {
        console.log("Connection lost, reconnect....");
        soket?.emit("msg", "Connection lost, reconnect....");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.connectionLost) {
        console.log("Lost server connection, reconnecting...");
        soket?.emit("msg", "Lost server connection, reconnecting...");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.connectionReplaced) {
        console.log(
          "Connection replaced, another new session opened, close current session first"
        );
        soket?.emit("msg", "Connection replaced, another new session opened, close current session first");
        sock.logout();
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(
          `Device closed, delete ${session} and scan again.`
        );
        soket?.emit("msg", `Device closed, delete ${session} and scan again.`);
        sock.logout();
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("Reboot required, rebooting...");
        soket?.emit("msg", `Reboot required, rebooting...`);
        connectToWhatsApp();
      } else if (reason === DisconnectReason.timedOut) {
        console.log("Connection timed out, connecting...");
        soket?.emit("msg", `Connection timed out, connecting...`);
        connectToWhatsApp();
      } else {
        sock.end(
          `Unknown reason for disconnection: ${reason}|${lastDisconnect.error}`
        );
        soket?.emit("msg", `Unknown reason for disconnection: ${reason}|${lastDisconnect.error}`);
      }
    } else if (connection === "open") {
      console.log("open connection");
      soket?.emit("msg", "open connection");
      return;
    }
  });
  sock.ev.on('messages.upsert', async m => {
    const messageRaw = m.messages[0];
    let message = messageRaw;
  
    
    // Formatting
    message = require('./Mesage.js')(sock, messageRaw);
    var caption = messageRaw.message?.imageMessage?.caption || '';
    console.log(message);
    if (message.isMedia && (caption.includes("/insert") || caption.includes("/inlh"))) {
      // console.log(await message.getMedia().toString('base64')??'') // kalo bukan func
      console.log("================================================")
      const mediaBuffer = await message.getMedia()
      console.log(mediaBuffer.toString('base64'))
      
      const base64Data = mediaBuffer.toString('base64');

      console.log(base64Data);
      
      soket?.emit("img", base64Data);
      soket?.emit("msg", caption);



      //if caption null then caption "blank" else caption not null caption "not null"
      if (!caption || caption.length === 0) {
        var caption = "null";
      }else{
        var caption = messageRaw.message.imageMessage.caption;
      }

      let data = base64Data;
      let config = {
        method: 'POST',
        maxBodyLength: Infinity,
        url: 'https://script.google.com/macros/s/'+process.env.iddeploy+'/exec?caption='+caption,
        headers: { 
          'Content-Type': 'text/plain'
        },
        data : data
      };
      
      axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
        soket?.emit("msg", "Sukses mengirim ke GAS");
      })
      .catch((error) => {
        console.log(error);
        soket?.emit("msg", error);
      });
      

      console.log("================================================")
    }

  });

  sock.ev.on("creds.update", saveCreds);
}

const isConnected = () => {
  return sock?.user ? true : false;
};


io.on("connection", async (socket) => {
  soket = socket;
  if (isConnected()) {
    updateQR("connected");
  } else if (qrDinamic) {
    updateQR("qr");
  }
});

const updateQR = (data) => {
  switch (data) {
    case "qr":
      qrcode.toDataURL(qrDinamic, (err, url) => {
        soket?.emit("qr", url);
        soket?.emit("log", "QR received, scan");
      });
      break;
    case "connected":
      soket?.emit("qrstatus", "./assets/check.svg");
      soket?.emit("log", " logged in user");
      const { id, name } = sock?.user;
      var userinfo = id + " " + name;
      soket?.emit("user", userinfo);

      break;
    case "loading":
      soket?.emit("qrstatus", "./assets/loader.gif");
      soket?.emit("log", "Charging ....");

      break;
    default:
      break;
  }
};

connectToWhatsApp().catch((err) => console.log("unexpected error: " + err)); // catch any errors
server.listen(port, () => {
  console.log("Server Run Port : " + port);
});