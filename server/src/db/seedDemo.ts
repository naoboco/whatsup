// Force l'ajout des exemples étiquetés « Démo » dans toutes les veilles (utile pour une présentation).
process.env.DEMO_MODE = 'on';
const { migrate } = await import('./migrate.js');
const { bootstrap, ensureDemoContent } = await import('./bootstrap.js');
const { pool } = await import('./pool.js');
await migrate();
await bootstrap();
await ensureDemoContent();
await pool.end();
