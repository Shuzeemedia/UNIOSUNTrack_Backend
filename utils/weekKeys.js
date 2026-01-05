// backend/utils/weekKeys.js

const { getLocalDayKey } = require("../utils/dayKey");

const getWeekDayKeys = (date = new Date()) => {
    const base = new Date(date);

    const lagosDate = new Date(
        new Intl.DateTimeFormat("en-US", {
            timeZone: "Africa/Lagos",
            year: "numeric",
            month: "numeric",
            day: "numeric",
        }).format(base)
    );

    const day = lagosDate.getDay(); // 0–6
    const monday = new Date(lagosDate);
    monday.setDate(lagosDate.getDate() - ((day + 6) % 7));

    const keys = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        keys.push(getLocalDayKey(d));
    }

    return keys;
};

module.exports = { getWeekDayKeys };
