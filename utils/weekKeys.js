const { getLocalDayKey } = require("../utils/dayKey");


const getWeekDayKeys = (date = new Date()) => {
  const base = new Date(date);
  base.setHours(0, 0, 0, 0);

  const day = base.getDay(); // 0–6
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((day + 6) % 7));

  const keys = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    keys.push(getLocalDayKey(d));
  }

  return keys;
};
module.exports = { getWeekDayKeys };
