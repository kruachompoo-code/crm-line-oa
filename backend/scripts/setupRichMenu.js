require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const axios = require('axios');

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const headers = { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' };

// Rich Menu: 3 columns
// [สั่งอาหาร (walk-in)] [จองโต๊ะ (reservation)] [จองหมู่คณะ (group)]
const richMenu = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: 'CRM Main Menu v2',
  chatBarText: '☰ เมนูบริการ',
  areas: [
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: {
        type: 'uri', label: '🍽️ สั่งอาหาร',
        uri: `${process.env.LIFF_URL_WALKIN || 'https://liff.line.me/LIFF_ID_WALKIN'}?branch=1`
      }
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: {
        type: 'uri', label: '📅 จองโต๊ะ',
        uri: process.env.LIFF_URL_RESERVATION || 'https://liff.line.me/LIFF_ID_RESERVATION'
      }
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: {
        type: 'uri', label: '🎉 จองหมู่คณะ',
        uri: process.env.LIFF_URL_GROUP || 'https://liff.line.me/LIFF_ID_GROUP'
      }
    }
  ]
};

async function setup() {
  try {
    // Delete existing rich menus
    const existing = await axios.get('https://api.line.me/v2/bot/richmenu/list', { headers });
    for (const rm of existing.data.richmenus || []) {
      await axios.delete(`https://api.line.me/v2/bot/richmenu/${rm.richMenuId}`, { headers });
      console.log('Deleted:', rm.richMenuId);
    }

    const { data: { richMenuId } } = await axios.post(
      'https://api.line.me/v2/bot/richmenu', richMenu, { headers }
    );
    console.log('✅ Created Rich Menu:', richMenuId);

    await axios.post(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {}, { headers });
    console.log('✅ Set as default for all users');

    console.log(`\n📌 Upload rich menu image:\ncurl -X POST https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: image/jpeg" \\\n  --data-binary @rich_menu.jpg`);
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}

setup();
