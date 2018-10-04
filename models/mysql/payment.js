module.exports = {
    async driverHasPending(driverId) {
        let [result,ignored] = await sql.query("SELECT id FROM payment_request WHERE driver_id = ? AND status = 'pending'", [driverId]);
        return result.length > 0;
    },
    getDriverUnpaidAmount: async function (driverId) {
        let [result,ignored] = await sql.query("SELECT balance,account_number FROM driver WHERE id = ?", [driverId]);
        return result[0];
    },
    requestPayment: function (driverId, amount, accountNumber) {
        return sql.query("INSERT INTO payment_request (driver_id,amount,account_number) VALUES (?,?,?)", [driverId, amount, accountNumber])
    }
};