const { getLocalDayKey } = require("../utils/dayKey");


const getMonthDayKeys = (year, month) => {
  const keys = [];
  const date = new Date(year, month, 1);

  while (date.getMonth() === month) {
    keys.push(getLocalDayKey(date));
    date.setDate(date.getDate() + 1);
  }

  return keys;
};

module.exports = { getMonthDayKeys };
