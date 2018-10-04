const mysql = require('../models/mysql');
module.exports = {
    driver: async function(io,driverId){
        await mysql.driver.updateInfoChangedStatus(driverId, true);
        if (drivers[driverId]) {
            let profile = await mysql.driver.getProfile(driverId);
            io.to(drivers[driverId]).emit('driverInfoChanged', profile);
            mysql.driver.updateInfoChangedStatus(driverId, false);
        }
    },
    rider:async function(io,riderId){
        await mysql.rider.updateInfoChangedStatus(riderId, true);
        if (riders[riderId]) {
            let profile = await mysql.rider.getProfile(riderId);
            io.to(riders[riderId]).emit('riderInfoChanged', profile);
            mysql.rider.updateInfoChangedStatus(riderId, false);
        }
    },
    operatorStats:async function() {
        if (baseData.length === 0) {

        }
        /** @namespace baseData.unpaid_count */
        /** @namespace baseData.waiting_complaints */
        //operatorsNamespace.emit("alertsCountChanged", baseData.waiting_complaints, baseData.unpaid_count);
    },
    init:async function(){
        this.operatorStats();
        serviceTree = await mysql.service.getServicesTree();
    }
};