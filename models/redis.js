const redisObject = require('redis');
const bluebird = require('bluebird');
bluebird.promisifyAll(redisObject.RedisClient.prototype);
bluebird.promisifyAll(redisObject.Multi.prototype);
const redis = redisObject.createClient(process.env.REDIS_PORT, process.env.REDIS_HOST);
if(process.env.REDIS_PASSWORD)
    redis.auth(process.env.REDIS_PASSWORD);
redis.on("connect", function () {
    console.log('Redis Connected');
});
redis.on("Error", function (err) {
    console.log(err);
});
module.exports = {
    getPosition: async function (driverId) {
        return await redis.geoposAsync('drivers', driverId);
    },
    getCloseDrivers: async function (position) {
        return await redis.georadiusAsync('drivers',position.x,position.y,process.env.MAX_DISTANCE_TO_SEND_REQUEST,'m','WITHDIST','WITHCOORD');
    },
    getAllDrivers:async function(position){
        return await redis.georadiusAsync('drivers',position.x,position.y,'22000','km','WITHDIST','WITHCOORD');
    },
    setLocation: async function (userId, lat, lng) {
        await redis.geoaddAsync('drivers', lng, lat, userId);
    },
    deleteLocation: async function (userId) {
        await redis.zremAsync('drivers', userId);
    },
    addCallRequest: async function (callData,from) {
        redis.hmsetAsync('complaint:' + callData.id, ['id', callData.id, 'driverNumber', callData.driverNumber, 'driverName', callData.driverName ? callData.driverName : "Unknown", 'riderNumber', callData.riderNumber, 'riderName', callData.riderName ? callData.riderName : "Unknown",'from',from]);
        redis.expireAsync('complaint:' + callData.id, 150);
    },
    getCallRequests: async function (from, pageSize) {
        let keys = await redis.keysAsync('complaint:*');
        let result = [];
        for (key of keys) {
            result.push(redis.hgetallAsync(key));
        }
        return result;
    },
    deleteCallRequests: async function (Ids) {
        Ids = Ids.map(x => 'complaint:' + x);
        return redis.delAsync(Ids);
    }
};


