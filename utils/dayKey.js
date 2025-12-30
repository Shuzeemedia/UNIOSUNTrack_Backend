// backend/utils/dayKey.js

const getLocalDayKey = (date = new Date()) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0); // normalize to local day
    return d.toISOString().split("T")[0]; // YYYY-MM-DD
};

module.exports = { getLocalDayKey };
