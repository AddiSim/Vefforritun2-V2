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
      home_team.name AS home_name,
      home_score,
      away_team.name AS away_name,
      away_score
    FROM
      games
    LEFT JOIN
      teams AS home_team ON home_team.id = games.home
    LEFT JOIN
      teams AS away_team ON away_team.id = games.away
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
          name: row.home_name,
          score: row.home_score,
        },
        away: {
          name: row.away_name,
          score: row.away_score,
        },
      };
      games.push(game);
    }

    return games;
  }
}

export async function calculateStandings() {
  const queryText = `
    SELECT
      ht.name AS home_name,
      g.home_score,
      at.name AS away_name,
      g.away_score
    FROM
      games g
    LEFT JOIN
      teams ht ON ht.id = g.home
    LEFT JOIN
      teams at ON at.id = g.away
  `;

  try {
    const result = await query(queryText);
    const standingsObj = {};

    
    result.rows.forEach(row => {
      const homeTeam = row.home_name;
      const awayTeam = row.away_name;

      // Initialize if not exists
      if (!standingsObj[homeTeam]) standingsObj[homeTeam] = { name: homeTeam, wins: 0, draws: 0, losses: 0, points: 0 };
      if (!standingsObj[awayTeam]) standingsObj[awayTeam] = { name: awayTeam, wins: 0, draws: 0, losses: 0, points: 0 };

      
      if (row.home_score > row.away_score) {
        standingsObj[homeTeam].wins++;
        standingsObj[homeTeam].points += 3;
        standingsObj[awayTeam].losses++;
      } else if (row.home_score < row.away_score) {
        standingsObj[awayTeam].wins++;
        standingsObj[awayTeam].points += 3;
        standingsObj[homeTeam].losses++;
      } else {
        standingsObj[homeTeam].draws++;
        standingsObj[awayTeam].draws++;
        standingsObj[homeTeam].points += 1;
        standingsObj[awayTeam].points += 1;
      }
    });

    const standingsArray = Object.values(standingsObj).sort((a, b) => b.points - a.points || b.wins - a.wins); // Sort by points, then wins

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

export function insertGame(date, home_name, away_name, home_score, away_score) {
  const q =
    'insert into games (date, home, away, home_score, away_score) values ($1, $2, $3, $4, $5);';

  const result = query(q, [date, home_name, away_name, home_score, away_score]);
}

export async function insertUsers() {
  const insertQuery = `
    INSERT INTO users (id, username, name, password, admin)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO NOTHING;
  `;

  for (const user of records) {
    const {id, username, name, password, admin } = user;
    try {
      await pool.query(insertQuery, [id, username, name, password, admin]);
      console.log('User inserted successfully');
    } catch (error) {
      console.error('Error inserting user ', error)
    }
  }
}

insertUsers().catch(console.error);

export async function end() {
  await pool.end();
}
