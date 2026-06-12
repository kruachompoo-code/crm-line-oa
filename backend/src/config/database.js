const { Pool } = require('pg');

const pool = new Pool(
    process.env.DATABASE_URL
      ? {
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.DATABASE_URL.includes('railway.internal')
                  ? false
                            : { rejectUnauthorized: false },
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000,
      }
      : {
                host:     process.env.DB_HOST || 'localhost',
                port:     parseInt(process.env.DB_PORT || '5432'),
                database: process.env.DB_NAME || 'crm_line_oa',
                user:     process.env.DB_USER || 'postgres',
                password: process.env.DB_PASSWORD || 'postgres123',
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000,
      }
  );

pool.on('error', (err) => {
    console.error('Unexpected DB error', err);
});

const query  = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
