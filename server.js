/** @namespace socket.decoded_token */
const cors = require('cors')();
const express = require('express');
const rp = require('request-promise-any');
const app = express();
app.enable('trust proxy');
require('dotenv').config();
const _dbm = require('db-migrate');
global.dbMigrate = _dbm.getInstance(true);
const bluebird = require('bluebird');
global.fs = bluebird.promisifyAll(require("fs"));
const bodyParser = require('body-parser');
rp({uri: 'http://31.220.15.49:9000/verify?purchaseCode=' + process.env.PURCHASE_CODE, headers: { 'User-Agent': 'node.js' }, json: true}).then(function(result) {
    if(result.status === "OK") {
            global.jwtToken = result.token;
            global.riderPrefix = "rider";
            global.driverPrefix = "driver";
            global.publicDir = __dirname + "/public/";
            global.mysql = require('./models/mysql');
            global.baseData = [];
            global.serviceTree = [];
            global.drivers = {};
            global.riders = {};
            app.use(cors);
            app.options('*', cors);
            app.use(bodyParser.json());
            app.use(bodyParser.urlencoded({extended: true}));
            app.use('/img', express.static(__dirname + "/public/img"));
            app.use(express.static('/srv/'));
            app.use(require("./libs/express-router"));
            let server = require('http').createServer(app);
            const io = require("socket.io").listen(server);
            global.operatorsNamespace = require("./libs/operator")(io);
            require("./libs/client")(io);

            process.on('unhandledRejection', r => console.log(r));
            server.listen(process.env.MAIN_PORT, function () {
                console.log("Listening on " + process.env.MAIN_PORT);

            });
    } else {
        throw new Error(result.message);
    }
});