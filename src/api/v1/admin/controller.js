const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("./models/admin.entity");
const { logAction } = require("../../../services/audit");
const settings = require("../../../services/settings");

exports.isAuthenticated = async (req, res) => {
  if (req.admin) {
    return res.json({
      ok: true,
    });
  }

  return res.status(200).json({
    ok: false,
  });
};

// Admin accounts now live in the database (see models/admin.entity.js) so
// that admin actions can be attributed to a person in the audit log. The
// single ADMIN_EMAIL/ADMIN_PASSWORD pair from .env still works as a fallback
// — useful for the very first login, before any database admin exists — but
// every login through it is flagged in the audit log as "legacy env admin"
// so it's visible that an account should be created to replace it.
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email });

    if (admin) {
      if (admin.isRestrict) {
        return res.status(403).json({
          ok: false,
          message: "This admin account has been restricted",
        });
      }

      const isValid = await bcrypt.compare(password, admin.password);

      if (!isValid) {
        return res.status(404).json({
          ok: false,
          message: "Invalid email or password",
        });
      }

      const token = jwt.sign(
        { admin: true, id: admin.id },
        process.env.JWT_ADMIN_SECRET,
        { expiresIn: "365d" }
      );

      await logAction({
        actorType: "admin",
        actorId: admin.id,
        action: "admin.login",
        targetType: "admin",
        targetId: admin.id,
      });

      return res.json({
        ok: true,
        token,
        admin: true,
      });
    }

    // Fallback: the single env-var admin, only usable while no database
    // admin accounts exist yet (so this path can't be left open forever by
    // accident once the team has migrated to real accounts).
    const anyAdminExists = await Admin.exists({});

    if (
      !anyAdminExists &&
      process.env.ADMIN_EMAIL &&
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const token = jwt.sign({ admin: true }, process.env.JWT_ADMIN_SECRET, {
        expiresIn: "365d",
      });

      await logAction({
        actorType: "system",
        action: "admin.login.legacy_env_admin",
        meta: { email },
      });

      return res.json({
        ok: true,
        token,
        admin: true,
      });
    }

    return res.status(404).json({
      ok: false,
      message: "Invalid email or password",
    });
  } catch (err) {
    return next(err);
  }
};

// Creates a new admin account. Only an already-authenticated admin can call
// this (see routes.js — gated by checkAuthStatus + isAdmin).
exports.createAdmin = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        ok: false,
        message: "name, email and password are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        ok: false,
        message: "Password must be at least 8 characters",
      });
    }

    const existing = await Admin.findOne({ email });
    if (existing) {
      return res.status(409).json({
        ok: false,
        message: "An admin with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const admin = await Admin.create({ name, email, password: hashedPassword });

    await logAction({
      actorType: req.admin?.id ? "admin" : "system",
      actorId: req.admin?.id,
      action: "admin.created",
      targetType: "admin",
      targetId: admin.id,
      meta: { email },
    });

    admin.password = undefined;

    return res.status(201).json({
      ok: true,
      admin,
    });
  } catch (err) {
    return next(err);
  }
};

exports.listAdmins = async (req, res, next) => {
  try {
    const admins = await Admin.find().select("-password").sort({ createdAt: -1 });
    return res.json({ ok: true, admins });
  } catch (err) {
    return next(err);
  }
};

exports.checkAuthStatus = async (req, res, next) => {
  try {
    const { authorization } = req.headers;
    if (!authorization) {
      return res.status(404).json({
        ok: false,
        message: "No token provided",
      });
    }
    const token = authorization.split(" ")[1];

    const data = jwt.verify(token, process.env.JWT_ADMIN_SECRET);

    if (!data) {
      return res.status(401).json({
        ok: false,
        message: "Invalid token",
      });
    }

    if (data.admin) {
      // data.id is absent for the legacy env-var admin — req.admin stays a
      // plain `true` in that case, same as before this change.
      req.admin = data.id ? { id: data.id } : true;

      return next();
    }

    return res.status(401).json({
      ok: false,
      message: "Invalid token",
    });
  } catch (err) {
    return next(err);
  }
};

// Admin-adjustable site settings — currently just the index-check price.
// See routes.js for the isAdmin gate.
exports.getSettings = async (req, res, next) => {
  try {
    const doc = await settings.getSettings();
    return res.json({ ok: true, settings: doc });
  } catch (err) {
    return next(err);
  }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const { costPerIndexCheck } = req.body;

    if (costPerIndexCheck !== undefined) {
      if (!Number.isFinite(costPerIndexCheck) || costPerIndexCheck < 0) {
        return res.status(400).json({
          ok: false,
          message: "costPerIndexCheck must be a non-negative number",
        });
      }
    }

    const doc = await settings.updateSettings({
      ...(costPerIndexCheck !== undefined ? { costPerIndexCheck } : {}),
    });

    await logAction({
      actorType: "admin",
      actorId: req.admin?.id,
      action: "settings.updated",
      meta: { costPerIndexCheck },
    });

    return res.json({ ok: true, settings: doc });
  } catch (err) {
    return next(err);
  }
};

exports.isAdmin = (req, res, next) => {
  try {
    if (!req.admin) {
      return res.status(401).json({
        ok: false,
        message: "Only admin can access this route",
      });
    }

    return next();
  } catch (err) {
    return next(err);
  }
};
