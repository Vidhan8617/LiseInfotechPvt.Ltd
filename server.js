const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
const jwt = require("jsonwebtoken");

const app = express();
const GOOGLE_CLIENT_ID = "324309133784-j3qahvsvrleac9kqj6jvad7kac7rrh0g.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";
const JWT_SECRET = "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678";
const SESSION_SECRET = "9876543210fedcba0987654321fedcba0987654321fedcba0987654321fedcba";

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true
}));
app.use(bodyParser.json());
app.use(passport.initialize());
app.use(passport.session());

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "timetracker",
  password: "vidhan8617",
  port: 5432,
});

passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: "http://localhost:5000/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const userCheck = await pool.query(
      "SELECT * FROM users WHERE google_id = $1",
      [profile.id]
    );

    if (userCheck.rows.length > 0) {
      return done(null, userCheck.rows[0]);
    } else {
      const newUser = await pool.query(
        "INSERT INTO users (google_id, email, name) VALUES ($1, $2, $3) RETURNING *",
        [profile.id, profile.emails[0].value, profile.displayName]
      );
      return done(null, newUser.rows[0]);
    }
  } catch (error) {
    console.error("Error in Google Strategy:", error);
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id || user.google_id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await pool.query("SELECT * FROM users WHERE id = $1 OR google_id = $1", [id]);
    done(null, user.rows[0]);
  } catch (error) {
    done(error, null);
  }
});

app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "http://localhost:3000" }),
  async (req, res) => {
    const token = jwt.sign(
      {
        userId: req.user.id || req.user.google_id,
        email: req.user.email,
        name: req.user.name
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logAction("login", {
      userId: req.user.id || req.user.google_id,
      email: req.user.email,
      name: req.user.name
    });

    await pool.query(
      "INSERT INTO work_sessions (user_id, login_time) VALUES ($1, NOW())",
      [req.user.id || req.user.google_id]
    );

    res.redirect(`http://localhost:3000?token=${token}&user=${encodeURIComponent(JSON.stringify({
      id: req.user.id || req.user.google_id,
      email: req.user.email,
      name: req.user.name
    }))}`);
  }
);

const logAction = async (action, user) => {
  try {
    await pool.query(
      "INSERT INTO user_actions (action, user_id, email, name) VALUES ($1, $2, $3, $4)",
      [action, user.userId, user.email, user.name]
    );
    console.log(`✅ Action "${action}" logged for ${user.email}`);
  } catch (error) {
    console.error("❌ Error saving action:", error);
  }
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

const routes = ["break", "resume", "lunch", "back-online", "logout"];

routes.forEach((route) => {
  app.post(`/${route}`, authenticateToken, async (req, res) => {
    console.log(`User ${req.user.email} pressed ${route}`);
    await logAction(route, {
      userId: req.user.userId,
      email: req.user.email,
      name: req.user.name
    });
    res.json({ message: `User ${route.replace("-", " ")} action saved.` });
  });
});

app.get("/logs", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT action, timestamp FROM user_actions WHERE user_id = $1 ORDER BY timestamp DESC",
      [req.user.userId]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

app.get("/api/actions", async (req, res) => {
  const result = await pool.query('SELECT * FROM user_actions ORDER BY timestamp DESC');
  res.json(result.rows);
});

app.get("/api/user", authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

app.post("/api/logout", authenticateToken, async (req, res) => {
  try {
    await logAction("logout", {
      userId: req.user.userId,
      email: req.user.email,
      name: req.user.name
    });

    await pool.query(`
      UPDATE work_sessions
      SET logout_time = NOW(),
          duration = NOW() - login_time
      WHERE user_id = $1 AND logout_time IS NULL
    `, [req.user.userId]);

    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  } catch (err) {
    console.error("❌ Error during logout:", err);
    res.status(500).json({ error: "Error updating session" });
  }
});

app.get("/work-summary", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT SUM(EXTRACT(EPOCH FROM duration)) AS total_seconds
      FROM work_sessions
      WHERE user_id = $1 AND duration IS NOT NULL
    `, [req.user.userId]);

    const seconds = result.rows[0].total_seconds || 0;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    res.json({ total_hours: hours, total_minutes: minutes });
  } catch (err) {
    console.error("❌ Failed to fetch work summary:", err);
    res.status(500).json({ error: "Failed to fetch work summary" });
  }
});

async function initializeDB() {
  try {
    const testResult = await pool.query("SELECT NOW()");
    console.log("✅ Connected to Postgres:", testResult.rows[0]);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_actions (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER REFERENCES users(id),
        email VARCHAR(255),
        name VARCHAR(255)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS work_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        login_time TIMESTAMP NOT NULL,
        logout_time TIMESTAMP,
        duration INTERVAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✅ Database tables initialized");
  } catch (err) {
    console.error("❌ Database initialization failed:", err);
  }
}

initializeDB();

app.get("/", (req, res) => {
  res.send("Backend server with Google OAuth is running");
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
