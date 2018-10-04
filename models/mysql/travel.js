global.TRAVEL_STATE_REQUESTED = 'requested';
global.TRAVEL_STATE_NOT_FOUND = 'not found';
global.TRAVEL_STATE_NO_CLOSE_FOUND = 'no close found';
global.TRAVEL_STATE_FOUND = 'found';
global.TRAVEL_STATE_DRIVER_ACCEPTED = 'driver accepted';
global.TRAVEL_STATE_RIDER_ACCEPTED = 'rider accepted';
global.TRAVEL_STATE_STARTED = 'travel started';
global.TRAVEL_STATE_FINISHED_CREDIT = 'travel finished credit';
global.TRAVEL_STATE_FINISHED_CASH = 'travel finished cash';
global.TRAVEL_STATE_DRIVER_CANCELED = 'driver canceled';
global.TRAVEL_STATE_RIDER_CANCELED = 'rider canceled';
module.exports = {
    getById: async function (travelId) {
        let result = await sql.query("SELECT * FROM travel WHERE id = ?", [travelId]);
        return result[0][0];
    },
    insert: async function (riderId, pickupPoint, destinationPoint, pickupAddress, destinationAddress, distanceBest, durationBest, costBest) {
        const travel = await sql.query("INSERT INTO travel (rider_id, pickup_point, destination_point, pickup_address, destination_address, distance_best, duration_best,cost_best) VALUES (?, ST_GeomFromText(?), ST_GeomFromText(?), ?, ?, ?, ?,?)", [riderId, getPointTextFromArray(pickupPoint), getPointTextFromArray(destinationPoint), pickupAddress, destinationAddress, distanceBest, durationBest, costBest]);
        return {
            'id': travel[0].insertId,
            'pickup_address': pickupAddress,
            'destination_address': destinationAddress,
            'pickup_point': pickupPoint,
            'destination_point': destinationPoint,
            'distance_best': distanceBest,
            'duration_best': durationBest,
            'cost_best': costBest
        }
    },
    getRiderId: async function (travelId) {
        let [result,ignored] = await sql.query("SELECT rider_id FROM travel WHERE id = ? ORDER BY id DESC LIMIT 1", [travelId]);
        return result[0].rider_id;
    },
    getRiderIdByDriverId: async function (driverId) {
        let [result,ignored] = await sql.query("SELECT rider_id FROM travel WHERE driver_id = ? ORDER BY id DESC LIMIT 1", [driverId]);
        return result[0].rider_id;
    },
    getDriverIdByRiderId: async function (riderId) {
        let [result,ignored] = await sql.query("SELECT driver_id FROM travel WHERE rider_id = ? ORDER BY id DESC LIMIT 1", [riderId]);
        return result[0].driver_id;
    },
    getTravelIdByRiderId: async function (riderId) {
        let [result,ignored] = await sql.query("SELECT id FROM travel WHERE rider_id = ? ORDER BY id DESC LIMIT 1", [riderId]);
        return result[0].id;
    },
    getTravelIdByDriverId: async function (driverId) {
        let [result,ignored] = await sql.query("SELECT id FROM travel WHERE driver_id = ? ORDER BY id DESC LIMIT 1", [driverId]);
        return result[0].id;
    },
    getDriverTravelUnfinished: async function (driverId) {
        let [result,ignored] = await sql.query("SELECT id, status FROM travel WHERE driver_id = ? ORDER BY id DESC LIMIT 1", [driverId]);
        if(result.length > 0 && (result[0].status === 'travel started' || result[0].status === 'rider accepted'))
            return result[0].id;
        else
            return null;
    },
    getRiderTravelUnfinished: async function (riderId) {
        let [result,ignored] = await sql.query("SELECT id, status FROM travel WHERE rider_id = ? ORDER BY id DESC LIMIT 1", [riderId]);
        if(result.length > 0 && (result[0].status === 'travel started' || result[0].status === 'rider accepted'))
            return result[0].id;
        else
            return null;
    },
    getTravelIdByUserId: async function(prefix,userId){
        if(prefix === driverPrefix)
            return await this.getTravelIdByDriverId(userId);
        else
            return await this.getTravelIdByRiderId(userId);
    },
    setStateByUserId: async function (prefix, userId, state) {
        let travelId = await this.getTravelIdByUserId(prefix, userId);
        let [result,ignored] = await sql.query("UPDATE travel SET status = ? WHERE id = ?", [state, travelId]);
        if(state === TRAVEL_STATE_STARTED)
            await sql.query("UPDATE travel SET start_timestamp = CURRENT_TIMESTAMP WHERE id = ?",[travelId]);
        return result.affectedRows;
    },
    setStateByTravelId: async function (travelId, state) {
        let [result,ignored] = await sql.query("UPDATE travel SET status = ? WHERE id = ?", [state, travelId]);
        return result.affectedRows;
    },
    cancel: async function (prefix, userId) {
        let travelId = await this.getTravelIdByUserId(prefix, userId);
        let [result,ignored] = await sql.query("UPDATE travel SET status = ?, finish_timestamp = CURRENT_TIMESTAMP WHERE id = ?", [prefix + ' canceled', travelId]);
        return result.affectedRows;
    },
    setDriver: async function (travelId, driverId) {
        let [result,ignored] = await sql.query("UPDATE travel SET status = 'rider accepted', driver_id = ? WHERE id = ?", [driverId, travelId]);
        return result.affectedRows;
    },
    finish: async function (travelId, isPaidInCredit, cost, distance, time, log) {
        let [result,ignored] = await sql.query("UPDATE travel SET status = ?, cost = ?, duration_real = ?,distance_real = ?, log= ?, finish_timestamp = CURRENT_TIMESTAMP WHERE id = ?", [isPaidInCredit ? TRAVEL_STATE_FINISHED_CREDIT : TRAVEL_STATE_FINISHED_CASH, cost, time, distance, log, travelId]);
        return result.affectedRows;
    },
    hideTravel: async function (travelId) {
        let result = await sql.query("UPDATE travel SET is_hidden = TRUE WHERE id = ?", [travelId]);
        return result[0].affectedRows === 1;
    }
};
