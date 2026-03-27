import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("database.db");
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key";

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subjectName TEXT,
    date TEXT NOT NULL,
    imageUrl TEXT,
    extractedText TEXT,
    language TEXT,
    summary TEXT,
    status TEXT,
    uid TEXT,
    FOREIGN KEY(uid) REFERENCES users(id)
  );
`);

// Bootstrap Admin User
const adminEmail = "admin@example.com";
const adminPassword = "adminpassword";
const existingAdmin = db.prepare("SELECT * FROM users WHERE email = ?").get(adminEmail);

if (!existingAdmin) {
  const hashedPassword = bcrypt.hashSync(adminPassword, 10);
  db.prepare("INSERT INTO users (id, email, password, role) VALUES (?, ?, ?, ?)").run(
    crypto.randomUUID(),
    adminEmail,
    hashedPassword,
    "admin"
  );
  console.log("Admin user created: admin@example.com / adminpassword");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Auth Routes
  app.post("/api/login", (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  });

  app.post("/api/register", (req, res) => {
    const { email, password } = req.body;
    try {
      const hashedPassword = bcrypt.hashSync(password, 10);
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO users (id, email, password, role) VALUES (?, ?, ?, ?)").run(
        id,
        email,
        hashedPassword,
        "user"
      );
      const token = jwt.sign({ id, email, role: "user" }, JWT_SECRET);
      res.json({ token, user: { id, email, role: "user" } });
    } catch (e) {
      res.status(400).json({ error: "User already exists" });
    }
  });

  // Document Routes
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  app.get("/api/documents", authenticate, (req: any, res) => {
    let docs;
    if (req.user.role === 'admin') {
      docs = db.prepare("SELECT * FROM documents").all();
    } else {
      docs = db.prepare("SELECT * FROM documents WHERE uid = ?").all(req.user.id);
    }
    res.json(docs);
  });

  app.post("/api/documents", authenticate, (req: any, res) => {
    const doc = req.body;
    db.prepare(`
      INSERT INTO documents (id, title, subjectName, date, imageUrl, extractedText, language, summary, status, uid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(doc.id, doc.title, doc.subjectName, doc.date, doc.imageUrl, doc.extractedText, doc.language, doc.summary, doc.status, req.user.id);
    res.json({ success: true });
  });

  app.put("/api/documents/:id", authenticate, (req: any, res) => {
    const { id } = req.params;
    const { extractedText } = req.body;
    db.prepare("UPDATE documents SET extractedText = ? WHERE id = ? AND (uid = ? OR ? = 'admin')").run(
      extractedText, id, req.user.id, req.user.role
    );
    res.json({ success: true });
  });

  app.delete("/api/documents/:id", authenticate, (req: any, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM documents WHERE id = ? AND (uid = ? OR ? = 'admin')").run(
      id, req.user.id, req.user.role
    );
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const startApp = (port: number) => {
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${port}`);
    });

    server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        console.log(`Port ${port} in use, retrying in 2 seconds...`);
        setTimeout(() => {
          server.close();
          startApp(port);
        }, 2000);
      } else {
        console.error("Server error:", e);
      }
    });
  };

  startApp(PORT);
}

startServer();
