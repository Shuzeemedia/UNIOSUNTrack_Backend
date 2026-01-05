// backend/utils/monthKeys.js

const { getLocalDayKey } = require("../utils/dayKey");

const getMonthDayKeys = (year, month) => {
    const keys = [];
    let date = new Date(Date.UTC(year, month, 1));

    while (date.getUTCMonth() === month) {
        keys.push(getLocalDayKey(date));
        date.setUTCDate(date.getUTCDate() + 1);
    }

    return keys;
};

module.exports = { getMonthDayKeys };
