import pg from 'pg';
import { environment } from './environment.js';
import { logger } from './logger.js';
import { records } from './users.js';

const env = environment(process.env, logger);

if (!env?.connectionString) {
  logger.error('Connection string is missing.');
  process.exit(-1);
}

// Adjusted to include SSL connection setup for Render.com databases
const pool = new pg.Pool({
  connectionString: env.connectionString,
  ssl: {
    rejectUnauthorized: false, // Note: For development purposes only; for production, consider more secure handling of SSL
  },
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export async function query(q, values = []) {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(q, values);
    return result;
  } catch (e) {
    logger.error('Query failed', e, q, values);
    throw e; // Rethrowing the error for caller to handle
  } finally {
    if (client) client.release();
  }
}

export async function getGames() {
  const q = `
    SELECT
      date,
      home_team.name AS "homename",
      "homescore",
      away_team.name AS "awayname",
      "awayscore"
    FROM
      games
    LEFT JOIN
      teams AS home_team ON home_team.id = games."homename"
    LEFT JOIN
      teams AS away_team ON away_team.id = games."awayname"
    WHERE
      date <= CURRENT_DATE
      AND date >= CURRENT_DATE - INTERVAL '2 months'
    ORDER BY date DESC
  `;

  const result = await query(q);

  const games = [];
  if (result && (result.rows?.length ?? 0) > 0) {
    for (const row of result.rows) {
      const game = {
        date: row.date,
        home: {
          name: row.homename,
          score: row.homescore,
        },
        away: {
          name: row.awayname,
          score: row.awayscore,
        },
      };
      games.push(game);
    }

    return games;
  }
  return [];
}

export async function calculateStandings() {
  const queryText = `
    SELECT
      ht.name AS "homename",
      g."homescore",
      at.name AS "awayname",
      g."awayscore"
    FROM
      games g
    LEFT JOIN
      teams ht ON ht.id = g."homename"
    LEFT JOIN
      teams at ON at.id = g."awayname"
  `;

  try {
    const result = await query(queryText);
    const standingsObj = {};

    
    result.rows.forEach(row => {
      const homeTeam = row.homename;
      const awayTeam = row.awayname;

      // Initialize if not exists
      if (!standingsObj[homeTeam]) standingsObj[homeTeam] = 
        { name: homeTeam, wins: 0, draws: 0, losses: 0, points: 0 };
      if (!standingsObj[awayTeam]) standingsObj[awayTeam] = 
        { name: awayTeam, wins: 0, draws: 0, losses: 0, points: 0 };

      
      if (row.homescore > row.awayscore) {
        standingsObj[homeTeam].wins+= 1;
        standingsObj[homeTeam].points += 3;
        standingsObj[awayTeam].losses+= 1;
      } else if (row.homescore < row.awayscore) {
        standingsObj[awayTeam].wins+= 1;
        standingsObj[awayTeam].points += 3;
        standingsObj[homeTeam].losses+= 1;
      } else {
        standingsObj[homeTeam].draws+= 1;
        standingsObj[awayTeam].draws+= 1;
        standingsObj[homeTeam].points += 1;
        standingsObj[awayTeam].points += 1;
      }
    });

    const standingsArray = Object.values(standingsObj).sort((a, b) => 
      b.points - a.points || b.wins - a.wins); 

    return standingsArray;

  } catch (error) {
    console.error('Error calculating standings:', error);
    throw error; 
  }
}

export async function getAllTeams() {
  const queryText = 'SELECT id, name FROM public.teams ORDER BY name;';
  try {
    const result = await pool.query(queryText);
    return result.rows; 
  } catch (err) {
    console.error('Error fetching teams:', err);
    throw err;
  }
}

export function insertGame(date, homename, awayname, homescore, awayscore) {
  const q =
    'insert into games (date, homename, awayname, homescore, awayscore) values ($1, $2, $3, $4, $5);';

  query(q, [date, homename, awayname, homescore, awayscore]);
}

export async function insertUsers() {
  const insertQuery = `
    INSERT INTO users (id, username, password, name, admin)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO NOTHING;
  `;

  const client = await pool.connect();

  try {
    await client.query('BEGIN'); 

    for (const user of records) {
      const { id, username, name, password, admin } = user;
      client.query(insertQuery, [id, username, name, password, admin]);
    }

    await client.query('COMMIT'); 
  } catch (error) {
    await client.query('ROLLBACK'); 
    console.error('Error inserting users', error);
  } finally {
    client.release(); 
  }
}


insertUsers()
  .catch(console.error);


export async function end() {
  await pool.end();
}
