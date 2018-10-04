module.exports = {
    getAll: async function (userId) {
        let [result, ignored] = await sql.query("SELECT * FROM rider_address WHERE rider_id = ?", [userId]);
        //result.map(x=>x.location = [x.location.y,x.location.x]);
        return result;
    },
    insert: async function (riderId, address) {
        let [result, ignored] = await sql.query("INSERT INTO rider_address (rider_id, title, address, location) VALUES (?, ?, ?, ST_GeomFromText(?))", [riderId, address.title, address.address, getPointTextFromArray(address.location)]);
        return true;
    },
    update: async function (address) {
        let [result, ignored] = await sql.query("UPDATE rider_address SET title = ?, address = ?, location = ST_GeomFromText(?) WHERE id = ?", [address.title, address.address, getPointTextFromArray(address.location), address.id]);
        return true;
    },
    delete: async function (address) {
        let [result, ignored] = await sql.query("DELETE FROM rider_address WHERE id = ?", [address.id]);
        return true;
    },
    crud: async function (mode, address, userId) {
        let result;
        switch (mode) {
            case(0):
                result = await this.insert(userId,address);
                break;
            case(1):
                result = await this.getAll(userId);
                break;
            case(2):
                result = await this.update(address);
                break;
            case(3):
                result = await this.delete(address);
                break;
        }
        return result;
    }
};