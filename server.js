const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

/* =========================
   POSTGRESQL
========================= */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL tapılmadı.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* =========================
   MIDDLEWARE
========================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "carcash-secret-change-this",

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  })
);

/* =========================
   UPLOADS
========================= */

const uploadDir = path.join(
  __dirname,
  "public",
  "uploads"
);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, {
    recursive: true
  });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const ext =
      path.extname(file.originalname) || ".jpg";

    cb(
      null,
      Date.now() +
        "-" +
        Math.random()
          .toString(36)
          .slice(2) +
        ext
    );
  }
});

const upload = multer({
  storage,

  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================
   DATABASE INIT
========================= */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance DOUBLE PRECISION DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cars (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      price DOUBLE PRECISION NOT NULL,
      daily DOUBLE PRECISION NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_cars (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      car_id INTEGER NOT NULL,
      purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_credited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      order_id TEXT,
      transaction_id TEXT,
      status TEXT DEFAULT 'pending',
      receipt_path TEXT,
      admin_note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      method TEXT,
      account TEXT,
      payout_info TEXT,
      status TEXT DEFAULT 'pending',
      admin_note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS promo_codes (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      max_uses INTEGER DEFAULT 1,
      used_count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS promo_code_uses (
      id SERIAL PRIMARY KEY,
      promo_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(promo_id, user_id),
      FOREIGN KEY(promo_id)
        REFERENCES promo_codes(id),
      FOREIGN KEY(user_id)
        REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id)
        REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL,
      sender_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ticket_id)
        REFERENCES support_tickets(id)
    );
  `);

  await setupCars();
}

/* =========================
   LEVEL CAR SYSTEM
========================= */

const cars = [
  {
    oldName: "City Mini",
    name: "LEVEL 1",
    price: 5,
    monthly: 7.5,
    image: "/cars/car-5.jpg"
  },
  {
    oldName: "Street X",
    name: "LEVEL 2",
    price: 10,
    monthly: 17,
    image: "/cars/car-10.jpg"
  },
  {
    oldName: "Turbo S",
    name: "LEVEL 3",
    price: 20,
    monthly: 35,
    image: "/cars/car-20.jpg"
  },
  {
    oldName: "Sport GT",
    name: "LEVEL 4",
    price: 50,
    monthly: 95,
    image: "/cars/car-40.jpg"
  },
  {
    oldName: "Super R",
    name: "LEVEL 5",
    price: 100,
    monthly: 195,
    image: "/cars/car-80.jpg"
  },
  {
    oldName: "Hyper X",
    name: "LEVEL 6",
    price: 250,
    monthly: 495,
    image: "/cars/car-160.jpg"
  },
  {
    oldName: "Ultra G",
    name: "LEVEL 7",
    price: 500,
    monthly: 1005,
    image: "/cars/car-320.jpg"
  },
  {
    oldName: "Luxury King",
    name: "LEVEL 8",
    price: 1000,
    monthly: 2050,
    image: "/cars/car-640.jpg"
  }
];

for (const car of cars) {
  car.daily = Number(
    (car.monthly / 30).toFixed(10)
  );
}

/* =========================
   CAR SETUP
========================= */

async function setupCars() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const allowedNames =
      cars.map(car => car.name);

    for (const target of cars) {
      const oldResult = await client.query(
        `
        SELECT *
        FROM cars
        WHERE name = $1
        ORDER BY id ASC
        LIMIT 1
        `,
        [target.oldName]
      );

      const levelResult = await client.query(
        `
        SELECT *
        FROM cars
        WHERE name = $1
        ORDER BY id ASC
        LIMIT 1
        `,
        [target.name]
      );

      const oldCar = oldResult.rows[0];
      const levelCar = levelResult.rows[0];

      if (oldCar && !levelCar) {
        await client.query(
          `
          UPDATE cars
          SET name = $1,
              price = $2,
              daily = $3
          WHERE id = $4
          `,
          [
            target.name,
            target.price,
            target.daily,
            oldCar.id
          ]
        );
      }

      if (
        oldCar &&
        levelCar &&
        Number(oldCar.id) !== Number(levelCar.id)
      ) {
        await client.query(
          `
          UPDATE user_cars
          SET car_id = $1
          WHERE car_id = $2
          `,
          [
            levelCar.id,
            oldCar.id
          ]
        );

        await client.query(
          `
          DELETE FROM cars
          WHERE id = $1
          `,
          [oldCar.id]
        );
      }
    }

    for (const target of cars) {
      const result = await client.query(
        `
        SELECT id
        FROM cars
        WHERE name = $1
        ORDER BY id ASC
        LIMIT 1
        `,
        [target.name]
      );

      if (!result.rows[0]) {
        await client.query(
          `
          INSERT INTO cars
          (name, price, daily)
          VALUES ($1, $2, $3)
          `,
          [
            target.name,
            target.price,
            target.daily
          ]
        );
      }
    }

    for (const target of cars) {
      await client.query(
        `
        UPDATE cars
        SET price = $1,
            daily = $2
        WHERE name = $3
        `,
        [
          target.price,
          target.daily,
          target.name
        ]
      );
    }

    for (const target of cars) {
      const result = await client.query(
        `
        SELECT id
        FROM cars
        WHERE name = $1
        ORDER BY id ASC
        `,
        [target.name]
      );

      if (result.rows.length > 1) {
        const mainId =
          result.rows[0].id;

        for (
          let i = 1;
          i < result.rows.length;
          i++
        ) {
          const duplicateId =
            result.rows[i].id;

          await client.query(
            `
            UPDATE user_cars
            SET car_id = $1
            WHERE car_id = $2
            `,
            [
              mainId,
              duplicateId
            ]
          );

          await client.query(
            `
            DELETE FROM cars
            WHERE id = $1
            `,
            [duplicateId]
          );
        }
      }
    }

    const extraResult =
      await client.query(
        `
        SELECT id, name
        FROM cars
        WHERE name <> ALL($1::text[])
        `,
        [allowedNames]
      );

    for (const extra of extraResult.rows) {
      await client.query(
        `
        DELETE FROM user_cars
        WHERE car_id = $1
        `,
        [extra.id]
      );
    }

    await client.query(
      `
      DELETE FROM cars
      WHERE name <> ALL($1::text[])
      `,
      [allowedNames]
    );

    for (const target of cars) {
      const result = await client.query(
        `
        SELECT id
        FROM cars
        WHERE name = $1
        ORDER BY id ASC
        LIMIT 1
        `,
        [target.name]
      );

      if (!result.rows[0]) {
        await client.query(
          `
          INSERT INTO cars
          (name, price, daily)
          VALUES ($1, $2, $3)
          `,
          [
            target.name,
            target.price,
            target.daily
          ]
        );
      } else {
        await client.query(
          `
          UPDATE cars
          SET price = $1,
              daily = $2
          WHERE id = $3
          `,
          [
            target.price,
            target.daily,
            result.rows[0].id
          ]
        );
      }
    }

    await client.query(
      `
      DELETE FROM user_cars
      WHERE car_id IN (
        SELECT id
        FROM cars
        WHERE name <> ALL($1::text[])
      )
      `,
      [allowedNames]
    );

    await client.query(
      `
      DELETE FROM cars
      WHERE name <> ALL($1::text[])
      `,
      [allowedNames]
    );

    await client.query("COMMIT");

    const finalCars =
      await pool.query(
        `
        SELECT id, name, price, daily
        FROM cars
        ORDER BY price ASC
        `
      );

    console.log("");
    console.log("================================");
    console.log(" CAR SYSTEM CLEANED");
    console.log("================================");

    for (const car of finalCars.rows) {
      console.log(
        `${car.name} | ₼${Number(car.price).toFixed(2)} | daily ₼${Number(car.daily).toFixed(8)}`
      );
    }

    console.log(
      `TOTAL CARS: ${finalCars.rows.length}`
    );

    console.log("================================");
    console.log("");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/* =========================
   TIME / EARNINGS
========================= */

const DAY_MS =
  24 * 60 * 60 * 1000;

function parseSqlDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value;
  }

  const text =
    String(value).trim();

  if (!text) return null;

  const date =
    new Date(
      text.replace(" ", "T") + "Z"
    );

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function calculateCarEarned(
  lastCreditedAt,
  daily
) {
  const last =
    parseSqlDate(lastCreditedAt);

  if (!last) return 0;

  const elapsed =
    Date.now() -
    last.getTime();

  if (elapsed <= 0) return 0;

  const dailyAmount =
    Number(daily || 0);

  if (
    !Number.isFinite(dailyAmount) ||
    dailyAmount <= 0
  ) {
    return 0;
  }

  return Math.max(
    0,
    (elapsed / DAY_MS) *
      dailyAmount
  );
}

function getNowSql() {
  return new Date();
}

async function getUser(userId) {
  const result =
    await pool.query(
      `
      SELECT
        id,
        name,
        email,
        balance,
        created_at
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

  return result.rows[0];
}

async function getUserCarsWithEarnings(userId) {
  const result =
    await pool.query(
      `
      SELECT
        uc.id,
        uc.purchased_at,
        uc.last_credited_at,

        c.id AS car_id,
        c.name,
        c.price,
        c.daily

      FROM user_cars uc

      JOIN cars c
        ON c.id = uc.car_id

      WHERE uc.user_id = $1

      ORDER BY c.price ASC, uc.id ASC
      `,
      [userId]
    );

  return result.rows.map(car => {
    const earned =
      calculateCarEarned(
        car.last_credited_at,
        car.daily
      );

    return {
      ...car,

      earned:
        Number(
          earned.toFixed(8)
        ),

      earned_display:
        Number(
          earned.toFixed(8)
        ),

      daily:
        Number(car.daily),

      price:
        Number(car.price)
    };
  });
}

async function getTotalPendingEarnings(userId) {
  const result =
    await pool.query(
      `
      SELECT
        uc.last_credited_at,
        c.daily
      FROM user_cars uc
      JOIN cars c
        ON c.id = uc.car_id
      WHERE uc.user_id = $1
      `,
      [userId]
    );

  let total = 0;

  for (const car of result.rows) {
    total +=
      calculateCarEarned(
        car.last_credited_at,
        car.daily
      );
  }

  return Number(
    total.toFixed(8)
  );
}

async function getUserWithCars(userId) {
  const user =
    await getUser(userId);

  if (!user) return null;

  const userCars =
    await getUserCarsWithEarnings(
      userId
    );

  const pendingEarnings =
    await getTotalPendingEarnings(
      userId
    );

  return {
    ...user,

    balance:
      Number(
        Number(user.balance || 0)
          .toFixed(8)
      ),

    pending_earnings:
      pendingEarnings,

    total_available:
      Number(
        (
          Number(user.balance || 0) +
          pendingEarnings
        ).toFixed(8)
      ),

    cars:
      userCars
  };
}

/* =========================
   AUTH HELPERS
========================= */

async function requireLogin(
  req,
  res,
  next
) {
  if (!req.session.userId) {
    return res.status(401).json({
      error: "Giriş etməlisən."
    });
  }

  next();
}

async function requireAdmin(
  req,
  res,
  next
) {
  if (!req.session.userId) {
    return res.status(401).json({
      error: "Giriş etməlisən."
    });
  }

  const admin =
    await getUser(
      req.session.userId
    );

  if (
    !admin ||
    admin.email !==
      process.env.ADMIN_EMAIL
  ) {
    return res.status(403).json({
      error:
        "Admin icazəsi yoxdur."
    });
  }

  next();
}

/* =========================
   REGISTER
========================= */

app.post(
  "/api/register",
  async (req, res) => {
    try {
      const {
        name,
        email,
        password
      } = req.body;

      if (
        !name ||
        !email ||
        !password
      ) {
        return res.status(400).json({
          error:
            "Ad, email və şifrə daxil et."
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          error:
            "Şifrə ən azı 6 simvol olmalıdır."
        });
      }

      const cleanName =
        String(name).trim();

      const cleanEmail =
        String(email)
          .trim()
          .toLowerCase();

      const exists =
        await pool.query(
          `
          SELECT id
          FROM users
          WHERE email = $1
          `,
          [cleanEmail]
        );

      if (exists.rows[0]) {
        return res.status(400).json({
          error:
            "Bu email artıq qeydiyyatdan keçib."
        });
      }

      const hash =
        await bcrypt.hash(
          password,
          10
        );

      const result =
        await pool.query(
          `
          INSERT INTO users
          (
            name,
            email,
            password_hash,
            balance
          )
          VALUES ($1, $2, $3, 0)
          RETURNING id
          `,
          [
            cleanName,
            cleanEmail,
            hash
          ]
        );

      const userId =
        result.rows[0].id;

      req.session.userId =
        userId;

      res.json({
        ok: true,

        user:
          await getUserWithCars(
            userId
          )
      });
    } catch (error) {
      console.error(
        "REGISTER ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================
   LOGIN
========================= */

app.post(
  "/api/login",
  async (req, res) => {
    try {
      const {
        email,
        password
      } = req.body;

      if (
        !email ||
        !password
      ) {
        return res.status(400).json({
          error:
            "Email və şifrə daxil et."
        });
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM users
          WHERE email = $1
          `,
          [
            String(email)
              .trim()
              .toLowerCase()
          ]
        );

      const user =
        result.rows[0];

      if (!user) {
        return res.status(401).json({
          error:
            "Email və ya şifrə yanlışdır."
        });
      }

      const valid =
        await bcrypt.compare(
          String(password),
          String(user.password_hash)
        );

      if (!valid) {
        return res.status(401).json({
          error:
            "Email və ya şifrə yanlışdır."
        });
      }

      req.session.userId =
        user.id;

      res.json({
        ok: true,

        user:
          await getUserWithCars(
            user.id
          )
      });
    } catch (error) {
      console.error(
        "LOGIN ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Giriş zamanı xəta baş verdi."
      });
    }
  }
);

/* =========================
   LOGOUT
========================= */

app.post(
  "/api/logout",
  (req, res) => {
    req.session.destroy(() => {
      res.json({
        ok: true
      });
    });
  }
);

/* =========================
   ME
========================= */

app.get(
  "/api/me",
  requireLogin,
  async (req, res) => {
    res.json({
      user:
        await getUserWithCars(
          req.session.userId
        )
    });
  }
);

/* =========================
   LIVE EARNINGS
========================= */

app.get(
  "/api/cars/earnings",
  requireLogin,
  async (req, res) => {
    try {
      const cars =
        await getUserCarsWithEarnings(
          req.session.userId
        );

      const total =
        cars.reduce(
          (sum, car) =>
            sum +
            Number(car.earned || 0),
          0
        );

      res.json({
        ok: true,
        cars,

        total:
          Number(
            total.toFixed(8)
          )
      });
    } catch (error) {
      console.error(
        "LIVE EARNINGS ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Qazanc məlumatı alınmadı."
      });
    }
  }
);

/* =========================
   PROFILE
========================= */

app.get(
  "/api/profile",
  requireLogin,
  async (req, res) => {
    try {
      const userId =
        req.session.userId;

      const userResult =
        await pool.query(
          `
          SELECT
            id,
            name,
            email,
            balance,
            created_at
          FROM users
          WHERE id = $1
          `,
          [userId]
        );

      const user =
        userResult.rows[0];

      if (!user) {
        return res.status(404).json({
          error:
            "İstifadəçi tapılmadı."
        });
      }

      const statsResult =
        await pool.query(
          `
          SELECT
            COUNT(*) AS car_count,
            COALESCE(
              SUM(c.daily),
              0
            ) AS daily_income
          FROM user_cars uc
          JOIN cars c
            ON c.id = uc.car_id
          WHERE uc.user_id = $1
          `,
          [userId]
        );

      const carStats =
        statsResult.rows[0];

      const pending =
        await getTotalPendingEarnings(
          userId
        );

      res.json({
        profile: {
          id: user.id,
          name: user.name || "",
          email: user.email,

          balance:
            Number(
              Number(
                user.balance || 0
              ).toFixed(8)
            ),

          pending_earnings:
            pending,

          total_available:
            Number(
              (
                Number(user.balance || 0) +
                pending
              ).toFixed(8)
            ),

          created_at:
            user.created_at,

          car_count:
            Number(
              carStats.car_count || 0
            ),

          daily_income:
            Number(
              carStats.daily_income || 0
            )
        }
      });
    } catch (error) {
      console.error(
        "PROFILE GET ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Profil yüklənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   UPDATE PROFILE
========================= */

app.put(
  "/api/profile",
  requireLogin,
  async (req, res) => {
    try {
      const userId =
        req.session.userId;

      const name =
        String(
          req.body.name || ""
        ).trim();

      const email =
        String(
          req.body.email || ""
        )
          .trim()
          .toLowerCase();

      if (!name) {
        return res.status(400).json({
          error:
            "Ad boş ola bilməz."
        });
      }

      if (name.length < 2) {
        return res.status(400).json({
          error:
            "Ad ən azı 2 simvol olmalıdır."
        });
      }

      if (!email) {
        return res.status(400).json({
          error:
            "Email daxil et."
        });
      }

      const owner =
        await pool.query(
          `
          SELECT id
          FROM users
          WHERE email = $1
            AND id != $2
          `,
          [
            email,
            userId
          ]
        );

      if (owner.rows[0]) {
        return res.status(400).json({
          error:
            "Bu email artıq başqa hesabda istifadə olunur."
        });
      }

      await pool.query(
        `
        UPDATE users
        SET name = $1,
            email = $2
        WHERE id = $3
        `,
        [
          name,
          email,
          userId
        ]
      );

      res.json({
        ok: true,

        message:
          "Profil məlumatları yeniləndi.",

        user:
          await getUserWithCars(
            userId
          )
      });
    } catch (error) {
      console.error(
        "PROFILE UPDATE ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Profil yenilənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   CHANGE PASSWORD
========================= */

app.put(
  "/api/profile/password",
  requireLogin,
  async (req, res) => {
    try {
      const userId =
        req.session.userId;

      const currentPassword =
        String(
          req.body.currentPassword || ""
        );

      const newPassword =
        String(
          req.body.newPassword || ""
        );

      if (
        !currentPassword ||
        !newPassword
      ) {
        return res.status(400).json({
          error:
            "Cari və yeni şifrəni daxil et."
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          error:
            "Yeni şifrə ən azı 6 simvol olmalıdır."
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            password_hash
          FROM users
          WHERE id = $1
          `,
          [userId]
        );

      const user =
        result.rows[0];

      if (!user) {
        return res.status(404).json({
          error:
            "İstifadəçi tapılmadı."
        });
      }

      const valid =
        await bcrypt.compare(
          currentPassword,
          user.password_hash
        );

      if (!valid) {
        return res.status(400).json({
          error:
            "Cari şifrə yanlışdır."
        });
      }

      const newHash =
        await bcrypt.hash(
          newPassword,
          10
        );

      await pool.query(
        `
        UPDATE users
        SET password_hash = $1
        WHERE id = $2
        `,
        [
          newHash,
          userId
        ]
      );

      res.json({
        ok: true,

        message:
          "Şifrə uğurla dəyişdirildi."
      });
    } catch (error) {
      console.error(
        "PASSWORD CHANGE ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Şifrə dəyişdirilmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   CARS LIST
========================= */

app.get(
  "/api/cars",
  async (req, res) => {
    try {
      const imageMap = {
        "LEVEL 1":
          "/cars/car-5.jpg",
        "LEVEL 2":
          "/cars/car-10.jpg",
        "LEVEL 3":
          "/cars/car-20.jpg",
        "LEVEL 4":
          "/cars/car-40.jpg",
        "LEVEL 5":
          "/cars/car-80.jpg",
        "LEVEL 6":
          "/cars/car-160.jpg",
        "LEVEL 7":
          "/cars/car-320.jpg",
        "LEVEL 8":
          "/cars/car-640.jpg"
      };

      const result =
        await pool.query(
          `
          SELECT *
          FROM cars
          WHERE name IN (
            'LEVEL 1',
            'LEVEL 2',
            'LEVEL 3',
            'LEVEL 4',
            'LEVEL 5',
            'LEVEL 6',
            'LEVEL 7',
            'LEVEL 8'
          )
          ORDER BY price ASC
          `
        );

      res.json(
        result.rows.map(car => ({
          ...car,

          image:
            imageMap[car.name] ||
            "/cars/car-5.jpg"
        }))
      );
    } catch (error) {
      console.error(
        "CARS LIST ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Maşınlar yüklənmədi."
      });
    }
  }
);

/* =========================
   BUY CAR
========================= */

app.post(
  "/api/cars/buy",
  requireLogin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const userId =
        req.session.userId;

      const carId =
        Number(
          req.body.carId
        );

      if (!Number.isInteger(carId)) {
        return res.status(400).json({
          error:
            "Maşın ID düzgün deyil."
        });
      }

      const carResult =
        await client.query(
          `
          SELECT *
          FROM cars
          WHERE id = $1
            AND name IN (
              'LEVEL 1',
              'LEVEL 2',
              'LEVEL 3',
              'LEVEL 4',
              'LEVEL 5',
              'LEVEL 6',
              'LEVEL 7',
              'LEVEL 8'
            )
          `,
          [carId]
        );

      const car =
        carResult.rows[0];

      if (!car) {
        return res.status(404).json({
          error:
            "Maşın tapılmadı."
        });
      }

      const user =
        await getUser(userId);

      if (!user) {
        return res.status(401).json({
          error:
            "İstifadəçi tapılmadı."
        });
      }

      if (
        Number(user.balance) <
        Number(car.price)
      ) {
        return res.status(400).json({
          error:
            "Balans kifayət etmir."
        });
      }

      await client.query("BEGIN");

      const now =
        getNowSql();

      await client.query(
        `
        UPDATE users
        SET balance = balance - $1
        WHERE id = $2
        `,
        [
          car.price,
          userId
        ]
      );

      await client.query(
        `
        INSERT INTO user_cars
        (
          user_id,
          car_id,
          purchased_at,
          last_credited_at
        )
        VALUES ($1, $2, $3, $3)
        `,
        [
          userId,
          car.id,
          now
        ]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,

        message:
          `${car.name} uğurla alındı.`,

        user:
          await getUserWithCars(
            userId
          )
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "BUY CAR ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Maşın alınarkən xəta baş verdi."
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   COLLECT ALL
========================= */

app.post(
  "/api/cars/collect-all",
  requireLogin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const userId =
        req.session.userId;

      const result =
        await client.query(
          `
          SELECT
            uc.id,
            uc.last_credited_at,
            c.daily
          FROM user_cars uc
          JOIN cars c
            ON c.id = uc.car_id
          WHERE uc.user_id = $1
          `,
          [userId]
        );

      const userCars =
        result.rows;

      if (!userCars.length) {
        return res.status(400).json({
          error:
            "Sənin heç bir maşının yoxdur."
        });
      }

      let total = 0;

      for (const car of userCars) {
        total +=
          calculateCarEarned(
            car.last_credited_at,
            car.daily
          );
      }

      total =
        Number(
          total.toFixed(8)
        );

      if (total <= 0) {
        return res.status(400).json({
          error:
            "Hələ toplamaq üçün gəlir yaranmayıb."
        });
      }

      await client.query("BEGIN");

      await client.query(
        `
        UPDATE users
        SET balance = balance + $1
        WHERE id = $2
        `,
        [
          total,
          userId
        ]
      );

      const now =
        getNowSql();

      for (const car of userCars) {
        await client.query(
          `
          UPDATE user_cars
          SET last_credited_at = $1
          WHERE id = $2
            AND user_id = $3
          `,
          [
            now,
            car.id,
            userId
          ]
        );
      }

      await client.query("COMMIT");

      const updatedUser =
        await getUser(userId);

      res.json({
        ok: true,

        collected:
          total,

        balance:
          Number(
            Number(
              updatedUser.balance
            ).toFixed(8)
          ),

        message:
          `Bütün maşınların gəlirindən ₼${total.toFixed(8)} balansa əlavə edildi.`,

        user:
          await getUserWithCars(
            userId
          )
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "COLLECT ALL ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Gəlir toplanarkən xəta baş verdi."
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   COLLECT ONE
========================= */

app.post(
  "/api/cars/:id/collect",
  requireLogin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const userId =
        req.session.userId;

      const userCarId =
        Number(
          req.params.id
        );

      if (!Number.isInteger(userCarId)) {
        return res.status(400).json({
          error:
            "Maşın ID düzgün deyil."
        });
      }

      const result =
        await client.query(
          `
          SELECT
            uc.id,
            uc.user_id,
            uc.last_credited_at,
            c.name,
            c.daily
          FROM user_cars uc
          JOIN cars c
            ON c.id = uc.car_id
          WHERE uc.id = $1
            AND uc.user_id = $2
          `,
          [
            userCarId,
            userId
          ]
        );

      const userCar =
        result.rows[0];

      if (!userCar) {
        return res.status(404).json({
          error:
            "Maşın tapılmadı."
        });
      }

      const amount =
        Number(
          calculateCarEarned(
            userCar.last_credited_at,
            userCar.daily
          ).toFixed(8)
        );

      if (amount <= 0) {
        return res.status(400).json({
          error:
            "Hələ toplamaq üçün gəlir yaranmayıb."
        });
      }

      await client.query("BEGIN");

      await client.query(
        `
        UPDATE users
        SET balance = balance + $1
        WHERE id = $2
        `,
        [
          amount,
          userId
        ]
      );

      await client.query(
        `
        UPDATE user_cars
        SET last_credited_at = $1
        WHERE id = $2
          AND user_id = $3
        `,
        [
          getNowSql(),
          userCar.id,
          userId
        ]
      );

      await client.query("COMMIT");

      const updatedUser =
        await getUser(userId);

      res.json({
        ok: true,

        collected:
          amount,

        balance:
          Number(
            Number(
              updatedUser.balance
            ).toFixed(8)
          ),

        message:
          `${userCar.name} gəlirindən ₼${amount.toFixed(8)} balansa əlavə edildi.`,

        user:
          await getUserWithCars(
            userId
          )
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "COLLECT ONE ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Gəlir toplanarkən xəta baş verdi."
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   PROMO REDEEM
========================= */

app.post(
  "/api/promo/redeem",
  requireLogin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const userId =
        req.session.userId;

      const code =
        String(
          req.body.code || ""
        )
          .trim()
          .toUpperCase();

      if (!code) {
        return res.status(400).json({
          error:
            "Promo kod daxil et."
        });
      }

      const promoResult =
        await client.query(
          `
          SELECT *
          FROM promo_codes
          WHERE code = $1
            AND active = 1
          `,
          [code]
        );

      const promo =
        promoResult.rows[0];

      if (!promo) {
        return res.status(404).json({
          error:
            "Promo kod tapılmadı və ya aktiv deyil."
        });
      }

      if (
        Number(promo.max_uses) > 0 &&
        Number(promo.used_count) >=
          Number(promo.max_uses)
      ) {
        return res.status(400).json({
          error:
            "Bu promo kodun istifadə limiti bitib."
        });
      }

      const usedResult =
        await client.query(
          `
          SELECT id
          FROM promo_code_uses
          WHERE promo_id = $1
            AND user_id = $2
          `,
          [
            promo.id,
            userId
          ]
        );

      if (usedResult.rows[0]) {
        return res.status(400).json({
          error:
            "Bu promo kodu artıq istifadə etmisən."
        });
      }

      const amount =
        Number(promo.amount);

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          error:
            "Promo kod məbləği düzgün deyil."
        });
      }

      await client.query("BEGIN");

      await client.query(
        `
        UPDATE users
        SET balance = balance + $1
        WHERE id = $2
        `,
        [
          amount,
          userId
        ]
      );

      await client.query(
        `
        INSERT INTO promo_code_uses
        (
          promo_id,
          user_id,
          amount
        )
        VALUES ($1, $2, $3)
        `,
        [
          promo.id,
          userId,
          amount
        ]
      );

      const newCount =
        Number(promo.used_count) + 1;

      await client.query(
        `
        UPDATE promo_codes
        SET used_count = used_count + 1,
            active =
              CASE
                WHEN max_uses > 0
                 AND used_count + 1 >= max_uses
                THEN 0
                ELSE active
              END
        WHERE id = $1
        `,
        [promo.id]
      );

      await client.query("COMMIT");

      const user =
        await getUser(userId);

      res.json({
        ok: true,

        message:
          `₼${amount.toFixed(2)} balansına əlavə edildi.`,

        amount,

        balance:
          Number(
            Number(user.balance)
              .toFixed(8)
          )
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "PROMO REDEEM ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Promo kod istifadə edilərkən xəta baş verdi."
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   ADMIN PROMO LIST
========================= */

app.get(
  "/api/admin/promo-codes",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            id,
            code,
            amount,
            max_uses,
            used_count,
            active,
            created_at
          FROM promo_codes
          ORDER BY id DESC
          `
        );

      res.json({
        codes:
          result.rows
      });
    } catch (error) {
      console.error(
        "ADMIN PROMO LIST ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Promo kodlar yüklənmədi."
      });
    }
  }
);

/* =========================
   ADMIN CREATE PROMO
========================= */

app.post(
  "/api/admin/promo-codes",
  requireAdmin,
  async (req, res) => {
    try {
      const code =
        String(
          req.body.code || ""
        )
          .trim()
          .toUpperCase();

      const amount =
        Number(req.body.amount);

      const maxUses =
        Number(req.body.maxUses);

      if (!code) {
        return res.status(400).json({
          error:
            "Promo kod daxil et."
        });
      }

      if (!/^[A-Z0-9_-]+$/.test(code)) {
        return res.status(400).json({
          error:
            "Kod yalnız A-Z, 0-9, - və _ simvollarından ibarət ola bilər."
        });
      }

      if (
        code.length < 3 ||
        code.length > 50
      ) {
        return res.status(400).json({
          error:
            "Promo kod 3-50 simvol arasında olmalıdır."
        });
      }

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          error:
            "Düzgün məbləğ daxil et."
        });
      }

      if (
        !Number.isInteger(maxUses) ||
        maxUses < 0
      ) {
        return res.status(400).json({
          error:
            "İstifadə limiti düzgün deyil."
        });
      }

      const exists =
        await pool.query(
          `
          SELECT id
          FROM promo_codes
          WHERE code = $1
          `,
          [code]
        );

      if (exists.rows[0]) {
        return res.status(400).json({
          error:
            "Bu promo kod artıq mövcuddur."
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO promo_codes
          (
            code,
            amount,
            max_uses,
            used_count,
            active
          )
          VALUES ($1, $2, $3, 0, 1)
          RETURNING id
          `,
          [
            code,
            amount,
            maxUses
          ]
        );

      res.json({
        ok: true,

        message:
          "Promo kod yaradıldı.",

        promo: {
          id:
            result.rows[0].id,

          code,

          amount,

          max_uses:
            maxUses,

          used_count:
            0,

          active:
            1
        }
      });
    } catch (error) {
      console.error(
        "CREATE PROMO ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Promo kod yaradılmadı: " +
          error.message
      });
    }
  }
);

/* =========================
   ADMIN TOGGLE PROMO
========================= */

app.post(
  "/api/admin/promo-codes/:id/toggle",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error:
            "Kod ID düzgün deyil."
        });
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM promo_codes
          WHERE id = $1
          `,
          [id]
        );

      const promo =
        result.rows[0];

      if (!promo) {
        return res.status(404).json({
          error:
            "Promo kod tapılmadı."
        });
      }

      if (
        !promo.active &&
        Number(promo.max_uses) > 0 &&
        Number(promo.used_count) >=
          Number(promo.max_uses)
      ) {
        return res.status(400).json({
          error:
            "Bu kodun istifadə limiti artıq bitib."
        });
      }

      const newStatus =
        promo.active ? 0 : 1;

      await pool.query(
        `
        UPDATE promo_codes
        SET active = $1
        WHERE id = $2
        `,
        [
          newStatus,
          id
        ]
      );

      res.json({
        ok: true,
        active: newStatus,

        message:
          newStatus
            ? "Promo kod aktiv edildi."
            : "Promo kod deaktiv edildi."
      });
    } catch (error) {
      console.error(
        "TOGGLE PROMO ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Promo kod dəyişdirilmədi."
      });
    }
  }
);

/* =========================
   ADMIN DELETE PROMO
========================= */

app.delete(
  "/api/admin/promo-codes/:id",
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const id =
        Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error:
            "Kod ID düzgün deyil."
        });
      }

      const result =
        await client.query(
          `
          SELECT id
          FROM promo_codes
          WHERE id = $1
          `,
          [id]
        );

      if (!result.rows[0]) {
        return res.status(404).json({
          error:
            "Promo kod tapılmadı."
        });
      }

      await client.query("BEGIN");

      await client.query(
        `
        DELETE FROM promo_code_uses
        WHERE promo_id = $1
        `,
        [id]
      );

      await client.query(
        `
        DELETE FROM promo_codes
        WHERE id = $1
        `,
        [id]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,

        message:
          "Promo kod silindi."
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "DELETE PROMO ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Promo kod silinmədi."
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   PAYMENT INFO
========================= */

app.get(
  "/api/payment-info",
  requireLogin,
  (req, res) => {
    res.json({
      cardNumber:
        process.env.PAYMENT_CARD_NUMBER ||
        "0000 0000 0000 0000",

      cardName:
        process.env.PAYMENT_CARD_NAME ||
        "CARCASH"
    });
  }
);

/* =========================
   MANUAL DEPOSIT
========================= */

app.post(
  "/api/deposit/manual",
  requireLogin,
  async (req, res) => {
    try {
      const amount =
        Number(
          req.body.amount
        );

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          error:
            "Düzgün məbləğ daxil et."
        });
      }

      const orderId =
        "DEP-" +
        Date.now() +
        "-" +
        Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase();

      const result =
        await pool.query(
          `
          INSERT INTO deposits
          (
            user_id,
            amount,
            order_id,
            status
          )
          VALUES ($1, $2, $3, 'pending')
          RETURNING id
          `,
          [
            req.session.userId,
            amount,
            orderId
          ]
        );

      res.json({
        ok: true,

        depositId:
          result.rows[0].id,

        orderId,

        message:
          "Deposit yaradıldı. İndi ödənişi edib qəbzi yüklə."
      });
    } catch (error) {
      console.error(
        "DEPOSIT ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Deposit yaradılarkən server xətası baş verdi."
      });
    }
  }
);

/* =========================
   UPLOAD RECEIPT
========================= */

app.post(
  "/api/deposit/:id/receipt",
  requireLogin,
  upload.single("receipt"),
  async (req, res) => {
    try {
      const depositId =
        Number(req.params.id);

      if (!req.file) {
        return res.status(400).json({
          error:
            "Qəbz şəkli seçilməyib."
        });
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM deposits
          WHERE id = $1
            AND user_id = $2
          `,
          [
            depositId,
            req.session.userId
          ]
        );

      if (!result.rows[0]) {
        return res.status(404).json({
          error:
            "Deposit tapılmadı."
        });
      }

      const receiptPath =
        "/uploads/" +
        req.file.filename;

      await pool.query(
        `
        UPDATE deposits
        SET receipt_path = $1
        WHERE id = $2
        `,
        [
          receiptPath,
          depositId
        ]
      );

      res.json({
        ok: true,

        message:
          "Qəbz uğurla yükləndi."
      });
    } catch (error) {
      console.error(
        "RECEIPT ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Qəbz yüklənmədi."
      });
    }
  }
);

/* =========================
   USER DEPOSITS
========================= */

app.get(
  "/api/my-deposits",
  requireLogin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT *
          FROM deposits
          WHERE user_id = $1
          ORDER BY id DESC
          `,
          [req.session.userId]
        );

      res.json({
        deposits:
          result.rows
      });
    } catch (error) {
      res.status(500).json({
        error:
          "Deposit tarixçəsi yüklənmədi."
      });
    }
  }
);

/* =========================
   ADMIN DEPOSITS
========================= */

app.get(
  "/api/deposits",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            d.id,
            d.user_id,
            d.amount,
            d.order_id,
            d.transaction_id,
            d.status,
            d.receipt_path,
            d.admin_note,
            d.created_at,

            u.name,
            u.email

          FROM deposits d

          LEFT JOIN users u
            ON u.id = d.user_id

          ORDER BY d.id DESC
          `
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "ADMIN DEPOSITS ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Depositlər yüklənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   APPROVE DEPOSIT
========================= */

app.post(
  "/api/admin/deposits/:id/approve",
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const depositId =
        Number(req.params.id);

      if (!Number.isInteger(depositId)) {
        return res.status(400).json({
          error:
            "Deposit ID düzgün deyil."
        });
      }

      const result =
        await client.query(
          `
          SELECT *
          FROM deposits
          WHERE id = $1
          `,
          [depositId]
        );

      const deposit =
        result.rows[0];

      if (!deposit) {
        return res.status(404).json({
          error:
            "Deposit tapılmadı."
        });
      }

      if (deposit.status !== "pending") {
        return res.status(400).json({
          error:
            "Bu deposit artıq işlənib."
        });
      }

      await client.query("BEGIN");

      await client.query(
        `
        UPDATE deposits
        SET status = 'approved'
        WHERE id = $1
        `,
        [depositId]
      );

      await client.query(
        `
        UPDATE users
        SET balance = balance + $1
        WHERE id = $2
        `,
        [
          deposit.amount,
          deposit.user_id
        ]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,

        message:
          "Deposit təsdiqləndi."
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "APPROVE DEPOSIT ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Deposit təsdiqlənmədi: " +
          error.message
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   REJECT DEPOSIT
========================= */

app.post(
  "/api/admin/deposits/:id/reject",
  requireAdmin,
  async (req, res) => {
    try {
      const depositId =
        Number(req.params.id);

      const note =
        String(
          req.body.note || ""
        ).trim();

      if (!Number.isInteger(depositId)) {
        return res.status(400).json({
          error:
            "Deposit ID düzgün deyil."
        });
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM deposits
          WHERE id = $1
          `,
          [depositId]
        );

      const deposit =
        result.rows[0];

      if (!deposit) {
        return res.status(404).json({
          error:
            "Deposit tapılmadı."
        });
      }

      if (deposit.status !== "pending") {
        return res.status(400).json({
          error:
            "Bu deposit artıq işlənib."
        });
      }

      await pool.query(
        `
        UPDATE deposits
        SET
          status = 'rejected',
          admin_note = $1
        WHERE id = $2
        `,
        [
          note,
          depositId
        ]
      );

      res.json({
        ok: true,

        message:
          "Deposit rədd edildi."
      });
    } catch (error) {
      console.error(
        "REJECT DEPOSIT ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Deposit rədd edilmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   ADMIN USERS
========================= */

app.get(
  "/api/admin/users",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            id,
            name,
            email,
            balance,
            created_at
          FROM users
          ORDER BY id DESC
          `
        );

      res.json({
        users:
          result.rows
      });
    } catch (error) {
      console.error(
        "ADMIN USERS ERROR:",
        error
      );

      res.status(500).json({
        error:
          "İstifadəçilər yüklənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   WITHDRAW
========================= */

app.post(
  "/api/withdraw",
  requireLogin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const amount =
        Number(
          req.body.amount
        );

      const method =
        String(
          req.body.method || ""
        ).trim();

      const account =
        String(
          req.body.account || ""
        ).trim();

      if (
        !Number.isFinite(amount) ||
        amount < 10
      ) {
        return res.status(400).json({
          error:
            "Minimum çıxarış 10 AZN-dir."
        });
      }

      if (!method || !account) {
        return res.status(400).json({
          error:
            "Ödəniş üsulu və hesab daxil et."
        });
      }

      const user =
        await getUser(
          req.session.userId
        );

      if (!user) {
        return res.status(401).json({
          error:
            "İstifadəçi tapılmadı."
        });
      }

      if (
        Number(user.balance) <
        amount
      ) {
        return res.status(400).json({
          error:
            "Balans kifayət etmir."
        });
      }

      const payoutInfo =
        JSON.stringify({
          method,
          account
        });

      await client.query("BEGIN");

      await client.query(
        `
        UPDATE users
        SET balance = balance - $1
        WHERE id = $2
        `,
        [
          amount,
          req.session.userId
        ]
      );

      await client.query(
        `
        INSERT INTO withdrawals
        (
          user_id,
          amount,
          method,
          account,
          payout_info,
          status
        )
        VALUES
        ($1, $2, $3, $4, $5, 'pending')
        `,
        [
          req.session.userId,
          amount,
          method,
          account,
          payoutInfo
        ]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,

        message:
          "Çıxarış sorğusu yaradıldı."
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "WITHDRAW ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Çıxarış zamanı server xətası: " +
          error.message
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   USER WITHDRAWALS
========================= */

app.get(
  "/api/my-withdrawals",
  requireLogin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            id,
            amount,
            method,
            account,
            payout_info,
            status,
            admin_note,
            created_at
          FROM withdrawals
          WHERE user_id = $1
          ORDER BY id DESC
          `,
          [req.session.userId]
        );

      res.json({
        withdrawals:
          result.rows
      });
    } catch (error) {
      console.error(
        "MY WITHDRAWALS ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Çıxarış tarixçəsi yüklənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   ADMIN WITHDRAWALS
========================= */

app.get(
  "/api/withdrawals",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            w.id,
            w.user_id,
            w.amount,
            w.method,
            w.account,
            w.payout_info,
            w.status,
            w.admin_note,
            w.created_at,

            u.name,
            u.email

          FROM withdrawals w

          LEFT JOIN users u
            ON u.id = w.user_id

          ORDER BY w.id DESC
          `
        );

      res.json({
        withdrawals:
          result.rows
      });
    } catch (error) {
      console.error(
        "ADMIN WITHDRAWALS ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Çıxarışlar yüklənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   APPROVE WITHDRAWAL
========================= */

app.post(
  "/api/admin/withdrawals/:id/approve",
  requireAdmin,
  async (req, res) => {
    try {
      const withdrawalId =
        Number(req.params.id);

      if (
        !Number.isInteger(
          withdrawalId
        )
      ) {
        return res.status(400).json({
          error:
            "Çıxarış ID düzgün deyil."
        });
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM withdrawals
          WHERE id = $1
          `,
          [withdrawalId]
        );

      const withdrawal =
        result.rows[0];

      if (!withdrawal) {
        return res.status(404).json({
          error:
            "Çıxarış tapılmadı."
        });
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        return res.status(400).json({
          error:
            "Bu çıxarış artıq işlənib."
        });
      }

      await pool.query(
        `
        UPDATE withdrawals
        SET status = 'approved'
        WHERE id = $1
        `,
        [withdrawalId]
      );

      res.json({
        ok: true,

        message:
          "Çıxarış təsdiqləndi."
      });
    } catch (error) {
      console.error(
        "APPROVE WITHDRAWAL ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Çıxarış təsdiqlənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   REJECT WITHDRAWAL
========================= */

app.post(
  "/api/admin/withdrawals/:id/reject",
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const withdrawalId =
        Number(req.params.id);

      const note =
        String(
          req.body.note || ""
        ).trim();

      if (
        !Number.isInteger(
          withdrawalId
        )
      ) {
        return res.status(400).json({
          error:
            "Çıxarış ID düzgün deyil."
        });
      }

      const result =
        await client.query(
          `
          SELECT *
          FROM withdrawals
          WHERE id = $1
          `,
          [withdrawalId]
        );

      const withdrawal =
        result.rows[0];

      if (!withdrawal) {
        return res.status(404).json({
          error:
            "Çıxarış tapılmadı."
        });
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        return res.status(400).json({
          error:
            "Bu çıxarış artıq işlənib."
        });
      }

      await client.query("BEGIN");

      await client.query(
        `
        UPDATE withdrawals
        SET
          status = 'rejected',
          admin_note = $1
        WHERE id = $2
        `,
        [
          note,
          withdrawalId
        ]
      );

      await client.query(
        `
        UPDATE users
        SET balance = balance + $1
        WHERE id = $2
        `,
        [
          withdrawal.amount,
          withdrawal.user_id
        ]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,

        message:
          "Çıxarış rədd edildi və məbləğ balansa qaytarıldı."
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "REJECT WITHDRAWAL ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Çıxarış rədd edilmədi: " +
          error.message
      });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   SUPPORT
===================================================== */

/* =========================
   CREATE TICKET
========================= */

app.post(
  "/api/support/tickets",
  requireLogin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const userId =
        req.session.userId;

      const subject =
        String(
          req.body.subject || ""
        ).trim();

      const category =
        String(
          req.body.category || "Other"
        ).trim();

      const message =
        String(
          req.body.message || ""
        ).trim();

      const allowedCategories = [
        "Deposit",
        "Withdraw",
        "Account",
        "Cars",
        "Other"
      ];

      if (!subject) {
        return res.status(400).json({
          error:
            "Ticket mövzusu daxil et."
        });
      }

      if (
        subject.length < 3 ||
        subject.length > 150
      ) {
        return res.status(400).json({
          error:
            "Mövzu 3-150 simvol arasında olmalıdır."
        });
      }

      if (!message) {
        return res.status(400).json({
          error:
            "Mesaj daxil et."
        });
      }

      if (
        message.length < 3 ||
        message.length > 5000
      ) {
        return res.status(400).json({
          error:
            "Mesaj 3-5000 simvol arasında olmalıdır."
        });
      }

      const cleanCategory =
        allowedCategories.includes(
          category
        )
          ? category
          : "Other";

      await client.query("BEGIN");

      const ticketResult =
        await client.query(
          `
          INSERT INTO support_tickets
          (
            user_id,
            subject,
            category,
            status
          )
          VALUES
          ($1, $2, $3, 'open')
          RETURNING id
          `,
          [
            userId,
            subject,
            cleanCategory
          ]
        );

      const ticketId =
        ticketResult.rows[0].id;

      await client.query(
        `
        INSERT INTO support_messages
        (
          ticket_id,
          sender_type,
          sender_id,
          message
        )
        VALUES
        ($1, 'user', $2, $3)
        `,
        [
          ticketId,
          userId,
          message
        ]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,

        message:
          "Support ticket yaradıldı.",

        ticketId
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "CREATE SUPPORT TICKET ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Support ticket yaradılmadı: " +
          error.message
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   USER TICKET LIST
========================= */

app.get(
  "/api/support/tickets",
  requireLogin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            t.id,
            t.subject,
            t.category,
            t.status,
            t.created_at,
            t.updated_at,

            (
              SELECT COUNT(*)
              FROM support_messages sm
              WHERE sm.ticket_id = t.id
            ) AS message_count,

            (
              SELECT sm.message
              FROM support_messages sm
              WHERE sm.ticket_id = t.id
              ORDER BY sm.id DESC
              LIMIT 1
            ) AS last_message

          FROM support_tickets t

          WHERE t.user_id = $1

          ORDER BY
            t.updated_at DESC,
            t.id DESC
          `,
          [req.session.userId]
        );

      res.json({
        ok: true,
        tickets:
          result.rows
      });
    } catch (error) {
      console.error(
        "USER SUPPORT TICKETS ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Support ticketlər yüklənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   USER TICKET DETAILS
========================= */

app.get(
  "/api/support/tickets/:id",
  requireLogin,
  async (req, res) => {
    try {
      const ticketId =
        Number(req.params.id);

      const userId =
        req.session.userId;

      if (!Number.isInteger(ticketId)) {
        return res.status(400).json({
          error:
            "Ticket ID düzgün deyil."
        });
      }

      const ticketResult =
        await pool.query(
          `
          SELECT
            id,
            user_id,
            subject,
            category,
            status,
            created_at,
            updated_at
          FROM support_tickets
          WHERE id = $1
            AND user_id = $2
          `,
          [
            ticketId,
            userId
          ]
        );

      const ticket =
        ticketResult.rows[0];

      if (!ticket) {
        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      const messagesResult =
        await pool.query(
          `
          SELECT
            id,
            sender_type,
            sender_id,
            message,
            created_at
          FROM support_messages
          WHERE ticket_id = $1
          ORDER BY id ASC
          `,
          [ticketId]
        );

      res.json({
        ok: true,

        ticket: {
          ...ticket,
          messages:
            messagesResult.rows
        }
      });
    } catch (error) {
      console.error(
        "USER SUPPORT TICKET DETAILS ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Ticket yüklənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   USER REPLY
========================= */

app.post(
  "/api/support/tickets/:id/messages",
  requireLogin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const ticketId =
        Number(req.params.id);

      const userId =
        req.session.userId;

      const message =
        String(
          req.body.message || ""
        ).trim();

      if (!Number.isInteger(ticketId)) {
        return res.status(400).json({
          error:
            "Ticket ID düzgün deyil."
        });
      }

      if (!message) {
        return res.status(400).json({
          error:
            "Mesaj daxil et."
        });
      }

      if (message.length > 5000) {
        return res.status(400).json({
          error:
            "Mesaj 1-5000 simvol arasında olmalıdır."
        });
      }

      const result =
        await client.query(
          `
          SELECT *
          FROM support_tickets
          WHERE id = $1
            AND user_id = $2
          `,
          [
            ticketId,
            userId
          ]
        );

      const ticket =
        result.rows[0];

      if (!ticket) {
        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      if (ticket.status === "closed") {
        return res.status(400).json({
          error:
            "Bu ticket bağlanıb. Yeni ticket aça bilərsən."
        });
      }

      await client.query("BEGIN");

      await client.query(
        `
        INSERT INTO support_messages
        (
          ticket_id,
          sender_type,
          sender_id,
          message
        )
        VALUES
        ($1, 'user', $2, $3)
        `,
        [
          ticketId,
          userId,
          message
        ]
      );

      await client.query(
        `
        UPDATE support_tickets
        SET
          status = 'open',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [ticketId]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,

        message:
          "Mesaj göndərildi."
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "USER SUPPORT REPLY ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Mesaj göndərilmədi: " +
          error.message
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   USER CLOSE TICKET
========================= */

app.post(
  "/api/support/tickets/:id/close",
  requireLogin,
  async (req, res) => {
    try {
      const ticketId =
        Number(req.params.id);

      const userId =
        req.session.userId;

      if (
        !Number.isInteger(ticketId) ||
        ticketId <= 0
      ) {
        return res.status(400).json({
          error:
            "Ticket ID düzgün deyil."
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            user_id,
            status
          FROM support_tickets
          WHERE id = $1
            AND user_id = $2
          `,
          [
            ticketId,
            userId
          ]
        );

      const ticket =
        result.rows[0];

      if (!ticket) {
        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      if (ticket.status === "closed") {
        return res.json({
          ok: true,
          message:
            "Ticket artıq bağlıdır."
        });
      }

      await pool.query(
        `
        UPDATE support_tickets
        SET
          status = 'closed',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND user_id = $2
        `,
        [
          ticketId,
          userId
        ]
      );

      res.json({
        ok: true,
        message:
          "Ticket uğurla bağlandı."
      });
    } catch (error) {
      console.error(
        "USER CLOSE TICKET ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Ticket bağlanarkən server xətası: " +
          error.message
      });
    }
  }
);

/* =========================
   ADMIN TICKET LIST
========================= */

app.get(
  "/api/admin/support/tickets",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            t.id,
            t.user_id,
            t.subject,
            t.category,
            t.status,
            t.created_at,
            t.updated_at,

            u.name,
            u.email,

            (
              SELECT COUNT(*)
              FROM support_messages sm
              WHERE sm.ticket_id = t.id
            ) AS message_count,

            (
              SELECT sm.message
              FROM support_messages sm
              WHERE sm.ticket_id = t.id
              ORDER BY sm.id DESC
              LIMIT 1
            ) AS last_message

          FROM support_tickets t

          LEFT JOIN users u
            ON u.id = t.user_id

          ORDER BY
            CASE
              WHEN t.status = 'open'
                THEN 0
              WHEN t.status = 'waiting'
                THEN 1
              ELSE 2
            END,
            t.updated_at DESC,
            t.id DESC
          `
        );

      res.json({
        ok: true,
        tickets:
          result.rows
      });
    } catch (error) {
      console.error(
        "ADMIN SUPPORT TICKETS ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Support ticketlər yüklənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   ADMIN TICKET DETAILS
========================= */

app.get(
  "/api/admin/support/tickets/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const ticketId =
        Number(req.params.id);

      if (!Number.isInteger(ticketId)) {
        return res.status(400).json({
          error:
            "Ticket ID düzgün deyil."
        });
      }

      const ticketResult =
        await pool.query(
          `
          SELECT
            t.id,
            t.user_id,
            t.subject,
            t.category,
            t.status,
            t.created_at,
            t.updated_at,

            u.name,
            u.email

          FROM support_tickets t

          LEFT JOIN users u
            ON u.id = t.user_id

          WHERE t.id = $1
          `,
          [ticketId]
        );

      const ticket =
        ticketResult.rows[0];

      if (!ticket) {
        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      const messagesResult =
        await pool.query(
          `
          SELECT
            id,
            sender_type,
            sender_id,
            message,
            created_at
          FROM support_messages
          WHERE ticket_id = $1
          ORDER BY id ASC
          `,
          [ticketId]
        );

      res.json({
        ok: true,

        ticket: {
          ...ticket,
          messages:
            messagesResult.rows
        }
      });
    } catch (error) {
      console.error(
        "ADMIN SUPPORT TICKET DETAILS ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Ticket detalları yüklənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   ADMIN REPLY
========================= */

app.post(
  "/api/admin/support/tickets/:id/messages",
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const ticketId =
        Number(req.params.id);

      const adminId =
        req.session.userId;

      const message =
        String(
          req.body.message || ""
        ).trim();

      if (!Number.isInteger(ticketId)) {
        return res.status(400).json({
          error:
            "Ticket ID düzgün deyil."
        });
      }

      if (!message) {
        return res.status(400).json({
          error:
            "Mesaj daxil et."
        });
      }

      if (message.length > 5000) {
        return res.status(400).json({
          error:
            "Mesaj 1-5000 simvol arasında olmalıdır."
        });
      }

      const result =
        await client.query(
          `
          SELECT *
          FROM support_tickets
          WHERE id = $1
          `,
          [ticketId]
        );

      const ticket =
        result.rows[0];

      if (!ticket) {
        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      if (ticket.status === "closed") {
        return res.status(400).json({
          error:
            "Bu ticket bağlanıb."
        });
      }

      await client.query("BEGIN");

      await client.query(
        `
        INSERT INTO support_messages
        (
          ticket_id,
          sender_type,
          sender_id,
          message
        )
        VALUES
        ($1, 'admin', $2, $3)
        `,
        [
          ticketId,
          adminId,
          message
        ]
      );

      await client.query(
        `
        UPDATE support_tickets
        SET
          status = 'waiting',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [ticketId]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,

        message:
          "Admin cavabı göndərildi."
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "ADMIN SUPPORT REPLY ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Cavab göndərilmədi: " +
          error.message
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   ADMIN CHANGE STATUS
========================= */

app.post(
  "/api/admin/support/tickets/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const ticketId =
        Number(req.params.id);

      const status =
        String(
          req.body.status || ""
        )
          .trim()
          .toLowerCase();

      const allowedStatuses = [
        "open",
        "waiting",
        "closed"
      ];

      if (!Number.isInteger(ticketId)) {
        return res.status(400).json({
          error:
            "Ticket ID düzgün deyil."
        });
      }

      if (
        !allowedStatuses.includes(
          status
        )
      ) {
        return res.status(400).json({
          error:
            "Status düzgün deyil."
        });
      }

      const result =
        await pool.query(
          `
          SELECT id
          FROM support_tickets
          WHERE id = $1
          `,
          [ticketId]
        );

      if (!result.rows[0]) {
        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      await pool.query(
        `
        UPDATE support_tickets
        SET
          status = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        `,
        [
          status,
          ticketId
        ]
      );

      res.json({
        ok: true,

        status,

        message:
          "Ticket statusu dəyişdirildi."
      });
    } catch (error) {
      console.error(
        "ADMIN SUPPORT STATUS ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Ticket statusu dəyişdirilmədi."
      });
    }
  }
);

/* =========================
   ADMIN DELETE TICKET
========================= */

app.delete(
  "/api/admin/support/tickets/:id",
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const ticketId =
        Number(req.params.id);

      if (!Number.isInteger(ticketId)) {
        return res.status(400).json({
          error:
            "Ticket ID düzgün deyil."
        });
      }

      const result =
        await client.query(
          `
          SELECT id
          FROM support_tickets
          WHERE id = $1
          `,
          [ticketId]
        );

      if (!result.rows[0]) {
        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      await client.query("BEGIN");

      await client.query(
        `
        DELETE FROM support_messages
        WHERE ticket_id = $1
        `,
        [ticketId]
      );

      await client.query(
        `
        DELETE FROM support_tickets
        WHERE id = $1
        `,
        [ticketId]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,

        message:
          "Support ticket silindi."
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(
        "DELETE SUPPORT TICKET ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Ticket silinmədi."
      });
    } finally {
      client.release();
    }
  }
);

/* =========================
   OLD EPOINT COMPATIBILITY
========================= */

app.post(
  "/api/deposit/epoint",
  requireLogin,
  (req, res) => {
    return res.status(400).json({
      error:
        "Hazırda manual deposit sistemindən istifadə et."
    });
  }
);

/* =========================
   PAYMENT CALLBACK
========================= */

app.post(
  "/api/payment/callback",
  (req, res) => {
    res.json({
      ok: true
    });
  }
);

/* =========================
   HEALTH CHECK
========================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "CarCash",
      status: "online"
    });
  }
);

/* =========================
   START
========================= */

initDatabase()
  .then(() => {
    app.listen(
      PORT,
      HOST,
      () => {
        console.log("");
        console.log(
          "================================"
        );
        console.log(
          "          CARCASH ONLINE"
        );
        console.log(
          "================================"
        );
        console.log(
          `HOST: ${HOST}`
        );
        console.log(
          `PORT: ${PORT}`
        );
        console.log(
          "DATABASE: NEON POSTGRESQL"
        );
        console.log(
          "================================"
        );
        console.log("");
      }
    );
  })
  .catch(error => {
    console.error(
      "DATABASE INIT ERROR:",
      error
    );

    process.exit(1);
  });
