require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../src/config/database');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Seed branches
    await client.query(`
      INSERT INTO branches (name, address, phone, opening_hours)
      VALUES
        ('สาขาสยาม', 'ชั้น 4 สยามพารากอน กรุงเทพ', '02-xxx-1001', '10:00-22:00'),
        ('สาขาอโศก', 'ชั้น 2 เทอร์มินัล 21 กรุงเทพ', '02-xxx-1002', '10:00-22:00'),
        ('สาขาลาดพร้าว', 'ชั้น 3 เซ็นทรัล ลาดพร้าว', '02-xxx-1003', '10:00-22:00')
      ON CONFLICT DO NOTHING
    `);

    // Seed menu items
    await client.query(`
      INSERT INTO menu_items (branch_id, name, description, price, category, image_url)
      VALUES
        (1,'สเต็กเนื้อออสเตรเลีย','เนื้อวากิวย่างไฟ ซอสพริกไทยดำ',389,'main',NULL),
        (1,'ปลาแซลมอนย่าง','แซลมอนนอร์เวย์ ซอสมิโซบัตเตอร์',299,'main',NULL),
        (1,'สลัดซีฟู้ด','อาหารทะเลสด ผักกรอบ',199,'appetizer',NULL),
        (1,'ชาเย็นไทย','ชาไทยเข้มข้น นมสด',89,'drink',NULL),
        (1,'ไก่ทอดกระเทียม','ไก่ชิ้นใหญ่ กระเทียมกรอบ',149,'main',NULL)
      ON CONFLICT DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('✅ Seed complete');
  } catch(e) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}

seed();
