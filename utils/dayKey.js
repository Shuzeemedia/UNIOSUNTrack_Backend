// backend/utils/dayKey.js

const getLocalDayKey = (date = new Date()) => {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Lagos",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(date)); // YYYY-MM-DD
};

module.exports = { getLocalDayKey };
