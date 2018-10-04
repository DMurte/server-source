/** @namespace socket.decoded_token */
const redis = require('../models/redis');
const geo = require('../models/geo');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const socketioJwt = require('socketio-jwt');
const update = require("../libs/update-handler");

module.exports = function (io) {
    io.use(socketioJwt.authorize({
        secret: jwtToken,
        handshake: true
    }));
    io.sockets.on('connection', function (socket) {
        socket.decoded_token.prefix === driverPrefix ? drivers[socket.decoded_token.id] = socket.id : riders[socket.decoded_token.id] = socket.id;
        if (socket.decoded_token.prefix === driverPrefix) {
            //TODO:Well we need to know the size!
            //operatorsNamespace.emit("ChangeDriversOnline", drivers.size);
            mysql.driver.getIsInfoChanged(socket.decoded_token.id).then(function (isChanged) {
                if (isChanged)
                    update.rider(io, socket.decoded_token.id);
            });
        }
        if (socket.decoded_token.prefix === riderPrefix)
            mysql.rider.getIsInfoChanged(socket.decoded_token.id).then(function (isChanged) {
                if (isChanged)
                    update.rider(io, socket.decoded_token.id);
            });
        socket.on('getStatus', async function (callback) {
            if (socket.decoded_token.prefix === driverPrefix) {
                update.driver(io, socket.decoded_token.id);
                let travelId = await mysql.travel.getDriverTravelUnfinished(socket.decoded_token.id);
                if (travelId != null) {
                    let travel = await mysql.getOneRow('travel', {id: travelId});
                    callback(200, travel);
                } else {
                    callback(404);
                }
            } else {
                update.rider(io, socket.decoded_token.id);
                let travelId = await mysql.travel.getRiderTravelUnfinished(socket.decoded_token.id);
                if (travelId != null) {
                    let travel = await mysql.getOneRow('travel', {id: travelId});
                    callback(200, travel);
                } else {
                    callback(404);
                }
            }
        });
        socket.on('disconnect', function () {
            if (socket.decoded_token.prefix === driverPrefix) {
                redis.deleteLocation(socket.decoded_token.id);
                delete drivers[socket.decoded_token.id];
                mysql.driver.setState(socket.decoded_token.id, DRIVER_STATE_OFFLINE);
                operatorsNamespace.emit("ChangeDriversOnline", drivers.size);
            } else {
                delete riders[socket.decoded_token.id];
            }
        });
        socket.on('changeStatus', async function (statusCode, callback) {
            if (statusCode === 'offline')
                await redis.deleteLocation(socket.decoded_token.id);
            if (await mysql.driver.setState(socket.decoded_token.id, statusCode))
                callback(200);
            else
                callback(903);
        });
        socket.on('locationChanged', function (lat, lng) {
            redis.setLocation(socket.decoded_token.id, lat, lng);
        });
        socket.on('calculateFare', async function (pickupPosition, destinationPosition, callback) {
            try {
                let travelDistance = await geo.calculateDistance(pickupPosition, destinationPosition);
                let distanceParsed = await geo.geoParser(travelDistance);
                if (distanceParsed.status !== "OK") {
                    callback(666, distanceParsed.status);
                    return;
                }
                let cats = JSON.parse(JSON.stringify(serviceTree));
                for (let cat of cats)
                    for (let service of cat.services)
                        service['cost'] = await mysql.service.calculateCost(service, distanceParsed.distance.value, distanceParsed.duration.value);
                callback(200, cats);
            } catch (error) {
                if (isNaN(error.message))
                    callback(666, error.message);
                else
                    callback(parseInt(error.message));
            }
        });
        socket.on('requestTaxi', async function (pickupPoint, destinationPoint, pickupLocation, dropOffLocation, serviceId, callback) {
            try {
                let closeDrivers = await redis.getCloseDrivers(pickupPoint);
                let driverIds = closeDrivers.map(x => parseInt(x[0]));
                if (driverIds.length < 1) {
                    callback(404);
                    return;
                }
                let driversOnline = await mysql.driver.getDriversOnline(driverIds);
                if (driversOnline.length < 1) {
                    callback(404);
                    return;
                }
                let [driversWithService, travelMetrics] = await Promise.all([mysql.driver.getDriversWithService(driversOnline, serviceId),
                    geo.geoParser(await geo.calculateDistance(pickupPoint, destinationPoint))]);
                if (driversWithService.length < 1) {
                    callback(303);
                    return;
                }
                if (travelMetrics.status !== "OK") {
                    callback(666, travelMetrics.status);
                    return;
                }

                let service = await mysql.service.getServuceByIdFromTree(serviceId);
                let cost = await mysql.service.calculateCost(service, travelMetrics.distance.value, travelMetrics.duration.value);
                const travel = await mysql.travel.insert(socket.decoded_token.id, pickupPoint, destinationPoint, pickupLocation, dropOffLocation, travelMetrics.distance.value, travelMetrics.duration.value, cost);
                if (driversWithService.length > 1)
                    mysql.travel.setStateByTravelId(travel.id, TRAVEL_STATE_FOUND);
                else {
                    if (Object.keys(drivers).length > 1)
                        mysql.travel.setStateByTravelId(travel.id, TRAVEL_STATE_NOT_FOUND);
                    else
                        mysql.travel.setStateByTravelId(travel.id, TRAVEL_STATE_NO_CLOSE_FOUND);
                }
                for (let driver of driversWithService) {
                    let distance = 0;
                    for (let d of closeDrivers)
                        if (parseInt(d[0]) === driver)
                            distance = parseInt(d[1]);
                    io.to(drivers[driver]).emit('requestReceived', travel, travelMetrics.distance.value, distance, parseFloat(cost));
                }
                callback(200, driversWithService.length);
                socket.travelId = travel.id;
            }
            catch (err) {
                const errorNum = parseInt(err.message);
                if (errorNum && errorNum > 0)
                    callback(errorNum);
                else
                    callback(666, err.message);
            }
        });
        socket.on('driverAccepted', async function (travelId) {
            let [ignored, ignored1, driver, riderId] = await Promise.all([
                mysql.driver.setState(socket.decoded_token.id, DRIVER_STATE_IN_SERVICE),
                mysql.travel.setStateByTravelId(travelId, TRAVEL_STATE_DRIVER_ACCEPTED),
                mysql.getOneRow('driver', {id: socket.decoded_token.id}),
                mysql.travel.getRiderId(travelId)]);
            socket.riderId = riderId;
            let [travel, driverLocation] = await Promise.all([
                mysql.travel.getById(travelId),
                redis.getPosition(driver.id)
            ]);
            let driverDistance = await geo.geoParser(await geo.calculateDistance({
                y: driverLocation[0][1],
                x: driverLocation[0][0]
            }, travel.pickup_point));
            if (driverDistance.status === "OK")
                io.to(riders[riderId]).emit('driverAccepted', driver, driverDistance.distance.value, driverDistance.duration.value, travel.cost_best);
            else
                io.to(riders[riderId]).emit('driverAccepted', driver, 0, 0, travel.cost_best);
        });
        socket.on('riderAccepted', async function (driverId) {
            let [ignored, ignored2, ignored3, travel, riderInfo] = await Promise.all([
                mysql.travel.setDriver(socket.travelId, driverId),
                mysql.driver.setState(driverId, DRIVER_STATE_IN_SERVICE),
                mysql.travel.setStateByUserId(socket.decoded_token.prefix, socket.decoded_token.id, TRAVEL_STATE_RIDER_ACCEPTED),
                mysql.travel.getById(socket.travelId),
                mysql.rider.getProfile(socket.decoded_token.id)
            ]);
            io.to(drivers[driverId]).emit('riderAccepted', travel, riderInfo);
        });
        socket.on('buzz', async function () {
            io.to(riders[socket.riderId]).emit('driverInLocation');
        });
        socket.on('callRequest', async function (callback) {
            let callData;
            if (socket.decoded_token.prefix === driverPrefix)
                callData = await mysql.driver.getContactInformation(socket.decoded_token.id);
            else
                callData = await mysql.rider.getContactInformation(socket.decoded_token.id);
            redis.addCallRequest(callData, socket.decoded_token.prefix.substring(0, socket.decoded_token.prefix.length - 1));
            operatorsNamespace.emit('callRequested', callData);
            callback(200);
        });
        socket.on('startTravel', async function () {
            let [ignored, riderId, ignored1] = await Promise.all([
                mysql.travel.setStateByUserId(socket.decoded_token.prefix, socket.decoded_token.id, TRAVEL_STATE_STARTED),
                mysql.travel.getRiderIdByDriverId(socket.decoded_token.id),
                mysql.travel.getTravelIdByDriverId(socket.decoded_token.id)
            ]);
            io.to(riders[riderId]).emit('startTravel');
        });
        socket.on('finishedTaxi', async function (cost, time, distance, log, callback) {
            let [ignored, riderId, travelId] = await Promise.all([
                mysql.driver.setState(socket.decoded_token.id, DRIVER_STATE_ONLINE),
                mysql.travel.getRiderIdByDriverId(socket.decoded_token.id),
                mysql.travel.getTravelIdByDriverId(socket.decoded_token.id),
            ]);
            let riderBalance = await mysql.rider.getBalance(riderId);
            let paid = false;
            if (riderBalance >= cost) {
                let [ignored3, ignored4] = await Promise.all([
                    mysql.driver.chargeAccount(socket.decoded_token.id, 'travel', '', (cost * (100 - process.env.PERCENT_FOR_COMPANY)) / 100)]);
                mysql.rider.chargeAccount(riderId, 'travel', '', -cost);
                paid = true;
            }
            else if (process.env.CASH_PAYMENT_REDUCES_DRIVER_CREDIT === 'true') {
                await mysql.driver.chargeAccount(socket.decoded_token.id, 'commission', '', -(cost * (process.env.PERCENT_FOR_COMPANY / 100)));
            }
            await mysql.travel.finish(travelId, paid, cost, time, distance, log);
            callback(200, paid, cost);
            update.driver(io, socket.decoded_token.id);
            update.rider(io, riderId);
            io.to(riders[riderId]).emit('finishedTaxi', 200, paid, cost);
        });
        socket.on('cancelTravel', async function (callback) {
            let [ignored, otherPartyId, ignored2] = await Promise.all([
                mysql.travel.cancel(socket.decoded_token.prefix, socket.decoded_token.id),
                socket.decoded_token.prefix === driverPrefix ? mysql.travel.getRiderIdByDriverId(socket.decoded_token.id) : mysql.travel.getDriverIdByRiderId(socket.decoded_token.id),
                mysql.driver.setState(socket.decoded_token.id, DRIVER_STATE_ONLINE)
            ]);
            let connectionId = (socket.decoded_token.prefix === driverPrefix ? riders[otherPartyId] : drivers[otherPartyId]);
            io.to(connectionId).emit('cancelTravel');
            callback(200);
        });
        socket.on('reviewDriver', async function (score, review, callback) {
            let [travelId, driverId] = await Promise.all([mysql.travel.getTravelIdByRiderId(socket.decoded_token.id), mysql.travel.getDriverIdByRiderId(socket.decoded_token.id)]);
            await Promise.all([mysql.driver.updateScore(driverId, score),
                mysql.driver.saveReview(travelId, driverId, review, score)]);
            callback(200);
        });
        socket.on('getTravels', async function (callback) {
            let result;
            if (socket.decoded_token.prefix === driverPrefix)
                result = await mysql.driver.getTravels(socket.decoded_token.id);
            else
                result = await mysql.rider.getTravels(socket.decoded_token.id);
            callback(200, result);
        });
        socket.on('editProfile', async function (user, callback) {
            try {
                await mysql.updateRow(socket.decoded_token.prefix, JSON.parse(user), socket.decoded_token.id);
                callback(200);
            }
            catch (err) {
                callback(666, err);
            }
        });
        socket.on('changeProfileImage', async function (buffer, callback) {
            try {
                let mediaId = await mysql.insertRow('media', {type: socket.decoded_token.prefix + ' image'});
                let mediaRow = await mysql.media.doUpload(buffer, mediaId);
                await mysql.updateRow(socket.decoded_token.prefix, {media_id: mediaId}, socket.decoded_token.id);
                callback(200, mediaRow);
            } catch (error) {
                callback(666, error);
            }

        });
        socket.on('changeHeaderImage', async function (buffer, callback) {
            try {
                let mediaId = await mysql.insertRow('media', {type: socket.decoded_token.prefix + ' header'});
                let mediaRow = await mysql.media.doUpload(buffer, mediaId);
                await mysql.updateRow(socket.decoded_token.prefix, {car_media_id: mediaId}, socket.decoded_token.id);
                callback(200, mediaRow);
            } catch (error) {
                callback(666, error);
            }
        });
        socket.on('travelInfo', async function (distance, duration, cost) {
            let location = await redis.getPosition(socket.decoded_token.id);
            let riderId = await mysql.travel.getRiderIdByDriverId(socket.decoded_token.id);
            io.to(riders[riderId]).emit('travelInfoReceived', distance, parseInt(duration), parseFloat(cost), parseFloat(location[0][1]), parseFloat(location[0][0]));
        });
        socket.on('getDriversLocation', async function (point, callback) {
            let result = await redis.getCloseDrivers(point);
            callback(200, result);
        });
        socket.on('chargeAccount', async function (type, token, amount, callback) {
            try {
                if (type === 'stripe') {
                    /** @namespace stripe.charges */
                    const stripeCharge = await stripe.charges.create({
                        amount: amount * 100,
                        currency: process.env.PAYMENT_CURRENCY,
                        source: token,
                    });
                }
                if (socket.decoded_token.prefix === riderPrefix) {
                    await mysql.rider.chargeAccount(socket.decoded_token.id, type, token, amount);
                    await update.rider(io, socket.decoded_token.id);
                } else {
                    await mysql.driver.chargeAccount(socket.decoded_token.id, type, token, amount);
                    await update.driver(io, socket.decoded_token.id);
                }
                const giftPer = parseInt(process.env.CREDIT_GIFT_STEPS);
                if (amount > giftPer) {
                    let gift = (amount / giftPer) * parseInt(process.env.CREDIT_GIFT_AMOUNT);
                    if (socket.decoded_token.prefix === riderPrefix)
                        await mysql.rider.chargeAccount(riderId, 'gift', '-', gift);
                    else
                        await mysql.driver.chargeAccount(riderId, 'gift', '-', gift);
                }
                callback(200);
            } catch (error) {
                callback(666, error.message);
            }
        });
        socket.on('getStats', async function (timeQuery, callback) {
            let stats, report;
            switch (timeQuery) {
                case TIME_QUERY_DAILY:
                    [stats, report] = await Promise.all(
                        [
                            mysql.driver.getDailyStats(socket.decoded_token.id),
                            mysql.driver.getDailyReport(socket.decoded_token.id)
                        ]);
                    break;
                case TIME_QUERY_WEEKLY:
                    [stats, report] = await Promise.all(
                        [
                            mysql.driver.getWeeklyStats(socket.decoded_token.id),
                            mysql.driver.getWeeklyReport(socket.decoded_token.id)
                        ]);
                    break;

                case TIME_QUERY_MONTHLY:
                    [stats, report] = await Promise.all(
                        [
                            mysql.driver.getMonthlyStats(socket.decoded_token.id),
                            mysql.driver.getMonthlyReport(socket.decoded_token.id)
                        ]);
                    break;
                default:
                    callback(401, '', '');
                    break;
            }
            callback(200, stats[0][0], report[0]);
        });

        socket.on('requestPayment', async function (callback) {
            let [hasPending, driverInfo] = await Promise.all([mysql.payments.driverHasPending(socket.decoded_token.id), mysql.payments.getDriverUnpaidAmount(socket.decoded_token.id)]);
            if (hasPending) {
                callback(901);
                return;
            }
            if (parseInt(driverInfo.balance) < parseInt(process.env.MINIMUM_AMOUNT_TO_REQUEST_PAYMENT)) {
                callback(902);
                return;
            }
            /** @namespace driverInfo.balance */
            /** @namespace driverInfo.account_number */
            await mysql.payments.requestPayment(socket.decoded_token.id, driverInfo.balance, driverInfo.account_number);
            callback(200);
            update.operatorStats();
        });
        socket.on('hideTravel', async function (travelId, callback) {
            let result = await mysql.travel.hideTravel(travelId);
            if (result)
                callback(200);
            else
                callback(666);
        });
        socket.on('writeComplaint', async function (travelId, subject, content, callback) {
            await mysql.insertRow('complaint', {
                travel_id: travelId,
                requested_by: socket.decoded_token.prefix,
                subject: subject,
                content: content
            });
            callback(200);
        });
        socket.on('crudAddress', async function (mode, address, callback) {
            let result = await mysql.address.crud(mode, address, socket.decoded_token.id);
            callback(200, result);
        });
    });
    return io;
};