import express from 'express';
import passport from 'passport';
import xss from 'xss';
import { formatISO, subMonths, isBefore, isAfter } from 'date-fns';
import { insertGame, getAllTeams } from '../lib/db.js';



export const adminRouter = express.Router();

async function indexRoute(req, res) {
  return res.render('login', {
    title: 'Innskráning',
  });
}

async function adminRoute(req, res) {
  const user = req.user ?? null;
  const loggedIn = req.isAuthenticated();
  const teams = await getAllTeams();

  return res.render('admin', {
    title: 'Admin upplýsingar, mjög leynilegt',
    user,
    loggedIn,
    teams,
  });
}

// TODO færa á betri stað
// Hjálpar middleware sem athugar hvort notandi sé innskráður og hleypir okkur
// þá áfram, annars sendir á /login
function ensureLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }

  return res.redirect('/login');
}

function skraRoute(res) {
  return res.render('skra', {
    title: 'Skrá leik',
  });
}

async function skraRouteInsert(req, res) {
  let {date ,homeName, awayName, homeScore, awayScore} = req.body;
  date = xss(date);
  homeName = xss(homeName);
  homeScore = xss(homeScore);
  awayName = xss(awayName);
  awayScore = xss(awayScore);

  const today = new Date();
  const twoMonthsAgo = subMonths(new Date(), 2);
  const submittedDate = new Date(date);

  // Ensure the game date is not in the future
  if (isAfter(submittedDate, today)) {
    return res.status(400).render('admin', { error: 'Game date cannot be in the future.' });
  }

  // Ensure the game date is not more than two months old
  if (isBefore(submittedDate, twoMonthsAgo)) {
    return res.status(400).render('admin', 
    { error: 'Game date cannot be more than two months old.' });
  }

  try {
    await insertGame(formatISO(submittedDate), homeName, awayName, homeScore, awayScore);
    res.redirect('/leikir'); // Adjust the redirect as needed
  } catch (error) {
    console.error('Error inserting game:', error);
    res.status(500).send('Error inserting game');
  }
  return undefined;
}

adminRouter.get('/login', indexRoute);
adminRouter.get('/admin', ensureLoggedIn, adminRoute);
adminRouter.get('/skra', skraRoute);
adminRouter.post('/skra', skraRouteInsert);

adminRouter.post(
  '/login',

  // Þetta notar strat að ofan til að skrá notanda inn
  passport.authenticate('local', {
    failureMessage: 'Notandanafn eða lykilorð vitlaust.',
    failureRedirect: '/login',
  }),

  // Ef við komumst hingað var notandi skráður inn, senda á /admin
  (req, res) => {
    res.redirect('/admin');
  },
);
