const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SETTINGS_FILE = path.join(__dirname, 'user-settings.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/settings', async (req, res) => {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.json([]);
  }
});

app.post('/api/settings', async (req, res) => {
  const newSetting = req.body;
  if (!newSetting.userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  let settings = [];
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf8');
    settings = JSON.parse(data);
  } catch (err) {
    // ignore missing file
  }

  const index = settings.findIndex(s => s.userId === newSetting.userId);
  if (index >= 0) {
    settings[index] = newSetting;
  } else {
    settings.push(newSetting);
  }

  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
