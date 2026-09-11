const AppSettings = require("../models/appSettings.entity");

const SINGLETON_ID = "global";

// One shared settings document, created with defaults on first read so
// there's never a "missing settings" case to handle elsewhere.
async function getSettings() {
  const settings = await AppSettings.findByIdAndUpdate(
    SINGLETON_ID,
    { $setOnInsert: { _id: SINGLETON_ID } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return settings;
}

async function updateSettings(patch) {
  const settings = await AppSettings.findByIdAndUpdate(
    SINGLETON_ID,
    { $set: patch },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
  return settings;
}

module.exports = { getSettings, updateSettings };
