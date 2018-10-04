const redis = require('../models/redis');
const socketioJwt = require('socketio-jwt');
const update = require('../libs/update-handler');
global.foreignKeys = {
    'service':
        {
            'media_id': 'media'
        },
    'car':
        {
            'media_id': 'media'
        },
    'driver':
        {
            'car_id': 'car',
            'media_id': 'media',
            'car_media_id': 'media'
        },
    'rider':
        {
            'media_id': 'media'
        },
    'travel':
        {
            'driver_id': 'driver',
            'rider_id': 'rider'
        }

};
module.exports = function (io) {
    return io.of('/operators').use(socketioJwt.authorize({
        secret: jwtToken,
        handshake: true
    })).on('connection', function (socket) {
        mysql.operator.getStatus(socket.decoded_token.id).then(function (result) {
            if (result === 'disabled') {
                socket.error('301');
                socket.disconnect();
            }
            if (result === 'updated') {
                socket.error('302');
                socket.disconnect();
            }
        });
        socket.on('getAllCars', async function (callback) {
            let cars = await mysql.operator.getAllCars();
            callback(cars[0]);
        });
        socket.on('getRows', async function (table, filers, sort, from, pageSize, fullTextFields, fullTextValue, callback) {
            if (fullTextValue === null && fullTextFields === null) {
                callback(100);
                return;
            }
            let operator = await mysql.getOneRow('operator', {id: socket.decoded_token.id});
            if (operator['permission_' + table] !== undefined && operator['permission_' + table].indexOf('view') < 0) {
                callback(410);
                return;
            }
            try {
                let result = await mysql.getRowsCustom(table, filers, sort, from, pageSize, fullTextFields, fullTextValue);
                /*if (foreignKeys[table])
                    result = await mysql.attachForeignKey(result, foreignKeys[table]);*/
                callback(200, result);
            } catch (error) {
                if(error.message !== undefined)
                    callback(666, error.message);
                else
                    callback(666,error);
            }
        });
        socket.on('saveRow', async function (table, row, callback) {
            try {
                let operator = await mysql.getOneRow('operator', {id: socket.decoded_token.id});
                if (operator['permission_' + table] !== undefined && operator['permission_' + table].indexOf('update') < 0) {
                    callback(411);
                    return;
                }
                //TODO:Dirty fix for null id rows. do it properly
                if (row.media_id !== undefined && row.media_id === "")
                    delete row.media_id;
                if (row.car_id !== undefined && row.car_id === "")
                    delete row.car_id;
                if (row.id !== undefined && row.id !== 0 && row.id !== "") {
                    let id;
                    if (Array.isArray(row.id))
                        id = row.id[0];
                    else
                        id = row.id;
                    delete row.id;
                    let result = await mysql.updateRow(table, row, id);
                    callback(200, result);
                    return;
                }
                if (row.id)
                    delete row.id;
                let result = await mysql.insertRow(table, row);
                callback(200, result);

            } catch (error) {
                if(error.message !== undefined)
                    callback(666, error.message);
                else
                    callback(666,error);
            }
        });
        socket.on('deleteRows', async function (table, Ids, callback) {
            try {
                let operator = await mysql.getOneRow('operator', {id: socket.decoded_token.id});
                if (operator['permission_' + table] !== undefined && operator['permission_' + table].indexOf('delete') < 0) {
                    callback(412);
                    return;
                }
                let result = await mysql.deleteRows(table, Ids);
                callback(200, result);
            } catch (error) {
                if(error.message !== undefined)
                    callback(666, error.message);
                else
                    callback(666,error);
            }
        });
        socket.on('deleteRowsCustom', async function (table, filter, callback) {
            try {
                let operator = await mysql.getOneRow('operator', {id: socket.decoded_token.id});
                if (operator['permission_' + table] !== undefined && operator['permission_' + table].indexOf('delete') < 0) {
                    callback(412);
                    return;
                }
                let result = await mysql.deleteRowsCustom(table, filter);
                callback(200, result);
            } catch (error) {
                callback(666, error);
            }
        });
        socket.on('getCallRequests', async function (from, pageSize, callback) {
            let callRequests = await redis.getCallRequests(from, pageSize);
            let result = await Promise.all(callRequests);
            callback(result);
        });
        socket.on('deleteCallRequests', async function (Ids, callback) {
            await redis.deleteCallRequests(Ids);
            callback(200);
        });
        socket.on('markPaymentRequestsPaid', async function (Ids, callback) {
            let driverIds = await mysql.driver.markPaymentRequestsPaid(Ids);
            update.operatorStats();
            for (let driverId of driverIds)
                update.driver(io, driverId);
            callback(200);
        });
        socket.on('getReviews', async function (driverId, callback) {
            callback((await mysql.operator.getDriverReviews(driverId))[0]);
        });
        socket.on('getDriversTransactions', async function (driverId, callback) {
            let result = await mysql.driver.getTransactions(driverId);
            callback(result);
        });
        socket.on('chargeDriver', async function (json, callback) {
            await mysql.driver.chargeAccount(json.driver_id, json.transaction_type, json.document_number, json.amount);
            update.driver(io, json.driver_id);
            callback(200);
        });
        socket.on('chargeRider', async function (json, callback) {
            await mysql.rider.chargeAccount(json.rider_id, json.transaction_type, json.document_number, json.amount);
            update.rider(io, json.rider_id);
            callback(200);
        });
        socket.on('markComplaintsReviewed', async function (Ids, callback) {
            await mysql.operator.markComplaintsReviewed(Ids);
            callback(200);
        });
        socket.on('getDriversLocation', async function (point, callback) {
            try {
                let result = await redis.getAllDrivers(point);
                result = result.map(x => {
                    return {lat: x[2][1], lng: x[2][0]}
                });
                callback(200, result);
            }
            catch (err) {
                console.log(err.message);
            }
        });
        socket.on('setColumnValue', async function (tableName, id, column, value, callback) {
            try {
                if (process.env.TEST_MODE && process.env.TEST_MODE === "true" && tableName === "operator")
                    return;
                switch (tableName) {
                    case('operator'):
                        mysql.operator.setStatus(id, 'updated');
                        break;
                    case('driver'):
                        update.driver(io, id);
                        break;
                    case ('rider'):
                        update.rider(io, id);
                        break;
                }
                let result = await mysql.operator.setColumnValue(tableName, id, column, value);
                if (result)
                    callback(200);
                else
                    callback(666);
            } catch (error) {
                callback(666, error);
            }
        });
        socket.on('updateMedia', async function (buffer, mediaId, callback) {
            try {
                let fileName = await mysql.media.doUpload(buffer, mediaId);
                callback(200, fileName);
            } catch (error) {
                callback(666, error);
            }
        });
        socket.on('newMedia', async function (buffer, type, callback) {
            try {
                let mediaId = await mysql.insertRow('media', {type: type});
                let fileName = await mysql.media.doUpload(buffer, mediaId);
                callback(200, fileName);
            } catch (error) {
                callback(666, error);
            }
        });
        socket.on('updateOperatorPassword', async function (oldPass, newPass, callback) {
            if (process.env.TEST_MODE && process.env.TEST_MODE === "true")
                return;
            let result = (await mysql.operator.updateOperatorPassword(socket.decoded_token.id, oldPass, newPass))[0];
            if (result.affectedRows === 1) {
                callback(200);
            }
            else {
                callback(403);
            }
        });
        socket.on('getStats', async function (callback) {
            let [result, ignored] = await sql.query("SELECT (SELECT COUNT(*) FROM driver) as drivers, (SELECT COUNT(*) FROM travel) as travels, (SELECT COUNT(*) FROM rider) as riders,(SELECT COUNT(*) FROM complaint WHERE is_reviewed = FALSE) AS complaints_waiting");
            callback(result[0]);
        });
        socket.on('getConfigs', async function (callback) {
            let result = {
                max_drivers: process.env.MAX_DRIVERS_SEND_REQUEST,
                max_distance: process.env.MAX_DISTANCE_TO_SEND_REQUEST,
                minimum_payment_request: process.env.MINIMUM_AMOUNT_TO_REQUEST_PAYMENT,
                percent_company: process.env.PERCENT_FOR_COMPANY,
                cash_payment_commission: process.env.CASH_PAYMENT_REDUCES_DRIVER_CREDIT,
                rider_min_ver_ios: process.env.RIDER_MIN_VERSION_IOS,
                driver_min_ver_ios: process.env.DRIVER_MIN_VERSION_IOS,
                rider_min_ver_android: process.env.RIDER_MIN_VERSION_ANDROID,
                driver_min_ver_android: process.env.DRIVER_MIN_VERSION_ANDROID
            };
            callback(result);
        });
    });
};