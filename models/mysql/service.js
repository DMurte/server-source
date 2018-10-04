module.exports = {
    getDriversWithServiceType: async function (serviceId) {
        /** @namespace x.driver_id */
        let [result, ignored] = await sql.query("SELECT driver_id FROM driver_service WHERE service_id = ?", [serviceId]);
        return result.map(x => x.driver_id);
    },
    getServicesTree: async function () {
        let [categories, ignored] = await sql.query("SELECT id AS cat_id, title AS cat_title FROM service_category");
        for (let category of categories) {
            /** @namespace category.cat_id */
            let [services, ingored] = await sql.query("SELECT service.* FROM service WHERE service_category_id = ?", [category.cat_id]);
            for (let service of services) {
                if (service.media_id == null)
                    continue;
                let [media, ignored] = await sql.query("SELECT * FROM media WHERE id = ?", [service.media_id]);
                service['media'] = media[0];
            }
            category['services'] = services;

        }
        return categories;
    },
    calculateCost: async function (service, distance, duration) {
        let baseCost = (((distance / 100) * service.per_hundred_meters) + (service.base_fare) + ((duration / 60) * service.per_minute_passed));
        const roundFactor = parseFloat(process.env.ROUND_FACTOR);
        let cost = baseCost + (roundFactor - (baseCost % roundFactor));
        return cost;
    },
    getServuceByIdFromTree: async function (serviceId) {
        for (let category of serviceTree)
            for (let service of category.services)
                if (service.id == serviceId)
                    return service;
    }
};