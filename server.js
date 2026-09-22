const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database("denix.sqlite");

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
   DATABASE
========================= */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  balance REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  price REAL NOT NULL,
  daily REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS user_cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  car_id INTEGER NOT NULL,
  purchased_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_credited_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  order_id TEXT,
  transaction_id TEXT,
  status TEXT DEFAULT 'pending',
  receipt_path TEXT,
  admin_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  method TEXT,
  account TEXT,
  payout_info TEXT,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  amount REAL NOT NULL,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promo_code_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promo_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(promo_id, user_id),

  FOREIGN KEY(promo_id)
    REFERENCES promo_codes(id),

  FOREIGN KEY(user_id)
    REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(user_id)
    REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  sender_type TEXT NOT NULL,
  sender_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(ticket_id)
    REFERENCES support_tickets(id)
);
`);

/* =========================
   OLD DATABASE COMPATIBILITY
========================= */

try {
  db.prepare(
    "ALTER TABLE deposits ADD COLUMN receipt_path TEXT"
  ).run();
} catch (e) {}

try {
  db.prepare(
    "ALTER TABLE deposits ADD COLUMN admin_note TEXT"
  ).run();
} catch (e) {}

try {
  db.prepare(
    "ALTER TABLE users ADD COLUMN name TEXT"
  ).run();
} catch (e) {}

/* =========================
   LEVEL CAR SYSTEM
========================= */

const cars = [
  {
    oldName: "City Mini",
    name: "LEVEL 1",
    price: 5,
    monthly: 7.50,
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

/* =========================
   DAILY INCOME
========================= */

for (const car of cars) {
  car.daily = Number(
    (car.monthly / 30).toFixed(10)
  );
}

/* =========================
   CAR DATABASE CLEANUP
========================= */

const setupCars = db.transaction(() => {

  /*
    LEVEL adlarının siyahısı.
  */

  const allowedNames =
    cars.map(car => car.name);

  const placeholders =
    allowedNames
      .map(() => "?")
      .join(",");


  /*
    1. Köhnə maşınları LEVEL-lərə çevir.
    
    Əgər LEVEL artıq varsa:
    köhnə maşına sahib istifadəçiləri
    LEVEL maşınına keçir və köhnə sətri sil.
  */

  for (const target of cars) {

    const oldCar = db.prepare(`
      SELECT *
      FROM cars
      WHERE name = ?
      ORDER BY id ASC
      LIMIT 1
    `).get(target.oldName);

    const levelCar = db.prepare(`
      SELECT *
      FROM cars
      WHERE name = ?
      ORDER BY id ASC
      LIMIT 1
    `).get(target.name);


    /*
      Köhnə maşın var,
      LEVEL hələ yoxdur.
    */

    if (oldCar && !levelCar) {

      db.prepare(`
        UPDATE cars
        SET
          name = ?,
          price = ?,
          daily = ?
        WHERE id = ?
      `).run(
        target.name,
        target.price,
        target.daily,
        oldCar.id
      );

      continue;
    }


    /*
      Həm köhnə, həm LEVEL var.
      Köhnə maşının sahibliyini LEVEL-ə keçir.
    */

    if (
      oldCar &&
      levelCar &&
      Number(oldCar.id) !== Number(levelCar.id)
    ) {

      db.prepare(`
        UPDATE user_cars
        SET car_id = ?
        WHERE car_id = ?
      `).run(
        levelCar.id,
        oldCar.id
      );


      db.prepare(`
        DELETE FROM cars
        WHERE id = ?
      `).run(
        oldCar.id
      );
    }
  }


  /*
    2. Çatışmayan LEVEL-ləri yarat.
  */

  for (const target of cars) {

    const existing = db.prepare(`
      SELECT id
      FROM cars
      WHERE name = ?
      ORDER BY id ASC
      LIMIT 1
    `).get(target.name);


    if (!existing) {

      db.prepare(`
        INSERT INTO cars
        (
          name,
          price,
          daily
        )
        VALUES (?, ?, ?)
      `).run(
        target.name,
        target.price,
        target.daily
      );
    }
  }


  /*
    3. Bütün LEVEL-lərin qiymət və
       daily gəlirini yenilə.
  */

  for (const target of cars) {

    db.prepare(`
      UPDATE cars
      SET
        price = ?,
        daily = ?
      WHERE name = ?
    `).run(
      target.price,
      target.daily,
      target.name
    );
  }


  /*
    4. Duplicate LEVEL-ləri təmizlə.
  */

  for (const target of cars) {

    const rows = db.prepare(`
      SELECT id
      FROM cars
      WHERE name = ?
      ORDER BY id ASC
    `).all(target.name);


    if (rows.length <= 1) {
      continue;
    }


    const mainId =
      rows[0].id;


    for (let i = 1; i < rows.length; i++) {

      const duplicateId =
        rows[i].id;


      /*
        Duplicate LEVEL-ə sahib
        istifadəçiləri əsas LEVEL-ə keçir.
      */

      db.prepare(`
        UPDATE user_cars
        SET car_id = ?
        WHERE car_id = ?
      `).run(
        mainId,
        duplicateId
      );


      /*
        Duplicate sətri sil.
      */

      db.prepare(`
        DELETE FROM cars
        WHERE id = ?
      `).run(
        duplicateId
      );
    }
  }


  /*
    5. ƏN VACİB:
    
    LEVEL 1-8 xaricində qalan
    bütün maşınları tap.
  */

  const extraCars = db.prepare(`
    SELECT id, name
    FROM cars
    WHERE name NOT IN (${placeholders})
  `).all(
    ...allowedNames
  );


  /*
    Əlavə maşınların user_cars
    əlaqələrini sil.
  */

  for (const extraCar of extraCars) {

    db.prepare(`
      DELETE FROM user_cars
      WHERE car_id = ?
    `).run(
      extraCar.id
    );
  }


  /*
    İndi əlavə maşınların özlərini sil.
  */

  db.prepare(`
    DELETE FROM cars
    WHERE name NOT IN (${placeholders})
  `).run(
    ...allowedNames
  );


  /*
    6. Son yoxlama:
    LEVEL 1-8 hamısı mövcuddur.
  */

  for (const target of cars) {

    const level = db.prepare(`
      SELECT id
      FROM cars
      WHERE name = ?
      ORDER BY id ASC
      LIMIT 1
    `).get(target.name);


    if (!level) {

      db.prepare(`
        INSERT INTO cars
        (
          name,
          price,
          daily
        )
        VALUES (?, ?, ?)
      `).run(
        target.name,
        target.price,
        target.daily
      );

    } else {

      db.prepare(`
        UPDATE cars
        SET
          price = ?,
          daily = ?
        WHERE id = ?
      `).run(
        target.price,
        target.daily,
        level.id
      );
    }
  }


  /*
    7. Bir dəfə də son təmizləmə.
  */

  db.prepare(`
    DELETE FROM user_cars
    WHERE car_id IN (
      SELECT id
      FROM cars
      WHERE name NOT IN (${placeholders})
    )
  `).run(
    ...allowedNames
  );


  db.prepare(`
    DELETE FROM cars
    WHERE name NOT IN (${placeholders})
  `).run(
    ...allowedNames
  );


  /*
    8. Terminalda nəticəni göstər.
  */

  const finalCars = db.prepare(`
    SELECT
      id,
      name,
      price,
      daily
    FROM cars
    ORDER BY price ASC
  `).all();


  console.log("");
  console.log("================================");
  console.log("       CAR SYSTEM CLEANED");
  console.log("================================");

  for (const car of finalCars) {

    console.log(
      `${car.name} | ₼${Number(car.price).toFixed(2)} | daily ₼${Number(car.daily).toFixed(8)}`
    );
  }

  console.log(
    `TOTAL CARS: ${finalCars.length}`
  );

  console.log("================================");
  console.log("");
});

setupCars();

/* =========================
   TIME / EARNINGS
========================= */

const DAY_MS =
  24 * 60 * 60 * 1000;

function parseSqlDate(value) {

  if (!value) {
    return null;
  }

  const text =
    String(value).trim();

  if (!text) {
    return null;
  }

  const date =
    new Date(
      text.replace(" ", "T") + "Z"
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

function calculateCarEarned(
  lastCreditedAt,
  daily
) {

  const last =
    parseSqlDate(
      lastCreditedAt
    );

  if (!last) {
    return 0;
  }

  const elapsed =
    Date.now() -
    last.getTime();

  if (elapsed <= 0) {
    return 0;
  }

  const dailyAmount =
    Number(daily || 0);

  if (
    !Number.isFinite(
      dailyAmount
    ) ||
    dailyAmount <= 0
  ) {
    return 0;
  }

  return Math.max(
    0,
    (
      elapsed /
      DAY_MS
    ) *
    dailyAmount
  );
}

function getNowSql() {

  return new Date()
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function getUserCarsWithEarnings(userId) {

  const userCars =
    db.prepare(`
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

      WHERE uc.user_id = ?

      ORDER BY c.price ASC, uc.id ASC
    `).all(userId);

  return userCars.map(car => {

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

function getTotalPendingEarnings(userId) {

  const userCars =
    db.prepare(`
      SELECT
        uc.last_credited_at,
        c.daily

      FROM user_cars uc

      JOIN cars c
        ON c.id = uc.car_id

      WHERE uc.user_id = ?
    `).all(userId);

  let total = 0;

  for (const car of userCars) {

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

/* =========================
   USER HELPERS
========================= */

function getUser(userId) {

  return db
    .prepare(`
      SELECT
        id,
        name,
        email,
        balance,
        created_at
      FROM users
      WHERE id = ?
    `)
    .get(userId);
}

function getUserWithCars(userId) {

  const user =
    getUser(userId);

  if (!user) {
    return null;
  }

  const userCars =
    getUserCarsWithEarnings(
      userId
    );

  const pendingEarnings =
    getTotalPendingEarnings(
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

function requireLogin(
  req,
  res,
  next
) {

  if (!req.session.userId) {

    return res.status(401).json({
      error:
        "Giriş etməlisən."
    });
  }

  next();
}

function requireAdmin(
  req,
  res,
  next
) {

  if (!req.session.userId) {

    return res.status(401).json({
      error:
        "Giriş etməlisən."
    });
  }

  const admin =
    getUser(
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
   AUTH
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

      if (
        password.length < 6
      ) {

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
        db.prepare(
          "SELECT id FROM users WHERE email = ?"
        ).get(
          cleanEmail
        );

      if (exists) {

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
        db.prepare(`
          INSERT INTO users
          (name, email, password_hash, balance)
          VALUES (?, ?, ?, 0)
        `).run(
          cleanName,
          cleanEmail,
          hash
        );

      req.session.userId =
        result.lastInsertRowid;

      res.json({
        ok: true,

        user:
          getUserWithCars(
            result.lastInsertRowid
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

      const user =
        db.prepare(
          "SELECT * FROM users WHERE email = ?"
        ).get(
          String(email)
            .trim()
            .toLowerCase()
        );

      if (!user) {

        return res.status(401).json({
          error:
            "Email və ya şifrə yanlışdır."
        });
      }

      if (!user.password_hash) {

        return res.status(400).json({
          error:
            "Bu hesabda şifrə məlumatı tapılmadı."
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
          getUserWithCars(
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

app.get(
  "/api/me",
  requireLogin,
  (req, res) => {

    res.json({
      user:
        getUserWithCars(
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
  (req, res) => {

    try {

      const userId =
        req.session.userId;

      const cars =
        getUserCarsWithEarnings(
          userId
        );

      const total =
        cars.reduce(
          (sum, car) =>
            sum +
            Number(
              car.earned || 0
            ),
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
  (req, res) => {

    try {

      const userId =
        req.session.userId;

      const user =
        db.prepare(`
          SELECT
            id,
            name,
            email,
            balance,
            created_at
          FROM users
          WHERE id = ?
        `).get(userId);

      if (!user) {

        return res.status(404).json({
          error:
            "İstifadəçi tapılmadı."
        });
      }

      const carStats =
        db.prepare(`
          SELECT
            COUNT(*) AS car_count,
            COALESCE(
              SUM(c.daily),
              0
            ) AS daily_income
          FROM user_cars uc
          JOIN cars c
            ON c.id = uc.car_id
          WHERE uc.user_id = ?
        `).get(userId);

      const pending =
        getTotalPendingEarnings(
          userId
        );

      res.json({
        profile: {

          id:
            user.id,

          name:
            user.name || "",

          email:
            user.email,

          balance:
            Number(
              Number(user.balance || 0)
                .toFixed(8)
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
  (req, res) => {

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

      const emailOwner =
        db.prepare(`
          SELECT id
          FROM users
          WHERE email = ?
            AND id != ?
        `).get(
          email,
          userId
        );

      if (emailOwner) {

        return res.status(400).json({
          error:
            "Bu email artıq başqa hesabda istifadə olunur."
        });
      }

      db.prepare(`
        UPDATE users
        SET
          name = ?,
          email = ?
        WHERE id = ?
      `).run(
        name,
        email,
        userId
      );

      res.json({
        ok: true,

        message:
          "Profil məlumatları yeniləndi.",

        user:
          getUserWithCars(
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

      if (
        newPassword.length < 6
      ) {

        return res.status(400).json({
          error:
            "Yeni şifrə ən azı 6 simvol olmalıdır."
        });
      }

      const user =
        db.prepare(`
          SELECT
            id,
            password_hash
          FROM users
          WHERE id = ?
        `).get(userId);

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

      db.prepare(`
        UPDATE users
        SET password_hash = ?
        WHERE id = ?
      `).run(
        newHash,
        userId
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
  (req, res) => {

    const imageMap = {
      "LEVEL 1": "/cars/car-5.jpg",
      "LEVEL 2": "/cars/car-10.jpg",
      "LEVEL 3": "/cars/car-20.jpg",
      "LEVEL 4": "/cars/car-40.jpg",
      "LEVEL 5": "/cars/car-80.jpg",
      "LEVEL 6": "/cars/car-160.jpg",
      "LEVEL 7": "/cars/car-320.jpg",
      "LEVEL 8": "/cars/car-640.jpg"
    };

    const rows =
      db.prepare(`
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
      `).all();

    res.json(
      rows.map(car => ({
        ...car,

        image:
          imageMap[car.name] ||
          "/cars/car-5.jpg"
      }))
    );
  }
);

/* =========================
   BUY CAR
========================= */

app.post(
  "/api/cars/buy",
  requireLogin,
  (req, res) => {

    try {

      const userId =
        req.session.userId;

      const carId =
        Number(
          req.body.carId
        );

      if (
        !Number.isInteger(carId)
      ) {

        return res.status(400).json({
          error:
            "Maşın ID düzgün deyil."
        });
      }

      const car =
        db.prepare(`
          SELECT *
          FROM cars
          WHERE id = ?
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
        `).get(carId);

      if (!car) {

        return res.status(404).json({
          error:
            "Maşın tapılmadı."
        });
      }

      const user =
        getUser(userId);

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

      const now =
        getNowSql();

      const transaction =
        db.transaction(() => {

          db.prepare(`
            UPDATE users
            SET balance = balance - ?
            WHERE id = ?
          `).run(
            car.price,
            userId
          );

          db.prepare(`
            INSERT INTO user_cars
            (
              user_id,
              car_id,
              purchased_at,
              last_credited_at
            )
            VALUES (?, ?, ?, ?)
          `).run(
            userId,
            car.id,
            now,
            now
          );
        });

      transaction();

      res.json({
        ok: true,

        message:
          `${car.name} uğurla alındı.`,

        user:
          getUserWithCars(
            userId
          )
      });

    } catch (error) {

      console.error(
        "BUY CAR ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Maşın alınarkən xəta baş verdi."
      });
    }
  }
);

/* =========================
   COLLECT ALL
========================= */

app.post(
  "/api/cars/collect-all",
  requireLogin,
  (req, res) => {

    try {

      const userId =
        req.session.userId;

      const userCars =
        db.prepare(`
          SELECT
            uc.id,
            uc.last_credited_at,
            c.daily
          FROM user_cars uc
          JOIN cars c
            ON c.id = uc.car_id
          WHERE uc.user_id = ?
        `).all(userId);

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

      const nowSql =
        getNowSql();

      const transaction =
        db.transaction(() => {

          db.prepare(`
            UPDATE users
            SET balance = balance + ?
            WHERE id = ?
          `).run(
            total,
            userId
          );

          const updateCar =
            db.prepare(`
              UPDATE user_cars
              SET last_credited_at = ?
              WHERE id = ?
                AND user_id = ?
            `);

          for (const car of userCars) {

            updateCar.run(
              nowSql,
              car.id,
              userId
            );
          }
        });

      transaction();

      const updatedUser =
        getUser(
          userId
        );

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
          getUserWithCars(
            userId
          )
      });

    } catch (error) {

      console.error(
        "COLLECT ALL ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Gəlir toplanarkən xəta baş verdi."
      });
    }
  }
);

/* =========================
   COLLECT ONE CAR
========================= */

app.post(
  "/api/cars/:id/collect",
  requireLogin,
  (req, res) => {

    try {

      const userId =
        req.session.userId;

      const userCarId =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(
          userCarId
        )
      ) {

        return res.status(400).json({
          error:
            "Maşın ID düzgün deyil."
        });
      }

      const userCar =
        db.prepare(`
          SELECT
            uc.id,
            uc.user_id,
            uc.last_credited_at,

            c.name,
            c.daily

          FROM user_cars uc

          JOIN cars c
            ON c.id = uc.car_id

          WHERE uc.id = ?
            AND uc.user_id = ?
        `).get(
          userCarId,
          userId
        );

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

      const nowSql =
        getNowSql();

      const transaction =
        db.transaction(() => {

          db.prepare(`
            UPDATE users
            SET balance = balance + ?
            WHERE id = ?
          `).run(
            amount,
            userId
          );

          db.prepare(`
            UPDATE user_cars
            SET last_credited_at = ?
            WHERE id = ?
              AND user_id = ?
          `).run(
            nowSql,
            userCar.id,
            userId
          );
        });

      transaction();

      const updatedUser =
        getUser(
          userId
        );

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
          getUserWithCars(
            userId
          )
      });

    } catch (error) {

      console.error(
        "COLLECT ONE ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Gəlir toplanarkən xəta baş verdi."
      });
    }
  }
);

/* =========================
   PROMO CODE
========================= */

app.post(
  "/api/promo/redeem",
  requireLogin,
  (req, res) => {

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

      const promo =
        db.prepare(`
          SELECT *
          FROM promo_codes
          WHERE code = ?
            AND active = 1
        `).get(code);

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

      const alreadyUsed =
        db.prepare(`
          SELECT id
          FROM promo_code_uses
          WHERE promo_id = ?
            AND user_id = ?
        `).get(
          promo.id,
          userId
        );

      if (alreadyUsed) {

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

      const transaction =
        db.transaction(() => {

          db.prepare(`
            UPDATE users
            SET balance = balance + ?
            WHERE id = ?
          `).run(
            amount,
            userId
          );

          db.prepare(`
            INSERT INTO promo_code_uses
            (
              promo_id,
              user_id,
              amount
            )
            VALUES (?, ?, ?)
          `).run(
            promo.id,
            userId,
            amount
          );

          db.prepare(`
            UPDATE promo_codes
            SET used_count = used_count + 1
            WHERE id = ?
          `).run(
            promo.id
          );

          if (
            Number(promo.max_uses) > 0 &&
            Number(promo.used_count) + 1 >=
              Number(promo.max_uses)
          ) {

            db.prepare(`
              UPDATE promo_codes
              SET active = 0
              WHERE id = ?
            `).run(
              promo.id
            );
          }
        });

      transaction();

      const user =
        getUser(
          userId
        );

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

      console.error(
        "PROMO REDEEM ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Promo kod istifadə edilərkən xəta baş verdi."
      });
    }
  }
);

/* =========================
   ADMIN PROMO LIST
========================= */

app.get(
  "/api/admin/promo-codes",
  requireAdmin,
  (req, res) => {

    try {

      const codes =
        db.prepare(`
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
        `).all();

      res.json({
        codes
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
  (req, res) => {

    try {

      const code =
        String(
          req.body.code || ""
        )
          .trim()
          .toUpperCase();

      const amount =
        Number(
          req.body.amount
        );

      const maxUses =
        Number(
          req.body.maxUses
        );

      if (!code) {

        return res.status(400).json({
          error:
            "Promo kod daxil et."
        });
      }

      if (
        !/^[A-Z0-9_-]+$/.test(code)
      ) {

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
        db.prepare(`
          SELECT id
          FROM promo_codes
          WHERE code = ?
        `).get(code);

      if (exists) {

        return res.status(400).json({
          error:
            "Bu promo kod artıq mövcuddur."
        });
      }

      const result =
        db.prepare(`
          INSERT INTO promo_codes
          (
            code,
            amount,
            max_uses,
            used_count,
            active
          )
          VALUES (?, ?, ?, 0, 1)
        `).run(
          code,
          amount,
          maxUses
        );

      res.json({
        ok: true,

        message:
          "Promo kod yaradıldı.",

        promo: {

          id:
            result.lastInsertRowid,

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
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(id)
      ) {

        return res.status(400).json({
          error:
            "Kod ID düzgün deyil."
        });
      }

      const promo =
        db.prepare(`
          SELECT *
          FROM promo_codes
          WHERE id = ?
        `).get(id);

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

      db.prepare(`
        UPDATE promo_codes
        SET active = ?
        WHERE id = ?
      `).run(
        newStatus,
        id
      );

      res.json({
        ok: true,

        active:
          newStatus,

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
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(id)
      ) {

        return res.status(400).json({
          error:
            "Kod ID düzgün deyil."
        });
      }

      const promo =
        db.prepare(`
          SELECT id
          FROM promo_codes
          WHERE id = ?
        `).get(id);

      if (!promo) {

        return res.status(404).json({
          error:
            "Promo kod tapılmadı."
        });
      }

      const transaction =
        db.transaction(() => {

          db.prepare(`
            DELETE FROM promo_code_uses
            WHERE promo_id = ?
          `).run(id);

          db.prepare(`
            DELETE FROM promo_codes
            WHERE id = ?
          `).run(id);
        });

      transaction();

      res.json({
        ok: true,

        message:
          "Promo kod silindi."
      });

    } catch (error) {

      console.error(
        "DELETE PROMO ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Promo kod silinmədi."
      });
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
  (req, res) => {

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
        db.prepare(`
          INSERT INTO deposits
          (
            user_id,
            amount,
            order_id,
            status
          )
          VALUES (?, ?, ?, 'pending')
        `).run(
          req.session.userId,
          amount,
          orderId
        );

      res.json({
        ok: true,

        depositId:
          result.lastInsertRowid,

        orderId:
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
  (req, res) => {

    const depositId =
      Number(
        req.params.id
      );

    if (!req.file) {

      return res.status(400).json({
        error:
          "Qəbz şəkli seçilməyib."
      });
    }

    const deposit =
      db.prepare(`
        SELECT *
        FROM deposits
        WHERE id = ?
          AND user_id = ?
      `).get(
        depositId,
        req.session.userId
      );

    if (!deposit) {

      return res.status(404).json({
        error:
          "Deposit tapılmadı."
      });
    }

    const receiptPath =
      "/uploads/" +
      req.file.filename;

    db.prepare(`
      UPDATE deposits
      SET receipt_path = ?
      WHERE id = ?
    `).run(
      receiptPath,
      depositId
    );

    res.json({
      ok: true,

      message:
        "Qəbz uğurla yükləndi."
    });
  }
);

/* =========================
   USER DEPOSITS
========================= */

app.get(
  "/api/my-deposits",
  requireLogin,
  (req, res) => {

    const deposits =
      db.prepare(`
        SELECT *
        FROM deposits
        WHERE user_id = ?
        ORDER BY id DESC
      `).all(
        req.session.userId
      );

    res.json({
      deposits
    });
  }
);

/* =========================
   ADMIN DEPOSITS
========================= */

app.get(
  "/api/deposits",
  requireAdmin,
  (req, res) => {

    try {

      const deposits =
        db.prepare(`
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

          FROM deposits AS d

          LEFT JOIN users AS u
            ON u.id = d.user_id

          ORDER BY d.id DESC
        `).all();

      res.json(
        deposits
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
  (req, res) => {

    try {

      const depositId =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(
          depositId
        )
      ) {

        return res.status(400).json({
          error:
            "Deposit ID düzgün deyil."
        });
      }

      const deposit =
        db.prepare(`
          SELECT *
          FROM deposits
          WHERE id = ?
        `).get(
          depositId
        );

      if (!deposit) {

        return res.status(404).json({
          error:
            "Deposit tapılmadı."
        });
      }

      if (
        deposit.status !==
        "pending"
      ) {

        return res.status(400).json({
          error:
            "Bu deposit artıq işlənib."
        });
      }

      const transaction =
        db.transaction(() => {

          db.prepare(`
            UPDATE deposits
            SET status = 'approved'
            WHERE id = ?
          `).run(
            depositId
          );

          db.prepare(`
            UPDATE users
            SET balance = balance + ?
            WHERE id = ?
          `).run(
            deposit.amount,
            deposit.user_id
          );
        });

      transaction();

      res.json({
        ok: true,

        message:
          "Deposit təsdiqləndi."
      });

    } catch (error) {

      console.error(
        "APPROVE DEPOSIT ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Deposit təsdiqlənmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   REJECT DEPOSIT
========================= */

app.post(
  "/api/admin/deposits/:id/reject",
  requireAdmin,
  (req, res) => {

    try {

      const depositId =
        Number(
          req.params.id
        );

      const note =
        String(
          req.body.note || ""
        ).trim();

      if (
        !Number.isInteger(
          depositId
        )
      ) {

        return res.status(400).json({
          error:
            "Deposit ID düzgün deyil."
        });
      }

      const deposit =
        db.prepare(`
          SELECT *
          FROM deposits
          WHERE id = ?
        `).get(
          depositId
        );

      if (!deposit) {

        return res.status(404).json({
          error:
            "Deposit tapılmadı."
        });
      }

      if (
        deposit.status !==
        "pending"
      ) {

        return res.status(400).json({
          error:
            "Bu deposit artıq işlənib."
        });
      }

      db.prepare(`
        UPDATE deposits
        SET
          status = 'rejected',
          admin_note = ?
        WHERE id = ?
      `).run(
        note,
        depositId
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
  (req, res) => {

    try {

      const users =
        db.prepare(`
          SELECT
            id,
            name,
            email,
            balance,
            created_at
          FROM users
          ORDER BY id DESC
        `).all();

      res.json({
        users
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
  (req, res) => {

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
        amount < 40
      ) {

        return res.status(400).json({
          error:
            "Minimum çıxarış 40 AZN-dir."
        });
      }

      if (
        !method ||
        !account
      ) {

        return res.status(400).json({
          error:
            "Ödəniş üsulu və hesab daxil et."
        });
      }

      const user =
        getUser(
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

      const transaction =
        db.transaction(() => {

          db.prepare(`
            UPDATE users
            SET balance = balance - ?
            WHERE id = ?
          `).run(
            amount,
            req.session.userId
          );

          db.prepare(`
            INSERT INTO withdrawals
            (
              user_id,
              amount,
              method,
              account,
              payout_info,
              status
            )
            VALUES (?, ?, ?, ?, ?, 'pending')
          `).run(
            req.session.userId,
            amount,
            method,
            account,
            payoutInfo
          );
        });

      transaction();

      res.json({
        ok: true,

        message:
          "Çıxarış sorğusu yaradıldı."
      });

    } catch (error) {

      console.error(
        "WITHDRAW ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Çıxarış zamanı server xətası: " +
          error.message
      });
    }
  }
);

/* =========================
   USER WITHDRAWAL HISTORY
========================= */

app.get(
  "/api/my-withdrawals",
  requireLogin,
  (req, res) => {

    try {

      const withdrawals =
        db.prepare(`
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
          WHERE user_id = ?
          ORDER BY id DESC
        `).all(
          req.session.userId
        );

      res.json({
        withdrawals
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
  (req, res) => {

    try {

      const withdrawals =
        db.prepare(`
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
        `).all();

      res.json({
        withdrawals
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
   ADMIN APPROVE WITHDRAWAL
========================= */

app.post(
  "/api/admin/withdrawals/:id/approve",
  requireAdmin,
  (req, res) => {

    try {

      const withdrawalId =
        Number(
          req.params.id
        );

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

      const withdrawal =
        db.prepare(`
          SELECT *
          FROM withdrawals
          WHERE id = ?
        `).get(
          withdrawalId
        );

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

      db.prepare(`
        UPDATE withdrawals
        SET status = 'approved'
        WHERE id = ?
      `).run(
        withdrawalId
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
   ADMIN REJECT WITHDRAWAL
========================= */

app.post(
  "/api/admin/withdrawals/:id/reject",
  requireAdmin,
  (req, res) => {

    try {

      const withdrawalId =
        Number(
          req.params.id
        );

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

      const withdrawal =
        db.prepare(`
          SELECT *
          FROM withdrawals
          WHERE id = ?
        `).get(
          withdrawalId
        );

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

      const transaction =
        db.transaction(() => {

          db.prepare(`
            UPDATE withdrawals
            SET
              status = 'rejected',
              admin_note = ?
            WHERE id = ?
          `).run(
            note,
            withdrawalId
          );

          db.prepare(`
            UPDATE users
            SET balance = balance + ?
            WHERE id = ?
          `).run(
            withdrawal.amount,
            withdrawal.user_id
          );
        });

      transaction();

      res.json({
        ok: true,

        message:
          "Çıxarış rədd edildi və məbləğ balansa qaytarıldı."
      });

    } catch (error) {

      console.error(
        "REJECT WITHDRAWAL ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Çıxarış rədd edilmədi: " +
          error.message
      });
    }
  }
);

/* =====================================================
   SUPPORT TICKETS
===================================================== */

/* =========================
   CREATE TICKET
========================= */

app.post(
  "/api/support/tickets",
  requireLogin,
  (req, res) => {

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

      const transaction =
        db.transaction(() => {

          const ticketResult =
            db.prepare(`
              INSERT INTO support_tickets
              (
                user_id,
                subject,
                category,
                status
              )
              VALUES (?, ?, ?, 'open')
            `).run(
              userId,
              subject,
              cleanCategory
            );

          const ticketId =
            ticketResult.lastInsertRowid;

          db.prepare(`
            INSERT INTO support_messages
            (
              ticket_id,
              sender_type,
              sender_id,
              message
            )
            VALUES (?, 'user', ?, ?)
          `).run(
            ticketId,
            userId,
            message
          );

          return ticketId;
        });

      const ticketId =
        transaction();

      res.json({
        ok: true,

        message:
          "Support ticket yaradıldı.",

        ticketId
      });

    } catch (error) {

      console.error(
        "CREATE SUPPORT TICKET ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Support ticket yaradılmadı: " +
          error.message
      });
    }
  }
);

/* =========================
   USER TICKET LIST
========================= */

app.get(
  "/api/support/tickets",
  requireLogin,
  (req, res) => {

    try {

      const userId =
        req.session.userId;

      const tickets =
        db.prepare(`
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

          WHERE t.user_id = ?

          ORDER BY
            t.updated_at DESC,
            t.id DESC
        `).all(userId);

      res.json({
        ok: true,
        tickets
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
  (req, res) => {

    try {

      const ticketId =
        Number(
          req.params.id
        );

      const userId =
        req.session.userId;

      if (
        !Number.isInteger(
          ticketId
        )
      ) {

        return res.status(400).json({
          error:
            "Ticket ID düzgün deyil."
        });
      }

      const ticket =
        db.prepare(`
          SELECT
            id,
            user_id,
            subject,
            category,
            status,
            created_at,
            updated_at
          FROM support_tickets
          WHERE id = ?
            AND user_id = ?
        `).get(
          ticketId,
          userId
        );

      if (!ticket) {

        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      const messages =
        db.prepare(`
          SELECT
            id,
            sender_type,
            sender_id,
            message,
            created_at
          FROM support_messages
          WHERE ticket_id = ?
          ORDER BY id ASC
        `).all(
          ticketId
        );

      res.json({
        ok: true,

        ticket: {
          ...ticket,
          messages
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
   USER REPLY TO TICKET
========================= */

app.post(
  "/api/support/tickets/:id/messages",
  requireLogin,
  (req, res) => {

    try {

      const ticketId =
        Number(
          req.params.id
        );

      const userId =
        req.session.userId;

      const message =
        String(
          req.body.message || ""
        ).trim();

      if (
        !Number.isInteger(
          ticketId
        )
      ) {

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

      if (
        message.length < 1 ||
        message.length > 5000
      ) {

        return res.status(400).json({
          error:
            "Mesaj 1-5000 simvol arasında olmalıdır."
        });
      }

      const ticket =
        db.prepare(`
          SELECT *
          FROM support_tickets
          WHERE id = ?
            AND user_id = ?
        `).get(
          ticketId,
          userId
        );

      if (!ticket) {

        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      if (
        ticket.status ===
        "closed"
      ) {

        return res.status(400).json({
          error:
            "Bu ticket bağlanıb. Yeni ticket aça bilərsən."
        });
      }

      const transaction =
        db.transaction(() => {

          db.prepare(`
            INSERT INTO support_messages
            (
              ticket_id,
              sender_type,
              sender_id,
              message
            )
            VALUES (?, 'user', ?, ?)
          `).run(
            ticketId,
            userId,
            message
          );

          db.prepare(`
            UPDATE support_tickets
            SET
              status = 'open',
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(
            ticketId
          );
        });

      transaction();

      res.json({
        ok: true,

        message:
          "Mesaj göndərildi."
      });

    } catch (error) {

      console.error(
        "USER SUPPORT REPLY ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Mesaj göndərilmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   USER CLOSE TICKET
========================= */

app.post(
  "/api/support/tickets/:id/close",
  requireLogin,
  (req, res) => {

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

      const ticket =
        db.prepare(`
          SELECT
            id,
            user_id,
            status
          FROM support_tickets
          WHERE id = ?
            AND user_id = ?
        `).get(
          ticketId,
          userId
        );

      if (!ticket) {

        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      if (
        ticket.status === "closed"
      ) {

        return res.json({
          ok: true,
          message:
            "Ticket artıq bağlıdır."
        });
      }

      db.prepare(`
        UPDATE support_tickets
        SET
          status = 'closed',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND user_id = ?
      `).run(
        ticketId,
        userId
      );

      return res.json({
        ok: true,
        message:
          "Ticket uğurla bağlandı."
      });

    } catch (error) {

      console.error(
        "USER CLOSE TICKET ERROR:",
        error
      );

      return res.status(500).json({
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
  (req, res) => {

    try {

      const tickets =
        db.prepare(`
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
              WHEN t.status = 'open' THEN 0
              WHEN t.status = 'waiting' THEN 1
              ELSE 2
            END,
            t.updated_at DESC,
            t.id DESC
        `).all();

      res.json({
        ok: true,
        tickets
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
  (req, res) => {

    try {

      const ticketId =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(
          ticketId
        )
      ) {

        return res.status(400).json({
          error:
            "Ticket ID düzgün deyil."
        });
      }

      const ticket =
        db.prepare(`
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

          WHERE t.id = ?
        `).get(
          ticketId
        );

      if (!ticket) {

        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      const messages =
        db.prepare(`
          SELECT
            id,
            sender_type,
            sender_id,
            message,
            created_at
          FROM support_messages
          WHERE ticket_id = ?
          ORDER BY id ASC
        `).all(
          ticketId
        );

      res.json({
        ok: true,

        ticket: {
          ...ticket,
          messages
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
   ADMIN REPLY TO TICKET
========================= */

app.post(
  "/api/admin/support/tickets/:id/messages",
  requireAdmin,
  (req, res) => {

    try {

      const ticketId =
        Number(
          req.params.id
        );

      const adminId =
        req.session.userId;

      const message =
        String(
          req.body.message || ""
        ).trim();

      if (
        !Number.isInteger(
          ticketId
        )
      ) {

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

      if (
        message.length < 1 ||
        message.length > 5000
      ) {

        return res.status(400).json({
          error:
            "Mesaj 1-5000 simvol arasında olmalıdır."
        });
      }

      const ticket =
        db.prepare(`
          SELECT *
          FROM support_tickets
          WHERE id = ?
        `).get(
          ticketId
        );

      if (!ticket) {

        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      if (
        ticket.status ===
        "closed"
      ) {

        return res.status(400).json({
          error:
            "Bu ticket bağlanıb."
        });
      }

      const transaction =
        db.transaction(() => {

          db.prepare(`
            INSERT INTO support_messages
            (
              ticket_id,
              sender_type,
              sender_id,
              message
            )
            VALUES (?, 'admin', ?, ?)
          `).run(
            ticketId,
            adminId,
            message
          );

          db.prepare(`
            UPDATE support_tickets
            SET
              status = 'waiting',
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(
            ticketId
          );
        });

      transaction();

      res.json({
        ok: true,

        message:
          "Admin cavabı göndərildi."
      });

    } catch (error) {

      console.error(
        "ADMIN SUPPORT REPLY ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Cavab göndərilmədi: " +
          error.message
      });
    }
  }
);

/* =========================
   ADMIN CHANGE TICKET STATUS
========================= */

app.post(
  "/api/admin/support/tickets/:id/status",
  requireAdmin,
  (req, res) => {

    try {

      const ticketId =
        Number(
          req.params.id
        );

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

      if (
        !Number.isInteger(
          ticketId
        )
      ) {

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

      const ticket =
        db.prepare(`
          SELECT id
          FROM support_tickets
          WHERE id = ?
        `).get(
          ticketId
        );

      if (!ticket) {

        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      db.prepare(`
        UPDATE support_tickets
        SET
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        status,
        ticketId
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
  (req, res) => {

    try {

      const ticketId =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(
          ticketId
        )
      ) {

        return res.status(400).json({
          error:
            "Ticket ID düzgün deyil."
        });
      }

      const ticket =
        db.prepare(`
          SELECT id
          FROM support_tickets
          WHERE id = ?
        `).get(
          ticketId
        );

      if (!ticket) {

        return res.status(404).json({
          error:
            "Ticket tapılmadı."
        });
      }

      const transaction =
        db.transaction(() => {

          db.prepare(`
            DELETE FROM support_messages
            WHERE ticket_id = ?
          `).run(
            ticketId
          );

          db.prepare(`
            DELETE FROM support_tickets
            WHERE id = ?
          `).run(
            ticketId
          );
        });

      transaction();

      res.json({
        ok: true,

        message:
          "Support ticket silindi."
      });

    } catch (error) {

      console.error(
        "DELETE SUPPORT TICKET ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Ticket silinmədi."
      });
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
   START
========================= */

const HOST = "0.0.0.0";

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "CarCash",
    status: "online"
  });
});

app.listen(PORT, HOST, () => {
  console.log("");
  console.log("================================");
  console.log("          CARCASH ONLINE");
  console.log("================================");
  console.log(`HOST: ${HOST}`);
  console.log(`PORT: ${PORT}`);
  console.log("================================");
  console.log("");
});
